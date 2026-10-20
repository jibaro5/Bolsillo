import { createHash, randomBytes } from "crypto";
import { sheetsFetch, ensureSheetExists } from "./sheetsClient.js";

// Who may use Bolsillo.
//  "Usuarios"      one row per person: role, status, last access, and (optionally) the
//                  hash of their personal Apple Pay key. Only hashes are stored.
//  "Invitaciones"  single-use, 48-hour invitation codes (hash only). The admin creates
//                  one, shows it to the person once, and the person uses it to register.
// Credentials (passkeys / passwords) stay in the "Auth" tab (authStore.js).

const USERS = { name: "Usuarios", header: ["userLabel", "rol", "estado", "creado", "ultimoAcceso", "appleKeyHash", "appleKeyHint", "appleKeyCreada"] };
const INVITES = { name: "Invitaciones", header: ["codeHash", "userLabel", "rol", "creadoPor", "creado", "expira", "usada"] };
export const ROLES = ["admin", "miembro"];
const INVITE_HOURS = 48;
const CACHE_MS = 20 * 1000;

const colLetter = n => String.fromCharCode(64 + n);
export const sha256 = s => createHash("sha256").update(String(s)).digest("hex");
const same = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

async function ensureTab(tab) {
  await ensureSheetExists(tab.name);
  const range = `${tab.name}!A1:${colLetter(tab.header.length)}1`;
  const check = await sheetsFetch(`/values/${encodeURIComponent(range)}`);
  if ((check.values?.[0] || []).join("|") !== tab.header.join("|")) {
    await sheetsFetch(`/values/${encodeURIComponent(`${tab.name}!A1`)}?valueInputOption=RAW`, { method: "PUT", body: JSON.stringify({ values: [tab.header] }) });
  }
}
async function readTab(tab) {
  await ensureTab(tab);
  const data = await sheetsFetch(`/values/${encodeURIComponent(`${tab.name}!A2:${colLetter(tab.header.length)}`)}?valueRenderOption=UNFORMATTED_VALUE`);
  return (data.values || []).map((row, i) => {
    const o = { rowNum: i + 2 };
    tab.header.forEach((h, j) => { o[h] = row[j] ?? ""; });
    return o;
  }).filter(o => o[tab.header[0]] !== "");
}
async function appendRow(tab, row) {
  await ensureTab(tab);
  await sheetsFetch(`/values/${encodeURIComponent(`${tab.name}!A1:${colLetter(tab.header.length)}1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: "POST", body: JSON.stringify({ values: [row] }),
  });
}
async function setCells(tab, rowNum, fields) {
  const data = Object.entries(fields).map(([field, value]) => ({
    range: `${tab.name}!${colLetter(tab.header.indexOf(field) + 1)}${rowNum}`, values: [[value]],
  }));
  await sheetsFetch(`/values:batchUpdate`, { method: "POST", body: JSON.stringify({ valueInputOption: "RAW", data }) });
}
async function blankRow(tab, rowNum) {
  await sheetsFetch(`/values/${encodeURIComponent(`${tab.name}!A${rowNum}:${colLetter(tab.header.length)}${rowNum}`)}?valueInputOption=RAW`, {
    method: "PUT", body: JSON.stringify({ values: [Array(tab.header.length).fill("")] }),
  });
}

// ---- users (cached for a few seconds: every request checks the person is still allowed in) ----

let cache = null;
const bust = () => { cache = null; };

export async function listUsers({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.rows;
  const rows = await readTab(USERS);
  cache = { at: Date.now(), rows };
  return rows;
}
export const getUser = async (label, opts) => (await listUsers(opts)).find(u => same(u.userLabel, label)) || null;

// Decides if a session may keep using the app.
//  - Usuarios empty (not set up yet): everyone with a valid session passes, so an old install never locks out.
//  - A person who isn't in the list, or is blocked: no.
//  - Sheets failing: keep the last known answer; with no answer at all, let a valid session through
//    (a Sheets hiccup shouldn't lock the owner out; blocking still works within seconds when Sheets is up).
export async function checkAccess(label) {
  let users;
  try { users = await listUsers(); }
  catch (err) {
    if (cache) users = cache.rows;
    else { console.warn("access check skipped:", err.message); return { ok: true, rol: "miembro", degraded: true }; }
  }
  if (!users.length) return { ok: true, rol: "admin", legacy: true };
  const u = users.find(x => same(x.userLabel, label));
  if (!u) return { ok: false, reason: "not_found" };
  if (u.estado !== "activo") return { ok: false, reason: "blocked" };
  return { ok: true, rol: u.rol === "admin" ? "admin" : "miembro" };
}

export async function ensureUser(label, rol = "miembro") {
  const existing = await getUser(label, { fresh: true });
  if (existing) return existing;
  await appendRow(USERS, [String(label).trim(), rol, "activo", new Date().toISOString(), "", "", "", ""]);
  bust();
  return getUser(label, { fresh: true });
}
export async function setEstado(label, estado) {
  const u = await getUser(label, { fresh: true });
  if (!u) throw new Error("user_not_found");
  await setCells(USERS, u.rowNum, { estado });
  bust();
}
export async function removeUser(label) {
  const u = await getUser(label, { fresh: true });
  if (!u) return;
  await blankRow(USERS, u.rowNum);
  bust();
}
// Last access, written at most every 10 minutes per person.
export async function touchAccess(label) {
  try {
    const u = await getUser(label);
    if (!u) return;
    if (u.ultimoAcceso && Date.now() - new Date(u.ultimoAcceso).getTime() < 10 * 60 * 1000) return;
    await setCells(USERS, u.rowNum, { ultimoAcceso: new Date().toISOString() });
    bust();
  } catch (err) { console.warn("touchAccess failed:", err.message); }
}
export const adminCount = async () => (await listUsers({ fresh: true })).filter(u => u.rol === "admin" && u.estado === "activo").length;

// ---- personal Apple Pay keys ----

export function newApplePayKey() { return randomBytes(24).toString("hex"); }
export async function setApplePayKey(label, key) {
  const u = await getUser(label, { fresh: true });
  if (!u) throw new Error("user_not_found");
  await setCells(USERS, u.rowNum, { appleKeyHash: sha256(key), appleKeyHint: String(key).slice(-4), appleKeyCreada: new Date().toISOString() });
  bust();
}
export async function clearApplePayKey(label) {
  const u = await getUser(label, { fresh: true });
  if (!u) throw new Error("user_not_found");
  await setCells(USERS, u.rowNum, { appleKeyHash: "", appleKeyHint: "", appleKeyCreada: "" });
  bust();
}
// The active person who owns this key, or null.
export async function userForApplePayKey(key) {
  if (!key) return null;
  const h = sha256(key);
  const u = (await listUsers()).find(x => x.appleKeyHash && x.appleKeyHash === h);
  return u && u.estado === "activo" ? u : null;
}

// ---- invitations ----

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
const normCode = c => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
function newCode() {
  const bytes = randomBytes(12);
  const chars = Array.from(bytes, b => ALPHABET[b % ALPHABET.length]).join("");
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}
const pending = i => !i.usada && new Date(i.expira).getTime() > Date.now();

export async function createInvite({ userLabel, rol = "miembro", creadoPor }) {
  const label = String(userLabel || "").trim();
  if (!label || label.length > 40) throw new Error("nombre_invalido");
  const code = newCode();
  const now = Date.now();
  await appendRow(INVITES, [sha256(normCode(code)), label, rol === "admin" ? "admin" : "miembro", creadoPor || "", new Date(now).toISOString(), new Date(now + INVITE_HOURS * 3600 * 1000).toISOString(), ""]);
  return { code, userLabel: label, expira: new Date(now + INVITE_HOURS * 3600 * 1000).toISOString() };
}
export async function listInvites() {
  return (await readTab(INVITES)).filter(pending).map(i => ({ id: i.codeHash.slice(0, 10), userLabel: i.userLabel, rol: i.rol, creadoPor: i.creadoPor, expira: i.expira }));
}
export async function revokeInvite(id) {
  const row = (await readTab(INVITES)).find(i => i.codeHash.startsWith(String(id)) && pending(i));
  if (!row) return false;
  await setCells(INVITES, row.rowNum, { usada: "revocada" });
  return true;
}
// Looks a code up without using it up.
export async function findInvite(code) {
  const n = normCode(code);
  if (n.length < 8) return null;
  const h = sha256(n);
  const row = (await readTab(INVITES)).find(i => i.codeHash === h && pending(i));
  return row ? { hash: h, rowNum: row.rowNum, userLabel: row.userLabel, rol: row.rol } : null;
}
export async function findInviteByHash(hash) {
  const row = (await readTab(INVITES)).find(i => i.codeHash === hash && pending(i));
  return row ? { hash, rowNum: row.rowNum, userLabel: row.userLabel, rol: row.rol } : null;
}
export async function useInvite(invite) {
  await setCells(INVITES, invite.rowNum, { usada: new Date().toISOString() });
}
