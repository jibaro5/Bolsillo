import { requireAuth } from "../lib/session.js";
import { plaidConfigured, plaidFetch, encryptToken, decryptToken, mapCategory, isSpending } from "../lib/plaidClient.js";
import {
  listItems, addItem, setItemCursor,
  listAccounts, upsertAccounts, setAccountCard,
  listInbox, addInboxRows, setInboxStatus,
} from "../lib/plaidStore.js";

export const config = { api: { bodyParser: true } };

// Pulls everything new for one bank connection. The cursor is only saved
// after the rows are stored, so a failure halfway just re-fetches next time.
async function syncItem(item) {
  const token = decryptToken(item.accessTokenEnc);
  const startCursor = item.cursor || undefined;

  async function pullAll() {
    let cursor = startCursor;
    const added = [], removed = [];
    let accounts = [];
    let hasMore = true;
    while (hasMore) {
      const data = await plaidFetch("/transactions/sync", { access_token: token, cursor, count: 500 });
      added.push(...data.added);
      removed.push(...data.removed);
      if (data.accounts?.length) accounts = data.accounts;
      cursor = data.next_cursor;
      hasMore = data.has_more;
    }
    return { added, removed, accounts, cursor };
  }

  let result;
  try {
    result = await pullAll();
  } catch (err) {
    // Plaid asks to restart the whole loop if data changed mid-pagination.
    if (err.plaid?.error_code !== "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION") throw err;
    result = await pullAll();
  }

  await upsertAccounts(item.itemId, result.accounts);
  const rows = result.added.filter(isSpending).map(tx => ({
    txId: tx.transaction_id,
    accountId: tx.account_id,
    date: tx.authorized_date || tx.date,
    amount: tx.amount,
    name: tx.merchant_name || tx.name,
    category: mapCategory(tx.personal_finance_category),
  }));
  const inserted = await addInboxRows(rows);
  for (const r of result.removed) {
    await setInboxStatus(r.transaction_id, "removed").catch(() => {});
  }
  await setItemCursor(item.rowNum, result.cursor || "");
  return inserted;
}

async function state() {
  const items = await listItems();
  if (!items.length) return { configured: plaidConfigured(), accounts: [], inbox: [] };
  const [accounts, inbox] = await Promise.all([listAccounts(), listInbox()]);
  const bank = Object.fromEntries(items.map(i => [i.itemId, i.institution]));
  return {
    configured: plaidConfigured(),
    accounts: accounts.map(a => ({ accountId: a.accountId, name: a.name, mask: a.mask, subtype: a.subtype, cardId: a.cardId, institution: bank[a.itemId] || "" })),
    inbox: inbox.map(r => ({ txId: r.txId, accountId: r.accountId, date: r.date, amount: Number(r.amount), name: r.name, category: r.category })),
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  const userLabel = requireAuth(req, res);
  if (!userLabel) return;

  try {
    const body = req.method === "GET" ? {} : (typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {}));
    const action = req.method === "GET" ? req.query.action : body.action;

    if (action === "state") return res.status(200).json(await state());

    if (!plaidConfigured()) return res.status(501).json({ error: "plaid_not_configured" });

    if (action === "link-token") {
      const data = await plaidFetch("/link/token/create", {
        client_name: "Bolsillo",
        language: "es",
        country_codes: ["US"],
        user: { client_user_id: userLabel },
        products: ["transactions"],
      });
      return res.status(200).json({ link_token: data.link_token });
    }

    if (action === "exchange") {
      const data = await plaidFetch("/item/public_token/exchange", { public_token: body.public_token });
      await addItem({ itemId: data.item_id, institution: body.institution, accessTokenEnc: encryptToken(data.access_token) });
      const accounts = await plaidFetch("/accounts/get", { access_token: data.access_token });
      await upsertAccounts(data.item_id, accounts.accounts);
      return res.status(200).json({ ok: true });
    }

    if (action === "sync") {
      let added = 0;
      for (const item of await listItems()) added += await syncItem(item);
      return res.status(200).json({ added });
    }

    if (action === "map-account") {
      await setAccountCard(body.accountId, body.cardId);
      return res.status(200).json({ ok: true });
    }

    if (action === "resolve") {
      if (!["imported", "dismissed"].includes(body.status)) return res.status(400).json({ error: "invalid_status" });
      await setInboxStatus(body.txId, body.status);
      return res.status(200).json({ ok: true });
    }

    res.status(400).json({ error: "unknown_action" });
  } catch (err) {
    res.status(err.plaid ? 502 : 500).json({ error: err.message });
  }
}
