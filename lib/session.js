import jwt from "jsonwebtoken";

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

export function requireAuth(req, res) {
  const token = getBearerToken(req);
  const result = token ? verifySession(token) : { ok: false };
  if (!result.ok) {
    res.status(401).json({ error: "unauthorized" });
    return null;
  }
  return result.userLabel;
}
