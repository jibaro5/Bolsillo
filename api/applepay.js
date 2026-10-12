import { timingSafeEqual } from "crypto";
import { listCards } from "../lib/cardsStore.js";
import { addApplePayRow } from "../lib/plaidStore.js";

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

// "discover" (an id), "Discover" (a name) or the Wallet card's own name
// ("Discover it Chrome") all resolve to one of the user's Bolsillo cards.
function resolveCard(cards, ...hints) {
  for (const raw of hints) {
    const h = String(raw ?? "").trim().toLowerCase();
    if (!h) continue;
    const byId = cards.find(c => c.id.toLowerCase() === h);
    if (byId) return byId.id;
    const byName = cards.find(c => c.nombre && (h.includes(c.nombre.toLowerCase()) || c.nombre.toLowerCase().includes(h)));
    if (byName) return byName.id;
  }
  return null;
}

// Today's date where the user lives, unless the Shortcut sends its own.
const localDate = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Puerto_Rico" });

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  const expected = process.env.APPLE_PAY_KEY;
  if (!expected) return res.status(503).json({ error: "applepay_not_configured" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const key = req.headers["x-bolsillo-key"] || body.key;
    if (!safeEqual(key, expected)) return res.status(401).json({ error: "unauthorized" });

    const name = String(body.merchant ?? body.Merchant ?? "").trim().slice(0, 120);
    const amount = parseAmount(body.amount ?? body.Amount);
    if (!name || amount === null || amount <= 0 || amount > 100000) return res.status(400).json({ error: "invalid_payment" });

    const cards = await listCards();
    const cardId = resolveCard(cards, body.account, body.card, body.Card);
    if (!cardId) return res.status(400).json({ error: "unknown_card", cards: cards.map(c => c.id) });

    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date || "")) ? body.date : localDate();
    const result = await addApplePayRow({ cardId, name, amount, date });
    return res.status(200).json({ ok: true, id: result.id, duplicate: result.duplicate });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
