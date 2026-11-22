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

// Google limits reads per minute; two or three quick taps (or the app refreshing at the same moment) can hit it.
// A rejected request did nothing, so it is safe to wait a moment and send it again, a couple of times at most.
const RETRY_WAITS_MS = [1200, 2500];

export async function sheetsFetch(path, opts = {}) {
  const { token } = await getClient().getAccessToken();
  let res;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${process.env.SPREADSHEET_ID}${path}`, {
      ...opts,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(opts.headers||{}) },
    });
    if (res.status !== 429 || attempt >= RETRY_WAITS_MS.length) break;
    await new Promise(r => setTimeout(r, RETRY_WAITS_MS[attempt]));
  }
  if (!res.ok) {
    const text = await res.text().catch(()=>"");
    throw new Error(`Sheets API ${res.status}: ${text.slice(0,300)}`);
  }
  return res.json();
}

// Runs `fn` once per server instance (and again only if it failed). Used for "does this tab exist and have its
// header" checks, which cost a read on EVERY request and used up half of Google's per-minute read quota.
const onceCache = new Map();
export function once(key, fn) {
  if (!onceCache.has(key)) onceCache.set(key, fn().catch(err => { onceCache.delete(key); throw err; }));
  return onceCache.get(key);
}

// A miss re-fetches the tab list once: another serverless instance may have
// created the tab after this one cached it.
let gidCache = null;
export async function getSheetGid(sheetName) {
  if (gidCache && gidCache[sheetName] !== undefined) return gidCache[sheetName];
  const meta = await sheetsFetch(`?fields=sheets.properties`);
  gidCache = {};
  (meta.sheets||[]).forEach(s => { gidCache[s.properties.title] = s.properties.sheetId; });
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
