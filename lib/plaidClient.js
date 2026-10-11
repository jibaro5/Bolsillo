import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

// Plaid REST client (plain fetch, no SDK — same approach as sheetsClient).
// PLAID_ENV is "sandbox" (fake data) until we deliberately switch it.

export function plaidConfigured() {
  return !!(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);
}

export async function plaidFetch(path, body = {}) {
  const env = process.env.PLAID_ENV || "sandbox";
  const res = await fetch(`https://${env}.plaid.com${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID,
      "PLAID-SECRET": process.env.PLAID_SECRET,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Plaid ${data.error_code || res.status}: ${data.error_message || ""}`.trim());
    err.plaid = data;
    throw err;
  }
  return data;
}

// Access tokens give read access to a bank account, so they're stored
// encrypted (AES-256-GCM), keyed off AUTH_SECRET. Format: iv.tag.ciphertext (base64).
function key() {
  return createHash("sha256").update(`${process.env.AUTH_SECRET}:plaid`).digest();
}
export function encryptToken(token) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc].map(b => b.toString("base64")).join(".");
}
export function decryptToken(stored) {
  const [iv, tag, enc] = stored.split(".").map(s => Buffer.from(s, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

// Plaid's personal_finance_category -> the app's 9 categories.
export function mapCategory(pfc) {
  const primary = pfc?.primary || "";
  const detailed = pfc?.detailed || "";
  if (/GROCERIES|SUPERSTORES/.test(detailed)) return "Super";
  if (detailed === "TRANSPORTATION_GAS") return "Gas";
  switch (primary) {
    case "FOOD_AND_DRINK": return "Comida";
    case "TRAVEL": return "Viaje";
    case "ENTERTAINMENT": return "Ocio";
    case "MEDICAL": return "Salud";
    case "GENERAL_MERCHANDISE":
    case "HOME_IMPROVEMENT": return "Compras";
    case "RENT_AND_UTILITIES": return "Gastos fijos";
    default: return "Otro";
  }
}

// Only posted outflows that look like real spending. Card payments, transfers
// and income are skipped; pending ones wait until they post (their id changes).
const NOT_SPENDING = new Set(["INCOME", "TRANSFER_IN", "TRANSFER_OUT", "LOAN_PAYMENTS"]);
export function isSpending(tx) {
  return tx.amount > 0 && !tx.pending && !NOT_SPENDING.has(tx.personal_finance_category?.primary);
}
