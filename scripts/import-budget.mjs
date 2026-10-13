// One-time import of the "Omar 1.0" budget (Excel) into Bolsillo's Sheet.
// Run locally:  node --env-file=.env.local scripts/import-budget.mjs
// Idempotent: does nothing if the "Presupuesto" tab already has lines.
// Amounts are the ANNUAL column; categories map a line to Bolsillo expenses.
import { listLines, addLine, getConfig, setConfig } from "../lib/budgetStore.js";

const L = (grupo, nombre, anual, categorias = [], nota = "") => ({ grupo, nombre, anual, categorias, nota });
const LINES = [
  L("esencial", "Renta", 10800),
  L("esencial", "Phone", 480),
  L("esencial", "Groceries", 3900, ["Super"]),
  L("esencial", "Carro Omar", 0),
  L("esencial", "Gasolina guagua", 2340, ["Gas"]),
  L("esencial", "Maintenance (Aceite y filtro)", 340),
  L("esencial", "Peaje", 780),
  L("esencial", "Marbete", 440),
  L("esencial", "Malpractice", 0, [], "$775 fue la renovación en 2025. El año que viene se paga a plazos y lo añado al budget"),
  L("esencial", "Seguro Médico", 600),
  L("esencial", "Préstamo Omar", 0),
  L("no_esencial", "FICA taxes (federales)", 8500),
  L("no_esencial", "Personal Grooming", 598),
  L("no_esencial", "Gym", 1560),
  L("no_esencial", "Entertainment (Free spending)", 5200, ["Ocio", "Compras", "Otro"]),
  L("no_esencial", "Comida afuera", 5850, ["Comida"]),
  L("no_esencial", "Membresía Costco", 72.54),
  L("no_esencial", "Spotify", 173.76),
  L("no_esencial", "Netflix", 106.92),
  L("no_esencial", "HBO Max", 39.96),
  L("no_esencial", "Servicio Carretera guagua", 71.88),
  L("ahorro", "Ahorro Oficina (HYSA)", 27108),
  L("ahorro", "Vacaciones", 2860),
  L("ahorro", "Inversiones", 0),
];

const existing = await listLines();
if (existing.length) {
  console.log(`"Presupuesto" ya tiene ${existing.length} líneas; no se importa nada.`);
  process.exit(0);
}
for (const l of LINES) await addLine(l);
const cfg = await getConfig();
if (!cfg.sueldoNetoAnual) await setConfig({ sueldoNetoAnual: 72000 });
const total = LINES.reduce((s, l) => s + l.anual, 0);
console.log(`Importadas ${LINES.length} líneas. Total anual planificado: ${total.toFixed(2)} (sueldo neto 72000).`);
