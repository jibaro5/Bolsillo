import { timingSafeEqual } from "crypto";
import { listCards } from "../lib/cardsStore.js";
import { addApplePayRow, logApplePay } from "../lib/plaidStore.js";
import { userForApplePayKey, listUsers } from "../lib/usersStore.js";

export const config = { api: { bodyParser: true } };

// Receives "I just paid with Apple Pay" from an iPhone Shortcut (Wallet
// "Transaction" automation) and drops it into "Por revisar" on the spot.
//
// The Shortcut can't do Face ID, so it authenticates with its own key
// (APPLE_PAY_KEY). That key can only ADD an entry to the review list; it
// can't read anything, and nothing it adds is saved as a real expense until
// the user reviews it in the app.

function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ""));
  const y = Buffer.from(String(b ?? ""));
  return x.length === y.length && timingSafeEqual(x, y);
}

// Wallet sends the amount as text such as "$12.34"; tolerate "12,34" and "1,234.56" too.
export function parseAmount(v) {
  if (typeof v === "number") return Number.isFinite(v) ? Math.abs(v) : null;
  let s = String(v ?? "").trim().replace(/[^0-9.,-]/g, "");
  if (s.includes(",") && s.includes(".")) s = s.replace(/,/g, "");
  else if (s.includes(",")) s = /,\d{1,2}$/.test(s) ? s.replace(",", ".") : s.replace(/,/g, "");
  const n = parseFloat(s);
  return Number.isFinite(n) ? Math.abs(n) : null;
}

// Which Bolsillo card is this? The Shortcut can send the Wallet card's own name ("Card or Pass"),
// e.g. "Discover it Chrome" or "Chase Freedom Unlimited", or a card id. Accents, case and
// punctuation don't matter, and either name may contain the other. The first hint that matches wins.
const norm = t => String(t ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
export function resolveCard(cards, ...hints) {
  for (const raw of hints) {
    const h = norm(raw);
    if (!h) continue;
    const byId = cards.find(c => norm(c.id) === h);
    if (byId) return byId.id;
    // the longest card name that fits, so "Chase Sapphire" prefers a card named that over just "Chase"
    const named = cards
      .map(c => ({ c, n: norm(c.nombre) }))
      .filter(x => x.n && (h.includes(x.n) || x.n.includes(h)))
      .sort((a, b) => b.n.length - a.n.length)[0];
    if (named) return named.c.id;
  }
  return null;
}

// Whose Shortcut this is. Each person has a personal key (made in the Cuentas panel); the
// original shared key (APPLE_PAY_KEY) still works and counts as the main administrator's.
async function whoseKey(key) {
  const person = await userForApplePayKey(key);
  if (person) return person.userLabel;
  const expected = process.env.APPLE_PAY_KEY;
  if (expected && safeEqual(key, expected)) {
    const users = await listUsers().catch(() => []);
    return process.env.APPLE_PAY_USER || users.find(u => u.rol === "admin" && u.estado === "activo")?.userLabel || "Omar";
  }
  return null;
}

// Today's date where the user lives, unless the Shortcut sends its own.
const localDate = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Puerto_Rico" });

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  let body = {};
  const seen = () => ({
    merchant: String(body.merchant ?? body.Merchant ?? "").slice(0, 120),
    amount: String(body.amount ?? body.Amount ?? "").slice(0, 40),
    account: String(body.account ?? "").slice(0, 60),
    card: String(body.card ?? body.Card ?? "").slice(0, 60),
    key: req.headers["x-bolsillo-key"] || body.key ? "present" : "absent",
  });
  // Answer first-class, but always leave a trace of what arrived (best effort).
  const reply = async (status, outcome, payload) => {
    try { await logApplePay({ outcome, ...seen() }); } catch (e) { console.warn("applepay log failed", e.message); }
    return res.status(status).json(payload);
  };

  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const key = req.headers["x-bolsillo-key"] || body.key;
    const who = await whoseKey(key);
    if (!who) return reply(401, "unauthorized", { error: "unauthorized" });

    const name = String(body.merchant ?? body.Merchant ?? "").trim().slice(0, 120);
    const amount = parseAmount(body.amount ?? body.Amount);
    if (!name || amount === null || amount <= 0 || amount > 100000) return reply(400, "invalid_payment", { error: "invalid_payment" });

    const cards = await listCards();
    // The card Wallet reports wins; the Shortcut's fixed "account" (if any) is only the fallback.
    // If neither is recognised the payment is still kept: it goes to "Por revisar" marked "¿Tarjeta?".
    const fromWallet = resolveCard(cards, body.card, body.Card, body.cardName);
    const fromFixed = fromWallet ? null : resolveCard(cards, body.account);
    const resolved = fromWallet || fromFixed;
    const cardId = resolved || "?";
    const origen = fromWallet ? "wallet" : fromFixed ? "fija" : "";   // a fixed card in the Shortcut is a guess: the app asks to confirm it

    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date || "")) ? body.date : localDate();
    const result = await addApplePayRow({ cardId, name, amount, date, usuario: who, origen });
    return reply(200, result.duplicate ? "duplicate" : resolved ? "ok" : "ok_sin_tarjeta", { ok: true, id: result.id, duplicate: result.duplicate, card: resolved || null });
  } catch (err) {
    return reply(500, "error: " + String(err.message).slice(0, 80), { error: err.message });
  }
}
