// Lo que cada quien le debe a la cuenta en conjunto (Omar y Shelsy), sin React ni red para poder probarlo aparte.
//
// Un gasto categorizado en el Free spending de alguien, o con una parte anotada a su nombre en "Alguien debe", es lo que esa
// persona le debe a la cuenta en conjunto hasta que se marque como repuesto.
// Solo cuentan Omar y Shelsy: lo que deba una tercera persona se cuadra aparte y no se muestra.

export const DEBTORS = ["Omar", "Shelsy"];

// Los nombres a mano no siempre vienen completos: en el Sheet Shelsy aparece como "Shel" (156 veces).
export function personOf(name) {
  const n = String(name || "").trim().toLowerCase();
  if (/^shel/.test(n)) return "Shelsy";
  if (n === "omar") return "Omar";
  return null;
}

// De quién es el free spending en el que está categorizado un gasto ("Free spending Omar", con o sin emoji delante).
export function freeSpendingOwner(category) {
  const c = String(category || "").trim().toLowerCase();
  if (c.endsWith("free spending omar")) return "Omar";
  if (c.endsWith("free spending shelsy")) return "Shelsy";
  return null;
}

// Lo anotado en "Alguien debe a la cuenta" a nombre de `who`.
const explicitDebt = (expense, who) => (Array.isArray(expense.owed) ? expense.owed : [])
  .reduce((sum, p) => (personOf(p.name) === who ? sum + (parseFloat(p.value) || 0) : sum), 0);

// Cuánto le debe `who` a la cuenta en conjunto por ese gasto. Cuenta en dos casos:
//  1. el gasto está categorizado en el Free spending de esa persona: es todo suyo, salvo lo que se anote que otros deben;
//  2. en el gasto se anota que esa persona debe una parte.
export function debtOf(expense, who) {
  const amount = Number(expense.amount) || 0;
  if (amount > 0 && freeSpendingOwner(expense.category) === who) {
    const others = (Array.isArray(expense.owed) ? expense.owed : [])
      .reduce((sum, p) => (personOf(p.name) === who ? sum : sum + (parseFloat(p.value) || 0)), 0);
    return Math.max(0, amount - others);
  }
  return explicitDebt(expense, who);
}

// Lo que Omar y Shelsy deben juntos en ese gasto.
export const debtTotalOf = expense => DEBTORS.reduce((sum, who) => sum + debtOf(expense, who), 0);

// Gastos con algo pendiente a nombre de `who` (los ya repuestos no cuentan).
export const pendingFor = (expenses, who) => expenses.filter(e => !e.paid && debtOf(e, who) > 0);
export const totalFor = (items, who) => items.reduce((sum, e) => sum + debtOf(e, who), 0);
