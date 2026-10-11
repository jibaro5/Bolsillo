import { sheetsFetch, ensureSheetExists, rowFromUpdatedRange } from "./sheetsClient.js";

// One "Reglas" tab lists every reward rule: which card gives a bonus rate
// on which category, for how long, and up to what spend cap. fechaInicio/
// fechaFin empty means "always active" (a permanent, non-rotating bonus);
// both set means a rotating-category window (e.g. a quarter).
const SHEET_NAME = "Reglas";
// periodo (appended last so existing rows stay valid): "" = use fechaInicio/fechaFin
// (or permanent), "trimestre" / "mes" = always active, cap resets every calendar
// quarter / month, computed by the app so nothing needs updating.
// grupo (appended after that): rules on the same card with the same non-empty
// grupo share ONE spend cap, counted across all of their categories together.
const HEADER = ["id","cardId","categoria","tasa","fechaInicio","fechaFin","tope","requiereActivacion","createdAt","periodo","grupo"];

async function ensureHeader() {
  await ensureSheetExists(SHEET_NAME);
  const check = await sheetsFetch(`/values/${encodeURIComponent(`${SHEET_NAME}!A1:K1`)}`);
  if ((check.values?.[0] || []).join("|") !== HEADER.join("|")) {
    await sheetsFetch(`/values/${encodeURIComponent(`${SHEET_NAME}!A1`)}?valueInputOption=USER_ENTERED`, {
      method: "PUT",
      body: JSON.stringify({ values: [HEADER] }),
    });
  }
}

function rowToRule(row, rowNum) {
  return {
    rowNum,
    id: row[0] || "",
    cardId: row[1] || "",
    categoria: row[2] || "",
    tasa: row[3] || "",
    fechaInicio: row[4] || "",
    fechaFin: row[5] || "",
    tope: row[6] || "",
    requiereActivacion: String(row[7]||"").trim().toUpperCase() === "SI",
    createdAt: row[8] || "",
    periodo: row[9] || "",
    grupo: row[10] || "",
  };
}

async function readAllRows() {
  await ensureHeader();
  const data = await sheetsFetch(`/values/${encodeURIComponent(`${SHEET_NAME}!A2:K`)}`);
  return (data.values || []).map((row, i) => rowToRule(row, i + 2)).filter(r => r.id);
}

function genId() {
  return `regla-${Date.now().toString(36)}${Math.random().toString(36).slice(2,6)}`;
}

export async function listRules() {
  return await readAllRows();
}

export async function addRule({ cardId, categoria, tasa, fechaInicio, fechaFin, tope, requiereActivacion, periodo, grupo }) {
  await ensureHeader();
  const id = genId();
  await sheetsFetch(`/values/${encodeURIComponent(`${SHEET_NAME}!A1:K1`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
    method: "POST",
    body: JSON.stringify({ values: [[id, cardId, categoria, String(tasa??""), fechaInicio||"", fechaFin||"", String(tope??""), requiereActivacion?"SI":"NO", new Date().toISOString(), periodo||"", grupo||""]] }),
  });
  return { id, cardId, categoria, tasa, fechaInicio, fechaFin, tope, requiereActivacion, periodo: periodo||"", grupo: grupo||"" };
}

export async function getRule(id) {
  const rows = await readAllRows();
  return rows.find(r => r.id === id) || null;
}

export async function editRule(id, fields) {
  const rule = await getRule(id);
  if (!rule) throw new Error("rule_not_found");
  const next = { ...rule, ...fields };
  await sheetsFetch(`/values/${encodeURIComponent(`${SHEET_NAME}!B${rule.rowNum}:K${rule.rowNum}`)}?valueInputOption=USER_ENTERED`, {
    method: "PUT",
    body: JSON.stringify({ values: [[next.cardId, next.categoria, String(next.tasa??""), next.fechaInicio||"", next.fechaFin||"", String(next.tope??""), next.requiereActivacion?"SI":"NO", rule.createdAt, next.periodo||"", next.grupo||""]] }),
  });
}

export async function deleteRule(id) {
  const rule = await getRule(id);
  if (!rule) return;
  await sheetsFetch(`/values/${encodeURIComponent(`${SHEET_NAME}!A${rule.rowNum}:K${rule.rowNum}`)}?valueInputOption=USER_ENTERED`, {
    method: "PUT",
    body: JSON.stringify({ values: [["", "", "", "", "", "", "", "", "", "", ""]] }),
  });
}
