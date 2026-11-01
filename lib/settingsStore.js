import { sheetsFetch, ensureSheetExists } from "./sheetsClient.js";

// Household-wide settings in a small key/value tab "Ajustes" (shared by every device and person).
//   tarjetaPrincipal  the card new Apple Pay payments are filed under when Wallet doesn't say which one it was
const SHEET = "Ajustes";
const HEADER = ["clave", "valor"];
const KEYS = ["tarjetaPrincipal"];

async function ensureHeader() {
  await ensureSheetExists(SHEET);
  const check = await sheetsFetch(`/values/${encodeURIComponent(`${SHEET}!A1:B1`)}`);
  if ((check.values?.[0] || []).join("|") !== HEADER.join("|")) {
    await sheetsFetch(`/values/${encodeURIComponent(`${SHEET}!A1`)}?valueInputOption=RAW`, { method: "PUT", body: JSON.stringify({ values: [HEADER] }) });
  }
}

export async function getSettings() {
  await ensureHeader();
  const data = await sheetsFetch(`/values/${encodeURIComponent(`${SHEET}!A2:B`)}?valueRenderOption=UNFORMATTED_VALUE`);
  const out = {};
  for (const [k, v] of data.values || []) if (KEYS.includes(k)) out[k] = String(v ?? "");
  return out;
}

export async function setSetting(key, value) {
  if (!KEYS.includes(key)) throw new Error("ajuste_invalido");
  await ensureHeader();
  const data = await sheetsFetch(`/values/${encodeURIComponent(`${SHEET}!A2:B`)}?valueRenderOption=UNFORMATTED_VALUE`);
  const idx = (data.values || []).findIndex(r => r[0] === key);
  if (idx >= 0) {
    await sheetsFetch(`/values/${encodeURIComponent(`${SHEET}!B${idx + 2}`)}?valueInputOption=RAW`, { method: "PUT", body: JSON.stringify({ values: [[String(value)]] }) });
  } else {
    await sheetsFetch(`/values/${encodeURIComponent(`${SHEET}!A1:B1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { method: "POST", body: JSON.stringify({ values: [[key, String(value)]] }) });
  }
}
