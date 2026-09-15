import { randomBytes, timingSafeEqual } from "crypto";
import bcrypt from "bcryptjs";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { signSession, signChallenge, verifyChallenge } from "../lib/session.js";
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

async function passkeyRegisterOptions(req, res, body) {
  if (!checkSetupCode(body.setupCode)) return res.status(401).json({ error: "invalid_setup_code" });
  const userLabel = String(body.userLabel || "").trim();
  if (!userLabel) return res.status(400).json({ error: "missing_userLabel" });
  const { rpID, rpName } = rpInfo(req);
  const options = await generateRegistrationOptions({
    rpName, rpID,
    userName: userLabel,
    userID: randomBytes(16),
    userDisplayName: userLabel,
    attestationType: "none",
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
  const challengeToken = signChallenge({ purpose: "register", challenge: options.challenge, userLabel });
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
  await addCredential({
    userLabel: check.payload.userLabel,
    credentialId: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString("base64"),
    counter: credential.counter,
    transports: credential.transports,
  });
  const token = signSession(check.payload.userLabel);
  res.status(200).json({ token, userLabel: check.payload.userLabel });
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
  await updateCredentialCounter(stored.rowNum, verification.authenticationInfo.newCounter);
  const token = signSession(stored.userLabel);
  res.status(200).json({ token, userLabel: stored.userLabel });
}

async function passwordSet(req, res, body) {
  if (!checkSetupCode(body.setupCode)) return res.status(401).json({ error: "invalid_setup_code" });
  const userLabel = String(body.userLabel || "").trim();
  const password = String(body.password || "");
  if (!userLabel || password.length < 6) return res.status(400).json({ error: "invalid_input" });
  const hash = await bcrypt.hash(password, 10);
  await setPasswordHash(userLabel, hash);
  const token = signSession(userLabel);
  res.status(200).json({ token, userLabel });
}

async function passwordLogin(req, res, body) {
  const userLabel = String(body.userLabel || "").trim();
  const row = await getPasswordRow(userLabel);
  if (!row || !row.passwordHash) return res.status(401).json({ error: "invalid_credentials" });
  const match = await bcrypt.compare(String(body.password || ""), row.passwordHash);
  if (!match) return res.status(401).json({ error: "invalid_credentials" });
  const token = signSession(userLabel);
  res.status(200).json({ token, userLabel });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  try {
    if (req.method === "GET" && req.query.action === "users") {
      return res.status(200).json({ users: await listUserLabels() });
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
