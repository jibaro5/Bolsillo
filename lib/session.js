import jwt from "jsonwebtoken";
import { checkAccess } from "./usersStore.js";

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET not configured");
  return s;
}

// Long-lived: these are personal devices (Omar's + partner's), not shared computers.
export function signSession(userLabel) {
  return jwt.sign({ sub: userLabel }, secret(), { expiresIn: "180d" });
}

export function verifySession(token) {
  try {
    const payload = jwt.verify(token, secret());
    return { ok: true, userLabel: payload.sub };
  } catch {
    return { ok: false };
  }
}

// Short-lived tokens that round-trip a WebAuthn challenge (and its purpose/user)
// through the client, so the server stays stateless between the "options" and
// "verify" calls of a registration or login ceremony.
export function signChallenge(payload) {
  return jwt.sign(payload, secret(), { expiresIn: "5m" });
}

export function verifyChallenge(token, expectedPurpose) {
  try {
    const payload = jwt.verify(token, secret());
    if (payload.purpose !== expectedPurpose) return { ok: false };
    return { ok: true, payload };
  } catch {
    return { ok: false };
  }
}

export function getBearerToken(req) {
  const h = req.headers.authorization || "";
  const m = h.match(/^Bearer (.+)$/);
  return m ? m[1] : null;
}

// Valid session AND the person is still allowed in (see usersStore.checkAccess).
// Returns { userLabel, rol } or null after answering 401.
export async function requireUser(req, res) {
  const token = getBearerToken(req);
  const result = token ? verifySession(token) : { ok: false };
  if (!result.ok) { res.status(401).json({ error: "unauthorized" }); return null; }
  const access = await checkAccess(result.userLabel);
  if (!access.ok) { res.status(401).json({ error: "unauthorized", reason: access.reason }); return null; }
  return { userLabel: result.userLabel, rol: access.rol };
}

// Same, but returns just the name (what older callers expect).
export async function requireAuth(req, res) {
  const u = await requireUser(req, res);
  return u ? u.userLabel : null;
}

// Administrators only; anyone else gets 403.
export async function requireAdmin(req, res) {
  const u = await requireUser(req, res);
  if (!u) return null;
  if (u.rol !== "admin") { res.status(403).json({ error: "forbidden" }); return null; }
  return u;
}
