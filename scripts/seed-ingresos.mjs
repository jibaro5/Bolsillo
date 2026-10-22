// One-time: loads the salaries from the "Nido 1.0" sheet (gross and net per person) if none are set yet.
// Run:  node --env-file=.env.local scripts/seed-ingresos.mjs
import { listIncomes, setIncomes, getConfig } from "../lib/budgetStore.js";
import { rebuildBudgetView } from "../lib/budgetView.js";

if ((await listIncomes()).length) { console.log("Ya hay ingresos cargados; no se cambia nada."); process.exit(0); }
const rows = await setIncomes([
  { nombre: "Omar", bruto: 80000, neto: 72000 },
  { nombre: "Shelsy", bruto: "", neto: 40503.62 },
]);
console.log("Ingresos:", rows.map(r => `${r.nombre} bruto ${r.bruto === "" ? "-" : r.bruto} neto ${r.neto}`).join(" | "));
console.log("Neto Nido (config):", (await getConfig()).sueldoNetoAnual);
console.log("Vista:", JSON.stringify(await rebuildBudgetView()));
