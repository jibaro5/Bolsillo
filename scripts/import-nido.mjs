// Replaces the budget lines with the household budget "Nido 1.0" (Excel, annual column).
// Run locally:  node --env-file=.env.local scripts/import-nido.mjs --yes
// First copies the current lines to a "Presupuesto Omar (respaldo)" tab (only if that tab doesn't exist yet),
// so the previous budget can always be restored. Then rewrites "Presupuesto", sets the household net income
// and rebuilds the Drive view.
import { sheetsFetch, ensureSheetExists, getSheetGid } from "../lib/sheetsClient.js";
import { listLines, getConfig, setConfig } from "../lib/budgetStore.js";
import { rebuildBudgetView } from "../lib/budgetView.js";

if (!process.argv.includes("--yes")) { console.log("Falta --yes: esto reemplaza las líneas del presupuesto."); process.exit(1); }

const L = (grupo, nombre, anual, categorias = [], nota = "") => ({ grupo, nombre, anual, categorias, nota });
const LINES = [
  // Esenciales
  L("esencial", "Renta", 10620, ["Gastos fijos"]),
  L("esencial", "Luz", 1920),
  L("esencial", "Agua", 358.56),
  L("esencial", "Internet", 515.88),
  L("esencial", "Phone", 960),
  L("esencial", "Groceries", 7800, ["Super"]),
  L("esencial", "Carro Shelsy", 0),
  L("esencial", "Carro Omar", 0),
  L("esencial", "Gasolina carro", 519.96),
  L("esencial", "Gasolina guagua", 2340, ["Gas"]),
  L("esencial", "Maintenance (Aceite y filtro)", 340),
  L("esencial", "Peaje", 780),
  L("esencial", "Marbete", 440),
  L("esencial", "Malpractice", 0, [], "$775 fue la renovación en 2025. El año que viene se paga a plazos y lo añado al budget"),
  L("esencial", "Seguro Médico", 1248),
  L("esencial", "Plan Médico Luna", 420),
  L("esencial", "Comida Luna", 249.72),
  L("esencial", "Preventivo Luna", 420),
  L("esencial", "Préstamo Shelsy", 8032.44),
  L("esencial", "Préstamo Omar", 4800),
  // No esenciales
  L("no_esencial", "FICA taxes (federales)", 8000),
  L("no_esencial", "Recorte Omar", 598),
  L("no_esencial", "Uñas Shelsy", 720),
  L("no_esencial", "Gym", 1949.04),
  L("no_esencial", "Entertainment (Free spending)", 7800, ["Ocio", "Compras", "Otro"]),
  L("no_esencial", "Comida afuera", 11844, ["Comida"]),
  L("no_esencial", "Membresía Costco", 72.54),
  L("no_esencial", "Spotify", 173.76),
  L("no_esencial", "Netflix", 106.92),
  L("no_esencial", "HBO Max", 39.96),
  L("no_esencial", "Servicio Carretera guagua", 71.88),
  // Ahorro e inversión
  L("ahorro", "Ahorro Oficina", 17100),
  L("ahorro", "Vacaciones", 0),
  L("ahorro", "HYSA Shel", 8400),
  L("ahorro", "Inversión Shel", 4260),
  L("ahorro", "Inversiones", 9600),
];
const NET_INCOME = 112504;   // Sueldo Neto Nido

// 1. Back up what's there now.
const BACKUP = "Presupuesto Omar (respaldo)";
const before = await listLines();
const cfgBefore = await getConfig();
if ((await getSheetGid(BACKUP)) === undefined) {
  await ensureSheetExists(BACKUP);
  const rows = [["id", "grupo", "nombre", "anual", "categorias", "nota", "orden", "sueldoNetoAnual (config)"],
    ...before.map((l, i) => [l.id, l.grupo, l.nombre, l.anual, l.categorias.join(","), l.nota, l.orden, i === 0 ? cfgBefore.sueldoNetoAnual : ""])];
  await sheetsFetch(`/values/${encodeURIComponent(`'${BACKUP}'!A1`)}?valueInputOption=RAW`, { method: "PUT", body: JSON.stringify({ values: rows }) });
  console.log(`Respaldo: ${before.length} líneas copiadas a "${BACKUP}".`);
} else {
  console.log(`Ya existe "${BACKUP}"; no se sobrescribe.`);
}

// 2. Rewrite the lines in one write.
await sheetsFetch(`/values/${encodeURIComponent("Presupuesto!A2:H")}:clear`, { method: "POST", body: "{}" });
const stamp = Date.now();
const rows = LINES.map((l, i) => [`ppto-${(stamp + i).toString(36)}${Math.random().toString(36).slice(2, 6)}`, l.grupo, l.nombre, l.anual, l.categorias.join(","), l.nota, i + 1, new Date().toISOString()]);
await sheetsFetch(`/values/${encodeURIComponent("Presupuesto!A2")}?valueInputOption=RAW`, { method: "PUT", body: JSON.stringify({ values: rows }) });

// 3. Household income + title, then the Drive view.
await setConfig({ sueldoNetoAnual: NET_INCOME, titulo: "Presupuesto · Nido" });
const total = LINES.reduce((s, l) => s + l.anual, 0);
console.log(`Importadas ${LINES.length} líneas. Total anual: ${total.toFixed(2)} · ingreso neto ${NET_INCOME} · sin asignar ${(NET_INCOME - total).toFixed(2)}`);
console.log("Vista Drive:", JSON.stringify(await rebuildBudgetView()));
