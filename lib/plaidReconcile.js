import { mapCategory, isSpending, isTransfer } from "./plaidClient.js";

// Folds one /transactions/sync batch into the stored PorRevisar rows.
// Pure (no I/O) so every pending -> posted case can be tested offline.
//
// Row statuses: review | imported | dismissed | removed | ajuste
//   ajuste = a transaction the user already imported changed afterwards
//            (ajuste "monto": final amount differs; "cancelado": the pending
//            charge disappeared), so the expense they entered may be stale.
//
// Plaid replaces a pending transaction with a NEW posted one (new id,
// pending_transaction_id pointing back) and lists the old id in `removed`.

const EPS = 0.005;
const sameAmount = (a, b) => Math.abs(Number(a) - Number(b)) < EPS;
const isPending = v => v === true || String(v).toUpperCase() === "SI";

export function rowToArray(r) {
  return [
    r.txId, r.accountId, r.date, r.amount, r.name, r.category, r.status, r.createdAt,
    r.pending ? "SI" : "NO",
    r.prevAmount === "" || r.prevAmount == null ? "" : r.prevAmount,
    r.ajuste || "",
    r.tipo || "",
  ];
}

export function reconcile(existing, { added = [], modified = [], removed = [] }, now = new Date().toISOString()) {
  const rows = existing.map(r => ({
    ...r,
    amount: Number(r.amount),
    pending: isPending(r.pending),
    prevAmount: r.prevAmount === "" || r.prevAmount == null ? "" : Number(r.prevAmount),
    ajuste: r.ajuste || "",
    dirty: false,
  }));
  const byId = new Map(rows.map(r => [r.txId, r]));
  const fresh = [];

  const fromTx = tx => ({
    date: tx.authorized_date || tx.date,
    amount: tx.amount,
    name: tx.merchant_name || tx.name,
    category: mapCategory(tx.personal_finance_category),
    pending: !!tx.pending,
    tipo: isTransfer(tx) ? "transferencia" : "",
  });
  const touch = (row, patch) => { Object.assign(row, patch); row.dirty = true; };
  const addRow = (tx, status, extra = {}) => {
    const r = { txId: tx.transaction_id, accountId: tx.account_id, ...fromTx(tx), status, createdAt: now, prevAmount: "", ajuste: "", ...extra };
    fresh.push(r);
    byId.set(r.txId, r);
  };
  // What the user's expense was entered with.
  const baseAmount = r => (r.status === "ajuste" ? Number(r.prevAmount) : r.amount);
  const rekey = (row, newId, patch) => { byId.delete(row.txId); touch(row, { txId: newId, ...patch }); byId.set(newId, row); };

  for (const tx of added) {
    if (byId.has(tx.transaction_id)) continue;
    const prev = !tx.pending && tx.pending_transaction_id ? byId.get(tx.pending_transaction_id) : null;

    if (prev && prev.status !== "removed") {
      const f = fromTx(tx);
      if (prev.status === "review") {
        rekey(prev, tx.transaction_id, f);
      } else if (prev.status === "ajuste") {
        rekey(prev, tx.transaction_id, { ...f, ajuste: "monto" });
        if (sameAmount(prev.amount, prev.prevAmount)) touch(prev, { status: "imported", prevAmount: "", ajuste: "" });
      } else if (prev.status === "imported") {
        const changed = !sameAmount(f.amount, prev.amount);
        touch(prev, { pending: false }); // superseded: its removal below is not a cancellation
        addRow(tx, changed ? "ajuste" : "imported", changed ? { prevAmount: prev.amount, ajuste: "monto" } : {});
      } else if (prev.status === "dismissed") {
        touch(prev, { pending: false });
        addRow(tx, "dismissed");
      }
      continue;
    }
    if (isSpending(tx)) addRow(tx, "review");
  }

  for (const tx of modified) {
    const row = byId.get(tx.transaction_id);
    const f = fromTx(tx);
    if (!row) { if (isSpending(tx)) addRow(tx, "review"); continue; }
    if (row.status === "review") {
      touch(row, f);
    } else if (row.status === "imported" || row.status === "ajuste") {
      const base = baseAmount(row);
      if (!sameAmount(f.amount, base)) touch(row, { ...f, status: "ajuste", prevAmount: base, ajuste: "monto" });
      else if (row.status === "ajuste") touch(row, { ...f, status: "imported", prevAmount: "", ajuste: "" });
      else touch(row, { pending: f.pending });
    }
  }

  for (const r of removed) {
    const row = byId.get(r.transaction_id);
    if (!row) continue;
    if (row.status === "review") touch(row, { status: "removed" });
    else if ((row.status === "imported" || row.status === "ajuste") && row.pending) {
      touch(row, { status: "ajuste", ajuste: "cancelado", prevAmount: baseAmount(row) });
    }
  }

  return {
    appends: fresh.map(rowToArray),
    updates: rows.filter(r => r.dirty).map(r => ({ rowNum: r.rowNum, values: rowToArray(r) })),
    visibleNew: fresh.filter(r => r.status === "review" || r.status === "ajuste").length,
  };
}
