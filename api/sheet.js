import { sheetsFetch, getSheetGid, rowFromUpdatedRange } from "../lib/sheetsClient.js";
import { requireAuth } from "../lib/session.js";
import { listCards, addCard, editCard, deleteCard, getCard } from "../lib/cardsStore.js";
import { listRules, addRule, editRule, deleteRule } from "../lib/rewardsStore.js";

export const config = { api: { bodyParser: true } };

// Talks to the Sheet directly via the Sheets API v4, using a service account.
// Replaces the old Apps Script Web App proxy (removed for its "cold start"
// latency: idle deployments could take 20-30s+, sometimes over a minute, to
// respond to the first request). Every action name and JSON shape below is
// kept identical to the old backend so the front-end needs no changes.

const SHEET_NAMES = { credit: "Credit Card", debit: "Debito", recurring: "Recurrentes" };
const CATEGORIES = ["Comida","Super","Gas","Ocio","Viaje","Salud","Compras","Gastos fijos","Otro"];

// Sheets' date epoch is 1899-12-30; 25569 is the day count from there to the
// Unix epoch. UNFORMATTED_VALUE returns date cells as this kind of serial
// number rather than a string, so this is needed to get back to YYYY-MM-DD.
function serialToDateStr(serial) {
  const ms = Math.round((Number(serial) - 25569) * 86400 * 1000);
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth()+1).padStart(2,"0");
  const day = String(d.getUTCDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}

// ---- shared helpers for any "expenses"-shaped tab (Credit Card / Debito) ----

async function readExpenses(sheetName) {
  const range = encodeURIComponent(`${sheetName}!A1:H`);
  const data = await sheetsFetch(`/values/${range}?valueRenderOption=UNFORMATTED_VALUE`);
  const rows = data.values || [];
  let headerRow = -1;
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]||"").toLowerCase().indexOf("descripci") > -1) { headerRow = i; break; }
  }
  const expenses = [];
  if (headerRow >= 0) {
    for (let j = headerRow + 1; j < rows.length; j++) {
      const row = rows[j];
      if (!row || !row[0]) continue;
      const rawDate = row[2];
      const dateStr = typeof rawDate === "number" ? serialToDateStr(rawDate) : String(rawDate||"");
      const colD = String(row[3]??"");
      const colE = String(row[4]??"");
      const dIsCategory = CATEGORIES.some(c => colD.trim() === c || colD.trim().endsWith(c));
      const category = dIsCategory ? colD : colE;
      const owed = dIsCategory ? colE : colD;
      expenses.push({
        id: String(j+1),
        desc: String(row[0]??""),
        amount: String(row[1]??"").replace(/[$,]/g,"").trim(),
        date: dateStr,
        category,
        owed: String(owed).replace(/[$,]/g,"").trim(),
        added: String(row[5]??"").trim().toUpperCase() === "SI",
        paid: String(row[6]??"").trim().toUpperCase() === "SI",
      });
    }
  }
  return expenses;
}

async function appendExpense(sheetName, p) {
  const headerCheck = await sheetsFetch(`/values/${encodeURIComponent(`${sheetName}!A1`)}`);
  const hasHeader = headerCheck.values && String(headerCheck.values[0]?.[0]||"").toLowerCase().indexOf("descripci") > -1;
  if (!hasHeader) {
    await sheetsFetch(`/values/${encodeURIComponent(`${sheetName}!A1`)}?valueInputOption=USER_ENTERED`, {
      method: "PUT",
      body: JSON.stringify({ values: [["Descripción","Monto","Fecha","Categoría","Me deben","Ingresado","Me pagaron"]] }),
    });
  }
  const result = await sheetsFetch(`/values/${encodeURIComponent(`${sheetName}!A1:G1`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
    method: "POST",
    body: JSON.stringify({ values: [[p.desc, p.amount, p.date, p.category||"", p.owed||"", "NO", "NO"]] }),
  });
  return { id: rowFromUpdatedRange(result.updates?.updatedRange) };
}

async function editExpense(sheetName, p) {
  const rowNum = parseInt(p.id, 10);
  if (!(rowNum > 0)) return;
  await sheetsFetch(`/values/${encodeURIComponent(`${sheetName}!A${rowNum}:E${rowNum}`)}?valueInputOption=USER_ENTERED`, {
    method: "PUT",
    body: JSON.stringify({ values: [[p.desc, p.amount, p.date, p.category||"", p.owed||""]] }),
  });
}

async function updateExpenseStatus(sheetName, p) {
  const rowNum = parseInt(p.id, 10);
  if (!(rowNum > 0)) return;
  if (p.owed !== undefined) {
    await sheetsFetch(`/values/${encodeURIComponent(`${sheetName}!E${rowNum}`)}?valueInputOption=USER_ENTERED`, {
      method: "PUT",
      body: JSON.stringify({ values: [[p.owed || ""]] }),
    });
  }
  await sheetsFetch(`/values/${encodeURIComponent(`${sheetName}!F${rowNum}:G${rowNum}`)}?valueInputOption=USER_ENTERED`, {
    method: "PUT",
    body: JSON.stringify({ values: [[p.added === "true" ? "SI" : "NO", p.paid === "true" ? "SI" : "NO"]] }),
  });
}

async function deleteRow(sheetName, p) {
  const rowNum = parseInt(p.id, 10);
  if (!(rowNum > 0)) return;
  const gid = await getSheetGid(sheetName);
  if (gid === undefined) throw new Error(`Sheet tab not found: ${sheetName}`);
  await sheetsFetch(`:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      requests: [{ deleteDimension: { range: { sheetId: gid, dimension: "ROWS", startIndex: rowNum-1, endIndex: rowNum } } }],
    }),
  });
}

// ---- Recurrentes (fixed row layout: name, amount, day; row 1 is always header) ----

async function readRecurring() {
  const range = encodeURIComponent(`${SHEET_NAMES.recurring}!A1:C`);
  const data = await sheetsFetch(`/values/${range}?valueRenderOption=UNFORMATTED_VALUE`);
  const rows = data.values || [];
  const items = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || !row[0]) continue;
    items.push({ id: String(r+1), name: String(row[0]??""), amount: String(row[1]??""), day: String(row[2]??"") });
  }
  return items;
}

async function appendRecurring(p) {
  const result = await sheetsFetch(`/values/${encodeURIComponent(`${SHEET_NAMES.recurring}!A1:C1`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
    method: "POST",
    body: JSON.stringify({ values: [[p.name, p.amount, p.day]] }),
  });
  return { id: rowFromUpdatedRange(result.updates?.updatedRange) };
}

async function editRecurring(p) {
  const rowNum = parseInt(p.id, 10);
  if (!(rowNum > 0)) return;
  await sheetsFetch(`/values/${encodeURIComponent(`${SHEET_NAMES.recurring}!A${rowNum}:C${rowNum}`)}?valueInputOption=USER_ENTERED`, {
    method: "PUT",
    body: JSON.stringify({ values: [[p.name, p.amount, p.day]] }),
  });
}

async function deleteRecurring(p) {
  const rowNum = parseInt(p.id, 10);
  if (!(rowNum > 0)) return;
  const gid = await getSheetGid(SHEET_NAMES.recurring);
  if (gid === undefined) throw new Error(`Sheet tab not found: ${SHEET_NAMES.recurring}`);
  await sheetsFetch(`:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      requests: [{ deleteDimension: { range: { sheetId: gid, dimension: "ROWS", startIndex: rowNum-1, endIndex: rowNum } } }],
    }),
  });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (!requireAuth(req, res)) return;

  try {
    let action, body;
    if (req.method === "GET") {
      action = req.query.action || "read";
      body = {};
    } else {
      body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
      action = body.action || "read";
    }

    let result = {};
    if (action === "read") result = { expenses: await readExpenses(SHEET_NAMES.credit) };
    else if (action === "append") result = await appendExpense(SHEET_NAMES.credit, body);
    else if (action === "edit") { await editExpense(SHEET_NAMES.credit, body); result = { ok:true }; }
    else if (action === "update") { await updateExpenseStatus(SHEET_NAMES.credit, body); result = { ok:true }; }
    else if (action === "delete") { await deleteRow(SHEET_NAMES.credit, body); result = { ok:true }; }

    else if (action === "debito-read") result = { expenses: await readExpenses(SHEET_NAMES.debit) };
    else if (action === "debito-append") result = await appendExpense(SHEET_NAMES.debit, body);
    else if (action === "debito-edit") { await editExpense(SHEET_NAMES.debit, body); result = { ok:true }; }
    else if (action === "debito-update") { await updateExpenseStatus(SHEET_NAMES.debit, body); result = { ok:true }; }
    else if (action === "debito-delete") { await deleteRow(SHEET_NAMES.debit, body); result = { ok:true }; }

    else if (action === "recurring-read") result = { items: await readRecurring() };
    else if (action === "recurring-append") result = await appendRecurring(body);
    else if (action === "recurring-edit") { await editRecurring(body); result = { ok:true }; }
    else if (action === "recurring-delete") { await deleteRecurring(body); result = { ok:true }; }

    else if (action === "cards-list") result = { cards: await listCards() };
    else if (action === "cards-add") result = await addCard(body);
    else if (action === "cards-edit") { await editCard(body.id, body); result = { ok:true }; }
    else if (action === "cards-delete") { await deleteCard(body.id); result = { ok:true }; }

    else if (action === "card-read") {
      const card = await getCard(req.method === "GET" ? req.query.cardId : body.cardId);
      if (!card) return res.status(404).json({ error: "card_not_found" });
      result = { expenses: await readExpenses(card.sheetTab) };
    }
    else if (action === "card-append") {
      const card = await getCard(body.cardId);
      if (!card) return res.status(404).json({ error: "card_not_found" });
      result = await appendExpense(card.sheetTab, body);
    }
    else if (action === "card-edit") {
      const card = await getCard(body.cardId);
      if (!card) return res.status(404).json({ error: "card_not_found" });
      await editExpense(card.sheetTab, body); result = { ok:true };
    }
    else if (action === "card-update") {
      const card = await getCard(body.cardId);
      if (!card) return res.status(404).json({ error: "card_not_found" });
      await updateExpenseStatus(card.sheetTab, body); result = { ok:true };
    }
    else if (action === "card-delete") {
      const card = await getCard(body.cardId);
      if (!card) return res.status(404).json({ error: "card_not_found" });
      await deleteRow(card.sheetTab, body); result = { ok:true };
    }

    else if (action === "rules-list") result = { rules: await listRules() };
    else if (action === "rules-add") result = await addRule(body);
    else if (action === "rules-edit") { await editRule(body.id, body); result = { ok:true }; }
    else if (action === "rules-delete") { await deleteRule(body.id); result = { ok:true }; }

    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
