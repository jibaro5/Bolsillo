import { sheetsFetch, ensureSheetExists } from "./sheetsClient.js";

// The budget lives in two small tabs:
//  - "Presupuesto": one row per budget line (rent, groceries, savings...).
//  - "PresupuestoConfig": key/value settings (net salary, a real payday).
// Each line stores only its ANNUAL amount; monthly (/12) and biweekly (/26)
// are derived in the app, so the three views can never drift apart.
const SHEET_NAME = "Presupuesto";
const CONFIG_SHEET = "PresupuestoConfig";
// grupo: esencial | no_esencial | ahorro. categorias: comma-separated Bolsillo
// categories whose expenses count against this line (empty = not measured).
const HEADER = ["id","grupo","nombre","anual","categorias","nota","orden","createdAt"];
const CONFIG_HEADER = ["clave","valor"];
export const GRUPOS = ["esencial", "no_esencial", "ahorro"];

async function ensureHeader(sheet, header, range) {
  await ensureSheetExists(sheet);
  const check = await sheetsFetch(`/values/${encodeURIComponent(`${sheet}!${range}`)}`);
  if ((check.values?.[0] || []).join("|") !== header.join("|")) {
    await sheetsFetch(`/values/${encodeURIComponent(`${sheet}!A1`)}?valueInputOption=USER_ENTERED`, {
      method: "PUT",
      body: JSON.stringify({ values: [header] }),
    });
  }
}

const cleanCats = v => (Array.isArray(v) ? v : String(v || "").split(","))
  .map(s => String(s).trim()).filter(Boolean);

function rowToLine(row, rowNum) {
  return {
    rowNum,
    id: row[0] || "",
    grupo: GRUPOS.includes(row[1]) ? row[1] : "no_esencial",
    nombre: row[2] || "",
    anual: Number(row[3]) || 0,
    categorias: cleanCats(row[4]),
    nota: row[5] || "",
    orden: Number(row[6]) || 0,
    createdAt: row[7] || "",
  };
}

async function readAllRows() {
  await ensureHeader(SHEET_NAME, HEADER, "A1:H1");
  const data = await sheetsFetch(`/values/${encodeURIComponent(`${SHEET_NAME}!A2:H`)}?valueRenderOption=UNFORMATTED_VALUE`);
  return (data.values || []).map((row, i) => rowToLine(row, i + 2)).filter(r => r.id);
}

const genId = () => `ppto-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

function validate({ grupo, nombre, anual }) {
  if (!String(nombre || "").trim()) throw new Error("nombre_requerido");
  if (!GRUPOS.includes(grupo)) throw new Error("grupo_invalido");
  const n = Number(anual);
  if (!Number.isFinite(n) || n < 0 || n > 10_000_000) throw new Error("monto_invalido");
}

export async function listLines() {
  const rows = await readAllRows();
  return rows.sort((a, b) => a.orden - b.orden || a.rowNum - b.rowNum);
}

export async function addLine({ grupo, nombre, anual, categorias, nota, orden }) {
  validate({ grupo, nombre, anual });
  const rows = await readAllRows();
  const id = genId();
  const ord = orden != null && orden !== "" ? Number(orden) : (rows.reduce((m, r) => Math.max(m, r.orden), 0) + 1);
  const line = { id, grupo, nombre: String(nombre).trim(), anual: round2(anual), categorias: cleanCats(categorias), nota: nota || "", orden: ord, createdAt: new Date().toISOString() };
  await sheetsFetch(`/values/${encodeURIComponent(`${SHEET_NAME}!A1:H1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: "POST",
    body: JSON.stringify({ values: [[line.id, line.grupo, line.nombre, line.anual, line.categorias.join(","), line.nota, line.orden, line.createdAt]] }),
  });
  return line;
}

export async function editLine(id, fields) {
  const rows = await readAllRows();
  const line = rows.find(r => r.id === id);
  if (!line) throw new Error("line_not_found");
  const next = { ...line, ...fields };
  validate(next);
  await sheetsFetch(`/values/${encodeURIComponent(`${SHEET_NAME}!B${line.rowNum}:G${line.rowNum}`)}?valueInputOption=RAW`, {
    method: "PUT",
    body: JSON.stringify({ values: [[next.grupo, String(next.nombre).trim(), round2(next.anual), cleanCats(next.categorias).join(","), next.nota || "", Number(next.orden) || 0]] }),
  });
  // Amounts and names reach the Drive view by formula; a move to another group or position changes its layout.
  return { structural: line.grupo !== next.grupo || (Number(line.orden) || 0) !== (Number(next.orden) || 0) };
}

export async function deleteLine(id) {
  const rows = await readAllRows();
  const line = rows.find(r => r.id === id);
  if (!line) return;
  await sheetsFetch(`/values/${encodeURIComponent(`${SHEET_NAME}!A${line.rowNum}:H${line.rowNum}`)}?valueInputOption=RAW`, {
    method: "PUT",
    body: JSON.stringify({ values: [["", "", "", "", "", "", "", ""]] }),
  });
}

// ---- config (key/value) ----
const CONFIG_KEYS = { sueldoNetoAnual: "number", anclaPago: "date", titulo: "text" };
const DEFAULT_CONFIG = { sueldoNetoAnual: 0, anclaPago: "", titulo: "" };

export async function getConfig() {
  await ensureHeader(CONFIG_SHEET, CONFIG_HEADER, "A1:B1");
  const data = await sheetsFetch(`/values/${encodeURIComponent(`${CONFIG_SHEET}!A2:B`)}?valueRenderOption=UNFORMATTED_VALUE`);
  const cfg = { ...DEFAULT_CONFIG };
  for (const [k, v] of data.values || []) {
    if (k === "sueldoNetoAnual") cfg.sueldoNetoAnual = Number(v) || 0;
    else if (k === "anclaPago") cfg.anclaPago = String(v || "");
    else if (k === "titulo") cfg.titulo = String(v || "");
  }
  return cfg;
}

export async function setConfig(fields) {
  const patch = {};
  for (const [k, type] of Object.entries(CONFIG_KEYS)) {
    if (!(k in fields)) continue;
    const v = fields[k];
    if (type === "number") {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 100_000_000) throw new Error("config_invalida");
      patch[k] = n;
    } else if (type === "text") {
      patch[k] = String(v ?? "").trim().slice(0, 60);
    } else {
      if (v !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw new Error("config_invalida");
      patch[k] = String(v);
    }
  }
  await ensureHeader(CONFIG_SHEET, CONFIG_HEADER, "A1:B1");
  const data = await sheetsFetch(`/values/${encodeURIComponent(`${CONFIG_SHEET}!A2:B`)}?valueRenderOption=UNFORMATTED_VALUE`);
  const existing = data.values || [];
  for (const [k, v] of Object.entries(patch)) {
    const idx = existing.findIndex(r => r[0] === k);
    if (idx >= 0) {
      await sheetsFetch(`/values/${encodeURIComponent(`${CONFIG_SHEET}!B${idx + 2}`)}?valueInputOption=RAW`, {
        method: "PUT", body: JSON.stringify({ values: [[v]] }),
      });
    } else {
      await sheetsFetch(`/values/${encodeURIComponent(`${CONFIG_SHEET}!A1:B1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
        method: "POST", body: JSON.stringify({ values: [[k, v]] }),
      });
      existing.push([k, v]);
    }
  }
}
