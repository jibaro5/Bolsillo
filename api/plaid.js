import { requireAuth } from "../lib/session.js";
import { plaidConfigured, plaidFetch, encryptToken, decryptToken } from "../lib/plaidClient.js";
import {
  listItems, addItem, removeItem, setItemCursor,
  listAccounts, upsertAccounts, setAccountCard,
  listInbox, listInboxAll, applyBatch, setInboxStatus,
} from "../lib/plaidStore.js";

export const config = { api: { bodyParser: true } };

// Pulls everything new for one bank connection. The cursor is only saved
// after the rows are stored, so a failure halfway just re-fetches next time.
async function syncItem(item) {
  const token = decryptToken(item.accessTokenEnc);
  const startCursor = item.cursor || undefined;

  async function pullAll() {
    let cursor = startCursor;
    const added = [], modified = [], removed = [];
    let accounts = [];
    let hasMore = true;
    while (hasMore) {
      const data = await plaidFetch("/transactions/sync", { access_token: token, cursor, count: 500 });
      added.push(...data.added);
      modified.push(...data.modified);
      removed.push(...data.removed);
      if (data.accounts?.length) accounts = data.accounts;
      cursor = data.next_cursor;
      hasMore = data.has_more;
    }
    return { added, modified, removed, accounts, cursor };
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
  const inserted = await applyBatch({ added: result.added, modified: result.modified, removed: result.removed });
  await setItemCursor(item.rowNum, result.cursor || "");
  return inserted;
}

async function state() {
  const items = await listItems();
  if (!items.length) return { configured: plaidConfigured(), items: [], accounts: [], inbox: [] };
  const [accounts, rawInbox] = await Promise.all([listAccounts(), listInbox()]);
  // Two devices syncing at the same instant could store a transaction twice; show it once.
  const inbox = [...new Map(rawInbox.map(r => [r.txId, r])).values()];
  const bank = Object.fromEntries(items.map(i => [i.itemId, i.institution]));
  return {
    configured: plaidConfigured(),
    items: items.map(i => ({ itemId: i.itemId, institution: i.institution, createdAt: i.createdAt })),
    accounts: accounts.map(a => ({ accountId: a.accountId, itemId: a.itemId, name: a.name, mask: a.mask, subtype: a.subtype, cardId: a.cardId, institution: bank[a.itemId] || "" })),
    inbox: inbox.map(r => ({
      txId: r.txId, accountId: r.accountId, date: r.date, amount: Number(r.amount), name: r.name, category: r.category,
      status: r.status, pending: String(r.pending).toUpperCase() === "SI",
      prevAmount: r.prevAmount === "" ? null : Number(r.prevAmount), ajuste: r.ajuste,
    })),
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
      // Backstop for connecting the same bank twice. By now Plaid has already
      // created the Item, so on the Trial plan this still uses one of the 10
      // slots — but we drop it right away instead of storing duplicate data.
      const existing = (await listItems()).find(i =>
        i.institutionId && body.institutionId ? i.institutionId === body.institutionId : i.institution === body.institution);
      if (existing && body.institution) {
        await plaidFetch("/item/remove", { access_token: data.access_token }).catch(() => {});
        return res.status(200).json({ duplicate: true, institution: existing.institution });
      }
      await addItem({ itemId: data.item_id, institution: body.institution, institutionId: body.institutionId, accessTokenEnc: encryptToken(data.access_token) });
      const accounts = await plaidFetch("/accounts/get", { access_token: data.access_token });
      await upsertAccounts(data.item_id, accounts.accounts);
      return res.status(200).json({ ok: true });
    }

    if (action === "sync") {
      let added = 0;
      for (const item of await listItems()) added += await syncItem(item);
      return res.status(200).json({ added });
    }

    if (action === "disconnect") {
      const item = (await listItems()).find(i => i.itemId === body.itemId);
      if (!item) return res.status(404).json({ error: "item_not_found" });
      // If Plaid can't remove it, keep our rows: forgetting an Item that is
      // still live would leave it unreachable but still counted.
      try {
        await plaidFetch("/item/remove", { access_token: decryptToken(item.accessTokenEnc) });
      } catch (err) {
        if (err.plaid?.error_code !== "ITEM_NOT_FOUND") throw err;
      }
      await removeItem(item.itemId);
      return res.status(200).json({ ok: true });
    }

    if (action === "bank-transactions") {
      const ids = new Set((await listAccounts()).filter(a => a.itemId === body.itemId).map(a => a.accountId));
      const rows = (await listInboxAll()).filter(r => ids.has(r.accountId));
      return res.status(200).json({
        transactions: rows
          .map(r => ({ txId: r.txId, accountId: r.accountId, date: r.date, amount: Number(r.amount), name: r.name, category: r.category, status: r.status, pending: String(r.pending).toUpperCase() === "SI", ajuste: r.ajuste }))
          .sort((a, b) => String(b.date).localeCompare(String(a.date))),
      });
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
