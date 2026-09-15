import { JWT } from "google-auth-library";

// Talks to the Sheet directly via the Sheets API v4, using a service account.
// Shared by api/sheet.js (expense data) and api/auth.js (login credentials).

let cachedClient = null;
function getClient() {
  if (!cachedClient) {
    cachedClient = new JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
  }
  return cachedClient;
}

export async function sheetsFetch(path, opts = {}) {
  const { token } = await getClient().getAccessToken();
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${process.env.SPREADSHEET_ID}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(opts.headers||{}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(()=>"");
    throw new Error(`Sheets API ${res.status}: ${text.slice(0,300)}`);
  }
  return res.json();
}

let gidCache = null;
export async function getSheetGid(sheetName) {
  if (!gidCache) {
    const meta = await sheetsFetch(`?fields=sheets.properties`);
    gidCache = {};
    (meta.sheets||[]).forEach(s => { gidCache[s.properties.title] = s.properties.sheetId; });
  }
  return gidCache[sheetName];
}

export async function ensureSheetExists(sheetName) {
  const gid = await getSheetGid(sheetName);
  if (gid !== undefined) return;
  await sheetsFetch(`:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: sheetName } } }] }),
  });
  gidCache = null;
}

export function rowFromUpdatedRange(updatedRange) {
  const m = String(updatedRange||"").match(/![A-Z]+(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}
