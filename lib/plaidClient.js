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

// Outflows that look like real spending, pending ones included (when one
// posts, Plaid replaces it with a new transaction — see plaidReconcile).
// Skipped: income, anything coming in, card/loan payments, refunds, and money
// moved to the user's own savings/investments or withdrawn as cash.
// Other transfers OUT are kept: Plaid has no person-to-person category, so
// payments like ATH Movil or Zelle land in TRANSFER_OUT_ACCOUNT_TRANSFER or
// TRANSFER_OUT_OTHER_TRANSFER_OUT and are real spending to the user.
const NOT_SPENDING_PRIMARY = new Set(["INCOME", "TRANSFER_IN", "LOAN_PAYMENTS"]);
const NOT_SPENDING_DETAILED = new Set([
  "TRANSFER_OUT_SAVINGS", "TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS", "TRANSFER_OUT_WITHDRAWAL",
]);
export function isSpending(tx) {
  const c = tx.personal_finance_category;
  return tx.amount > 0 && !NOT_SPENDING_PRIMARY.has(c?.primary) && !NOT_SPENDING_DETAILED.has(c?.detailed);
}
// Shown with a "Transferencia" label so they can be told apart from purchases.
export const isTransfer = tx => tx.personal_finance_category?.primary === "TRANSFER_OUT";
