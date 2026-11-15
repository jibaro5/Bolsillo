import { sheetsFetch, ensureSheetExists } from "./sheetsClient.js";
import { getCard } from "./cardsStore.js";

// Pagos hechos a las tarjetas de crédito. Cada uno es de una sola tarjeta y baja lo que se debe
// de su ciclo (y, por suma, el total de "Todas"). Se borra dejando la fila en blanco.
const SHEET_NAME = "Pagos";
const HEADER = ["id","cardId","fecha","monto","nota","registro","createdAt"];

async function ensureHeader() {
  await ensureSheetExists(SHEET_NAME);
  const check = await sheetsFetch(`/values/${encodeURIComponent(`${SHEET_NAME}!A1:G1`)}`);
  if ((check.values?.[0] || []).join("|") !== HEADER.join("|")) {
    await sheetsFetch(`/values/${encodeURIComponent(`${SHEET_NAME}!A1`)}?valueInputOption=USER_ENTERED`, {
      method: "PUT",
      body: JSON.stringify({ values: [HEADER] }),
    });
  }
}

async function readAllRows() {
  await ensureHeader();
  const data = await sheetsFetch(`/values/${encodeURIComponent(`${SHEET_NAME}!A2:G`)}?valueRenderOption=UNFORMATTED_VALUE`);
  return (data.values || []).map((row, i) => ({
    rowNum: i + 2,
    id: String(row[0] || ""),
    cardId: String(row[1] || ""),
    date: String(row[2] || ""),
    amount: Number(row[3]) || 0,
    note: String(row[4] || ""),
    by: String(row[5] || ""),
    createdAt: String(row[6] || ""),
  })).filter(r => r.id);
}

export async function listPagos() {
  const rows = await readAllRows();
  return rows
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
    .map(({ rowNum, createdAt, ...p }) => p);
}

// `by` viene de la sesión, nunca de lo que mande el cliente.
export async function addPago({ id, cardId, date, amount, note }, by) {
  if (!/^pay-[a-z0-9-]{1,40}$/i.test(String(id || ""))) throw new Error("id_invalido");
  if (!(await getCard(String(cardId || "")))) throw new Error("card_not_found");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) throw new Error("fecha_invalida");
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0 || n > 10_000_000) throw new Error("monto_invalido");
  const rows = await readAllRows();
  if (rows.some(r => r.id === id)) return { id, duplicated: true };   // el cliente reintentó: ya está guardado
  const clean = { id, cardId, date, amount: Math.round(n * 100) / 100, note: String(note || "").trim().slice(0, 120), by: String(by || "") };
  await sheetsFetch(`/values/${encodeURIComponent(`${SHEET_NAME}!A1:G1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: "POST",
    body: JSON.stringify({ values: [[clean.id, clean.cardId, clean.date, clean.amount, clean.note, clean.by, new Date().toISOString()]] }),
  });
  return clean;
}

export async function deletePago(id) {
  const rows = await readAllRows();
  const row = rows.find(r => r.id === id);
  if (!row) return;
  await sheetsFetch(`/values/${encodeURIComponent(`${SHEET_NAME}!A${row.rowNum}:G${row.rowNum}`)}?valueInputOption=RAW`, {
    method: "PUT",
    body: JSON.stringify({ values: [["", "", "", "", "", "", ""]] }),
  });
}
