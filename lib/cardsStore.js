import { sheetsFetch, ensureSheetExists, rowFromUpdatedRange } from "./sheetsClient.js";

// One "Tarjetas" tab lists every credit card the app knows about. Each row
// points at its own expenses tab via sheetTab. Débito isn't in here — it
// stays the separate, fixed account it's always been.
const SHEET_NAME = "Tarjetas";
const HEADER = ["id","nombre","color","sheetTab","cierreDay","dueDay","createdAt"];

// Discover already has 283+ real rows in "Credit Card". Seeding this row
// (instead of migrating that data into a freshly-named tab) means the
// existing tarjeta/gastos need zero migration.
const SEED_CARD = { id: "discover", nombre: "Discover", color: "#0f4c81", sheetTab: "Credit Card", cierreDay: "20", dueDay: "17" };

async function ensureHeader() {
  await ensureSheetExists(SHEET_NAME);
  const check = await sheetsFetch(`/values/${encodeURIComponent(`${SHEET_NAME}!A1`)}`);
  const hasHeader = check.values && check.values[0]?.[0] === "id";
  if (!hasHeader) {
    await sheetsFetch(`/values/${encodeURIComponent(`${SHEET_NAME}!A1`)}?valueInputOption=USER_ENTERED`, {
      method: "PUT",
      body: JSON.stringify({ values: [HEADER] }),
    });
  }
}

function rowToCard(row, rowNum) {
  return {
    rowNum,
    id: row[0] || "",
    nombre: row[1] || "",
    color: row[2] || "",
    sheetTab: row[3] || "",
    cierreDay: row[4] || "",
    dueDay: row[5] || "",
    createdAt: row[6] || "",
  };
}

async function readAllRows() {
  await ensureHeader();
  const data = await sheetsFetch(`/values/${encodeURIComponent(`${SHEET_NAME}!A2:G`)}`);
  return (data.values || []).map((row, i) => rowToCard(row, i + 2)).filter(r => r.id);
}

function slugify(name) {
  const base = String(name).toLowerCase().trim()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${base || "tarjeta"}-${Date.now().toString(36).slice(-4)}`;
}

export async function listCards() {
  const rows = await readAllRows();
  if (rows.length === 0) {
    await addCardRow(SEED_CARD);
    return [{ ...SEED_CARD, rowNum: 2, createdAt: new Date().toISOString() }];
  }
  return rows;
}

async function addCardRow(card) {
  await ensureHeader();
  const result = await sheetsFetch(`/values/${encodeURIComponent(`${SHEET_NAME}!A1:G1`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
    method: "POST",
    body: JSON.stringify({ values: [[card.id, card.nombre, card.color||"", card.sheetTab, String(card.cierreDay??""), String(card.dueDay??""), new Date().toISOString()]] }),
  });
  return rowFromUpdatedRange(result.updates?.updatedRange);
}

export async function addCard({ nombre, color, cierreDay, dueDay }) {
  const id = slugify(nombre);
  const sheetTab = `Tarjeta ${nombre}`.slice(0, 90);
  await ensureSheetExists(sheetTab);
  await addCardRow({ id, nombre, color, sheetTab, cierreDay, dueDay });
  return { id, nombre, color, sheetTab, cierreDay, dueDay };
}

export async function getCard(id) {
  const rows = await listCards();
  return rows.find(r => r.id === id) || null;
}

export async function editCard(id, fields) {
  const card = await getCard(id);
  if (!card) throw new Error("card_not_found");
  const next = { ...card, ...fields };
  await sheetsFetch(`/values/${encodeURIComponent(`${SHEET_NAME}!B${card.rowNum}:F${card.rowNum}`)}?valueInputOption=USER_ENTERED`, {
    method: "PUT",
    body: JSON.stringify({ values: [[next.nombre, next.color||"", next.sheetTab, String(next.cierreDay??""), String(next.dueDay??"")]] }),
  });
}

// Only removes the card from the list — its expenses tab and data are left
// alone, so deleting a card can never silently destroy historical spend.
export async function deleteCard(id) {
  const card = await getCard(id);
  if (!card) return;
  await sheetsFetch(`/values/${encodeURIComponent(`${SHEET_NAME}!A${card.rowNum}:G${card.rowNum}`)}?valueInputOption=USER_ENTERED`, {
    method: "PUT",
    body: JSON.stringify({ values: [["", "", "", "", "", "", ""]] }),
  });
}
