import { requireAdmin } from "../lib/session.js";
import {
  listUsers, getUser, setEstado, removeUser, adminCount,
  createInvite, listInvites, revokeInvite,
  newApplePayKey, setApplePayKey, clearApplePayKey,
} from "../lib/usersStore.js";
import { credentialSummary, removeCredentialsFor } from "../lib/authStore.js";

export const config = { api: { bodyParser: true } };

// Account administration. Every action checks, on the server, that the caller is an
// active administrator: hiding the menu item in the app is not what protects this.

const same = (a, b) => String(a || "").toLowerCase() === String(b || "").toLowerCase();

async function overview() {
  const [users, creds, invites] = await Promise.all([listUsers({ fresh: true }), credentialSummary(), listInvites()]);
  // The original shared key lives in Vercel (APPLE_PAY_KEY), not in the Sheet; it counts as the main administrator's.
  const orig = process.env.APPLE_PAY_KEY;
  const owner = users.find(u => u.rol === "admin" && u.estado === "activo")?.userLabel || "";
  return {
    legacyKey: orig && owner ? { owner, hint: orig.slice(-4) } : null,
    users: users.map(u => {
      const c = creds[u.userLabel.toLowerCase()] || { devices: 0, password: false };
      return {
        userLabel: u.userLabel, rol: u.rol, estado: u.estado, creado: u.creado, ultimoAcceso: u.ultimoAcceso,
        devices: c.devices, password: c.password,
        appleKey: u.appleKeyHash ? { hint: u.appleKeyHint, creada: u.appleKeyCreada } : null,
      };
    }),
    invites,
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    const body = req.method === "GET" ? {} : (typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {}));
    const action = req.method === "GET" ? (req.query.action || "overview") : body.action;
    const label = String(body.userLabel || "").trim();

    if (action === "overview") return res.status(200).json(await overview());

    if (action === "invite-create") {
      const out = await createInvite({ userLabel: label, rol: body.rol === "admin" ? "admin" : "miembro", creadoPor: admin.userLabel });
      return res.status(200).json(out);            // the only time the code is shown
    }
    if (action === "invite-revoke") return res.status(200).json({ ok: await revokeInvite(body.id) });

    // Everything below acts on an existing person.
    const target = await getUser(label, { fresh: true });
    if (!target) return res.status(404).json({ error: "user_not_found" });
    const isSelf = same(target.userLabel, admin.userLabel);
    const isLastAdmin = target.rol === "admin" && target.estado === "activo" && (await adminCount()) <= 1;

    if (action === "user-block") {
      if (isSelf) return res.status(400).json({ error: "cannot_block_self" });
      if (isLastAdmin) return res.status(400).json({ error: "last_admin" });
      await setEstado(target.userLabel, "bloqueado");
      return res.status(200).json({ ok: true });
    }
    if (action === "user-unblock") { await setEstado(target.userLabel, "activo"); return res.status(200).json({ ok: true }); }
    if (action === "user-delete") {
      if (isSelf) return res.status(400).json({ error: "cannot_delete_self" });
      if (isLastAdmin) return res.status(400).json({ error: "last_admin" });
      await removeCredentialsFor(target.userLabel);
      await removeUser(target.userLabel);
      return res.status(200).json({ ok: true });
    }
    if (action === "apple-key-create") {
      const key = newApplePayKey();
      await setApplePayKey(target.userLabel, key);
      return res.status(200).json({ key, userLabel: target.userLabel });   // shown once; only its hash is kept
    }
    if (action === "apple-key-revoke") { await clearApplePayKey(target.userLabel); return res.status(200).json({ ok: true }); }

    res.status(400).json({ error: "unknown_action" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
