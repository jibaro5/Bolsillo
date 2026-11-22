// Lo que cada quien le debe a la cuenta en conjunto (Omar y Shelsy), sin React ni red para poder probarlo aparte.
//
// En un gasto, "Alguien debe" anota a nombre de quién queda una parte que hay que reponer a la cuenta en conjunto.
// Solo cuentan Omar y Shelsy: lo que deba una tercera persona se cuadra aparte y no se muestra.

export const DEBTORS = ["Omar", "Shelsy"];

// Los nombres a mano no siempre vienen completos: en el Sheet Shelsy aparece como "Shel" (156 veces).
export function personOf(name) {
  const n = String(name || "").trim().toLowerCase();
  if (/^shel/.test(n)) return "Shelsy";
  if (n === "omar") return "Omar";
  return null;
}

// Cuánto de ese gasto está anotado a nombre de `who`.
export function debtOf(expense, who) {
  const owed = Array.isArray(expense.owed) ? expense.owed : [];
  return owed.reduce((sum, p) => (personOf(p.name) === who ? sum + (parseFloat(p.value) || 0) : sum), 0);
}

// Lo que Omar y Shelsy deben juntos en ese gasto.
export const debtTotalOf = expense => DEBTORS.reduce((sum, who) => sum + debtOf(expense, who), 0);

// Gastos con algo pendiente a nombre de `who` (los ya repuestos no cuentan).
export const pendingFor = (expenses, who) => expenses.filter(e => !e.paid && debtOf(e, who) > 0);
export const totalFor = (items, who) => items.reduce((sum, e) => sum + debtOf(e, who), 0);
