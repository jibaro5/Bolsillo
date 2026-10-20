import { randomBytes, timingSafeEqual } from "crypto";
import bcrypt from "bcryptjs";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { signSession, signChallenge, verifyChallenge, requireUser } from "../lib/session.js";
import { findInvite, findInviteByHash, useInvite, ensureUser, getUser, listUsers, checkAccess, touchAccess } from "../lib/usersStore.js";
import {
  listUserLabels,
  findCredentialById,
  addCredential,
  updateCredentialCounter,
  getPasswordRow,
  setPasswordHash,
} from "../lib/authStore.js";

export const config = { api: { bodyParser: true } };

function rpInfo(req) {
  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  const hostname = String(host).split(":")[0];
  const isLocal = hostname === "localhost" || hostname === "127.0.0.1";
  return { rpID: hostname, origin: isLocal ? `http://${host}` : `https://${host}`, rpName: "Bolsillo" };
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a ?? ""));
  const bufB = Buffer.from(String(b ?? ""));
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function checkSetupCode(code) {
  const expected = process.env.SETUP_CODE || "";
  return expected && safeEqual(code, expected);
}

// Who may register a credential right now, and as whom:
//  1. a single-use invitation (the name comes from the invitation), or
//  2. the setup code, but only to (re)register an ADMINISTRATOR (or the very first user
//     while no one has been set up). A stranger who gets hold of the setup code can't create members.
async function registrationTarget(body) {
  const code = body.inviteCode ?? body.setupCode;
  const invite = await findInvite(code);
  if (invite) return { ok: true, userLabel: invite.userLabel, rol: invite.rol, ih: invite.hash };
  if (checkSetupCode(body.setupCode)) {
    const label = String(body.userLabel || "").trim();
    if (!label) return { ok: false, error: "missing_userLabel" };
    const users = await listUsers({ fresh: true });
    if (!users.length) return { ok: true, userLabel: label, rol: "admin" };
    const u = users.find(x => x.userLabel.toLowerCase() === label.toLowerCase());
    if (u && u.rol === "admin" && u.estado === "activo") return { ok: true, userLabel: u.userLabel, rol: "admin" };
  }
  return { ok: false, error: "invalid_setup_code" };
}

// A blocked person can't register new devices.
async function notBlocked(userLabel) {
  const u = await getUser(userLabel, { fresh: true });
  return !(u && u.estado !== "activo");
}

async function passkeyRegisterOptions(req, res, body) {
  const target = await registrationTarget(body);
  if (!target.ok) return res.status(target.error === "missing_userLabel" ? 400 : 401).json({ error: target.error });
  const userLabel = target.userLabel;
  if (!(await notBlocked(userLabel))) return res.status(403).json({ error: "blocked" });
  const { rpID, rpName } = rpInfo(req);
  const options = await generateRegistrationOptions({
    rpName, rpID,
    userName: userLabel,
    userID: randomBytes(16),
    userDisplayName: userLabel,
    attestationType: "none",
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
  const challengeToken = signChallenge({ purpose: "register", challenge: options.challenge, userLabel, rol: target.rol, ih: target.ih || "" });
  res.status(200).json({ options, challengeToken });
}

async function passkeyRegisterVerify(req, res, body) {
  const check = verifyChallenge(body.challengeToken, "register");
  if (!check.ok) return res.status(401).json({ error: "invalid_or_expired_challenge" });
  const { rpID, origin } = rpInfo(req);
  const verification = await verifyRegistrationResponse({
    response: body.attestationResponse,
    expectedChallenge: check.payload.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
  });
  if (!verification.verified || !verification.registrationInfo) {
    return res.status(401).json({ error: "verification_failed" });
  }
  const { credential } = verification.registrationInfo;
  const { userLabel, rol, ih } = check.payload;
  let invite = null;
  if (ih) {
    invite = await findInviteByHash(ih);
    if (!invite) return res.status(401).json({ error: "invalid_setup_code" });   // used or expired in between
  }
  if (!(await notBlocked(userLabel))) return res.status(403).json({ error: "blocked" });
  await addCredential({
    userLabel,
    credentialId: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString("base64"),
    counter: credential.counter,
    transports: credential.transports,
  });
  await ensureUser(userLabel, rol || "miembro");
  if (invite) await useInvite(invite);
  await touchAccess(userLabel);
  res.status(200).json({ token: signSession(userLabel), userLabel, rol: rol || "miembro" });
}

async function passkeyLoginOptions(req, res) {
  const { rpID } = rpInfo(req);
  const options = await generateAuthenticationOptions({ rpID, userVerification: "required" });
  const challengeToken = signChallenge({ purpose: "login", challenge: options.challenge });
  res.status(200).json({ options, challengeToken });
}

async function passkeyLoginVerify(req, res, body) {
  const check = verifyChallenge(body.challengeToken, "login");
  if (!check.ok) return res.status(401).json({ error: "invalid_or_expired_challenge" });
  const assertion = body.assertionResponse || {};
  const stored = await findCredentialById(assertion.id || assertion.rawId);
  if (!stored) return res.status(401).json({ error: "unknown_credential" });
  const { rpID, origin } = rpInfo(req);
  const verification = await verifyAuthenticationResponse({
    response: assertion,
    expectedChallenge: check.payload.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: {
      id: stored.credentialId,
      publicKey: new Uint8Array(Buffer.from(stored.publicKey, "base64")),
      counter: parseInt(stored.counter, 10) || 0,
      transports: stored.transports ? JSON.parse(stored.transports) : undefined,
    },
  });
  if (!verification.verified) return res.status(401).json({ error: "verification_failed" });
  const access = await checkAccess(stored.userLabel);
  if (!access.ok) return res.status(403).json({ error: access.reason === "blocked" ? "blocked" : "no_access" });
  await updateCredentialCounter(stored.rowNum, verification.authenticationInfo.newCounter);
  await touchAccess(stored.userLabel);
  res.status(200).json({ token: signSession(stored.userLabel), userLabel: stored.userLabel, rol: access.rol });
}

async function passwordSet(req, res, body) {
  const target = await registrationTarget(body);
  if (!target.ok) return res.status(target.error === "missing_userLabel" ? 400 : 401).json({ error: target.error });
  const password = String(body.password || "");
  if (password.length < 6) return res.status(400).json({ error: "invalid_input" });
  const userLabel = target.userLabel;
  if (!(await notBlocked(userLabel))) return res.status(403).json({ error: "blocked" });
  const invite = target.ih ? await findInviteByHash(target.ih) : null;
  if (target.ih && !invite) return res.status(401).json({ error: "invalid_setup_code" });
  const hash = await bcrypt.hash(password, 10);
  await setPasswordHash(userLabel, hash);
  await ensureUser(userLabel, target.rol || "miembro");
  if (invite) await useInvite(invite);
  await touchAccess(userLabel);
  res.status(200).json({ token: signSession(userLabel), userLabel, rol: target.rol || "miembro" });
}

async function passwordLogin(req, res, body) {
  const userLabel = String(body.userLabel || "").trim();
  const row = await getPasswordRow(userLabel);
  if (!row || !row.passwordHash) return res.status(401).json({ error: "invalid_credentials" });
  const match = await bcrypt.compare(String(body.password || ""), row.passwordHash);
  if (!match) return res.status(401).json({ error: "invalid_credentials" });
  const access = await checkAccess(row.userLabel);
  if (!access.ok) return res.status(403).json({ error: access.reason === "blocked" ? "blocked" : "no_access" });
  await touchAccess(row.userLabel);
  res.status(200).json({ token: signSession(row.userLabel), userLabel: row.userLabel, rol: access.rol });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  try {
    if (req.method === "GET" && req.query.action === "users") {
      // Only people who can actually sign in (a blocked person's name isn't offered).
      const labels = await listUserLabels();
      const known = await listUsers();
      return res.status(200).json({ users: known.length ? labels.filter(l => known.some(u => u.userLabel.toLowerCase() === l.toLowerCase() && u.estado === "activo")) : labels });
    }
    if (req.method === "GET" && req.query.action === "me") {
      const u = await requireUser(req, res);
      if (!u) return;
      return res.status(200).json({ userLabel: u.userLabel, rol: u.rol });
    }
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const action = body.action;
    if (action === "passkey-register-options") return await passkeyRegisterOptions(req, res, body);
    if (action === "passkey-register-verify") return await passkeyRegisterVerify(req, res, body);
    if (action === "passkey-login-options") return await passkeyLoginOptions(req, res);
    if (action === "passkey-login-verify") return await passkeyLoginVerify(req, res, body);
    if (action === "password-set") return await passwordSet(req, res, body);
    if (action === "password-login") return await passwordLogin(req, res, body);
    res.status(400).json({ error: "unknown_action" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
