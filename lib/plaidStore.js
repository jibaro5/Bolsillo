import { sheetsFetch, ensureSheetExists, getSheetGid } from "./sheetsClient.js";
import { reconcile } from "./plaidReconcile.js";

// Three tabs, all created lazily on first write so an app that never connects
// a bank never gets extra tabs in the Sheet:
//   PlaidItems    one row per connected bank (token stored encrypted)
//   PlaidAccounts one row per account, with the Bolsillo card it maps to
//   PorRevisar    imported transactions waiting for review
const TABS = {
  items: { name: "PlaidItems", header: ["itemId","institution","accessTokenEnc","cursor","createdAt","institutionId","error"] },
  accounts: { name: "PlaidAccounts", header: ["accountId","itemId","name","mask","subtype","cardId"] },
  applePayLog: { name: "ApplePayLog", header: ["at","outcome","merchant","amount","account","card","key"] },
  inbox: { name: "PorRevisar", header: ["txId","accountId","date","amount","name","category","status","createdAt","pending","prevAmount","ajuste","tipo","usuario"] },
};

const colLetter = n => String.fromCharCode(64 + n);

async function ensureTab(tab) {
  await ensureSheetExists(tab.name);
  const check = await sheetsFetch(`/values/${encodeURIComponent(`${tab.name}!A1:${colLetter(tab.header.length)}1`)}`);
  if ((check.values?.[0] || []).join("|") !== tab.header.join("|")) {
    await sheetsFetch(`/values/${encodeURIComponent(`${tab.name}!A1`)}?valueInputOption=USER_ENTERED`, {
      method: "PUT",
      body: JSON.stringify({ values: [tab.header] }),
    });
  }
}

async function readTab(tab) {
  if ((await getSheetGid(tab.name)) === undefined) return [];
  const data = await sheetsFetch(`/values/${encodeURIComponent(`${tab.name}!A2:${colLetter(tab.header.length)}`)}?valueRenderOption=UNFORMATTED_VALUE`);
  return (data.values || [])
    .map((row, i) => {
      const o = { rowNum: i + 2 };
      tab.header.forEach((h, j) => { o[h] = row[j] ?? ""; });
      return o;
    })
    .filter(o => o[tab.header[0]] !== "");
}

async function appendRows(tab, rows) {
  if (!rows.length) return;
  await ensureTab(tab);
  await sheetsFetch(`/values/${encodeURIComponent(`${tab.name}!A1:${colLetter(tab.header.length)}1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: "POST",
    body: JSON.stringify({ values: rows }),
  });
}

async function setCell(tab, rowNum, field, value) {
  const col = colLetter(tab.header.indexOf(field) + 1);
  await sheetsFetch(`/values/${encodeURIComponent(`${tab.name}!${col}${rowNum}`)}?valueInputOption=RAW`, {
    method: "PUT",
    body: JSON.stringify({ values: [[value]] }),
  });
}

// ---- items ----

export const listItems = () => readTab(TABS.items);

export async function addItem({ itemId, institution, institutionId, accessTokenEnc }) {
  await appendRows(TABS.items, [[itemId, institution || "", accessTokenEnc, "", new Date().toISOString(), institutionId || ""]]);
}

// Forgets a connection and everything that came from it (accounts and every
// imported/dismissed/pending transaction), in one batched write. Rows are
// blanked rather than deleted; readTab ignores blank rows.
export async function removeItem(itemId) {
  const [items, accounts, inbox] = await Promise.all([readTab(TABS.items), readTab(TABS.accounts), readTab(TABS.inbox)]);
  const mine = accounts.filter(a => a.itemId === itemId);
  const accountIds = new Set(mine.map(a => a.accountId));
  const blank = (tab, rowNum) => ({
    range: `${tab.name}!A${rowNum}:${colLetter(tab.header.length)}${rowNum}`,
    values: [Array(tab.header.length).fill("")],
  });
  const data = [
    ...items.filter(i => i.itemId === itemId).map(i => blank(TABS.items, i.rowNum)),
    ...mine.map(a => blank(TABS.accounts, a.rowNum)),
    ...inbox.filter(r => accountIds.has(r.accountId)).map(r => blank(TABS.inbox, r.rowNum)),
  ];
  if (!data.length) return 0;
  await sheetsFetch(`/values:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({ valueInputOption: "RAW", data }),
  });
  return data.length;
}

export const setItemCursor = (rowNum, cursor) => setCell(TABS.items, rowNum, "cursor", cursor);

// Last sync error code for a bank (e.g. ITEM_LOGIN_REQUIRED); "" when it syncs fine.
export const setItemError = (rowNum, code) => setCell(TABS.items, rowNum, "error", code || "");

// ---- accounts ----

export const listAccounts = () => readTab(TABS.accounts);

// Adds accounts we haven't seen; existing rows keep their card mapping.
export async function upsertAccounts(itemId, accounts) {
  const known = new Set((await listAccounts()).map(a => a.accountId));
  const fresh = accounts.filter(a => !known.has(a.account_id));
  await appendRows(TABS.accounts, fresh.map(a => [a.account_id, itemId, a.name || "", a.mask || "", a.subtype || "", ""]));
}

export async function setAccountCard(accountId, cardId) {
  const row = (await listAccounts()).find(a => a.accountId === accountId);
  if (!row) throw new Error("account_not_found");
  await setCell(TABS.accounts, row.rowNum, "cardId", cardId || "");
}

// ---- inbox ----

// What the user still has to look at: new transactions and ones whose amount
// changed (or vanished) after they were imported.
export const listInbox = async () => (await readTab(TABS.inbox)).filter(r => r.status === "review" || r.status === "ajuste");

// Every status (review / imported / dismissed / removed), for a bank's history view.
export const listInboxAll = () => readTab(TABS.inbox);

// Folds a sync batch into the inbox (see plaidReconcile for the rules), writing
// changed rows in one batched update and new rows in one append. Returns how
// many new rows the user needs to look at.
export async function applyBatch(batch) {
  const { appends, updates, visibleNew } = reconcile(await readTab(TABS.inbox), batch);
  const tab = TABS.inbox;
  if (updates.length) {
    await sheetsFetch(`/values:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({
        valueInputOption: "RAW",
        data: updates.map(u => ({ range: `${tab.name}!A${u.rowNum}:${colLetter(tab.header.length)}${u.rowNum}`, values: [u.values] })),
      }),
    });
  }
  await appendRows(tab, appends);
  return visibleNew;
}

// An Apple Pay payment reported by the iPhone Shortcut. It belongs directly to
// a Bolsillo card, so its accountId is the synthetic "card:<cardId>" instead
// of a Plaid account. A repeat of the same payment within 90 seconds (the
// Shortcut firing twice) is ignored.
export async function addApplePayRow({ cardId, name, amount, date, usuario = "" }) {
  const rows = await readTab(TABS.inbox);
  const now = Date.now();
  const dup = rows.find(r => r.tipo === "applepay" && r.accountId === `card:${cardId}` && r.name === name
    && Math.abs(Number(r.amount) - amount) < 0.005 && now - new Date(r.createdAt).getTime() < 90 * 1000);
  if (dup) return { id: dup.txId, duplicate: true };
  const id = `ap-${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await appendRows(TABS.inbox, [[id, `card:${cardId}`, date, amount, name, "", "review", new Date(now).toISOString(), "NO", "", "", "applepay", usuario]]);
  return { id, duplicate: false };
}

// Every request the Shortcut makes, accepted or not, so a payment that
// "didn't register" can be traced to where it stopped. Never stores the key.
// Rejected-for-bad-key requests are throttled to one per minute so a stranger
// can't fill the Sheet.
export async function logApplePay(entry) {
  const tab = TABS.applePayLog;
  if (entry.outcome === "unauthorized") {
    const rows = await readTab(tab);
    const last = [...rows].reverse().find(r => r.outcome === "unauthorized");
    if (last && Date.now() - new Date(last.at).getTime() < 60 * 1000) return;
  }
  await appendRows(tab, [[new Date().toISOString(), entry.outcome, entry.merchant ?? "", entry.amount ?? "", entry.account ?? "", entry.card ?? "", entry.key ?? ""]]);
}

export async function setInboxStatus(txId, status) {
  const row = (await readTab(TABS.inbox)).find(r => r.txId === txId);
  if (!row) throw new Error("transaction_not_found");
  await setCell(TABS.inbox, row.rowNum, "status", status);
}
