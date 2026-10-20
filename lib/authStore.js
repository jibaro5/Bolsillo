import { sheetsFetch, ensureSheetExists } from "./sheetsClient.js";

// One "Auth" tab holds both credential types, distinguished by column A:
//   passkey  -> B userLabel, C credentialId, D publicKey(base64), E counter, F transports(JSON)
//   password -> B userLabel, G passwordHash
// H is createdAt for either. Row 1 is the header.
const SHEET_NAME = "Auth";
const HEADER = ["type","userLabel","credentialId","publicKey","counter","transports","passwordHash","createdAt"];

async function ensureHeader() {
  await ensureSheetExists(SHEET_NAME);
  const check = await sheetsFetch(`/values/${encodeURIComponent(`${SHEET_NAME}!A1`)}`);
  const hasHeader = check.values && check.values[0]?.[0] === "type";
  if (!hasHeader) {
    await sheetsFetch(`/values/${encodeURIComponent(`${SHEET_NAME}!A1`)}?valueInputOption=USER_ENTERED`, {
      method: "PUT",
      body: JSON.stringify({ values: [HEADER] }),
    });
  }
}

async function readAllRows() {
  await ensureHeader();
  const data = await sheetsFetch(`/values/${encodeURIComponent(`${SHEET_NAME}!A2:H`)}`);
  return (data.values || []).map((row, i) => ({
    rowNum: i + 2,
    type: row[0] || "",
    userLabel: row[1] || "",
    credentialId: row[2] || "",
    publicKey: row[3] || "",
    counter: row[4] || "0",
    transports: row[5] || "",
    passwordHash: row[6] || "",
    createdAt: row[7] || "",
  })).filter(r => r.type);
}

export async function listUserLabels() {
  const rows = await readAllRows();
  return [...new Set(rows.map(r => r.userLabel).filter(Boolean))];
}

export async function findCredentialById(credentialId) {
  const rows = await readAllRows();
  return rows.find(r => r.type === "passkey" && r.credentialId === credentialId) || null;
}

export async function addCredential({ userLabel, credentialId, publicKey, counter, transports }) {
  await ensureHeader();
  await sheetsFetch(`/values/${encodeURIComponent(`${SHEET_NAME}!A1:H1`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
    method: "POST",
    body: JSON.stringify({ values: [["passkey", userLabel, credentialId, publicKey, String(counter), JSON.stringify(transports||[]), "", new Date().toISOString()]] }),
  });
}

export async function updateCredentialCounter(rowNum, counter) {
  await sheetsFetch(`/values/${encodeURIComponent(`${SHEET_NAME}!E${rowNum}`)}?valueInputOption=USER_ENTERED`, {
    method: "PUT",
    body: JSON.stringify({ values: [[String(counter)]] }),
  });
}

export async function getPasswordRow(userLabel) {
  const rows = await readAllRows();
  return rows.find(r => r.type === "password" && r.userLabel === userLabel) || null;
}

export async function setPasswordHash(userLabel, hash) {
  const existing = await getPasswordRow(userLabel);
  if (existing) {
    await sheetsFetch(`/values/${encodeURIComponent(`${SHEET_NAME}!G${existing.rowNum}`)}?valueInputOption=USER_ENTERED`, {
      method: "PUT",
      body: JSON.stringify({ values: [[hash]] }),
    });
    return;
  }
  await ensureHeader();
  await sheetsFetch(`/values/${encodeURIComponent(`${SHEET_NAME}!A1:H1`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
    method: "POST",
    body: JSON.stringify({ values: [["password", userLabel, "", "", "", "", hash, new Date().toISOString()]] }),
  });
}

// ---- admin helpers ----

// How each person can sign in: number of Face ID devices and whether a password is set.
export async function credentialSummary() {
  const rows = await readAllRows();
  const out = {};
  for (const r of rows) {
    const key = r.userLabel.toLowerCase();
    out[key] = out[key] || { devices: 0, password: false };
    if (r.type === "passkey") out[key].devices += 1;
    if (r.type === "password" && r.passwordHash) out[key].password = true;
  }
  return out;
}

// Removes every passkey and password of a person (their rows are blanked, like the rest of the app).
export async function removeCredentialsFor(userLabel) {
  const rows = (await readAllRows()).filter(r => r.userLabel.toLowerCase() === String(userLabel).toLowerCase());
  if (!rows.length) return 0;
  await sheetsFetch(`/values:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({ valueInputOption: "RAW", data: rows.map(r => ({ range: `${SHEET_NAME}!A${r.rowNum}:H${r.rowNum}`, values: [Array(8).fill("")] })) }),
  });
  return rows.length;
}
