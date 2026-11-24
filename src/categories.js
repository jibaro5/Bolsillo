import { DEBTORS, debtOf } from "./shares.js";

// Las categorías de los gastos. Los gastos viejos pueden traer otras (Gas, Salud, Ocio, Compras, Viaje, Otro):
// no se reescriben en el Sheet; al sumar por categoría se cuentan como Misceláneo.
export const CATEGORIES = ["Comida", "Super", "Gastos fijos", "Free spending Omar", "Free spending Shelsy", "Misceláneo"];

// Incluye los iconos de las categorías viejas para que los gastos antiguos se sigan viendo igual.
export const CAT_EMOJI = {
  "Comida": "🍽️", "Super": "🛒", "Gastos fijos": "📅", "Free spending Omar": "🥸", "Free spending Shelsy": "👩", "Misceláneo": "📦",
  "Gas": "⛽", "Ocio": "🎬", "Viaje": "✈️", "Salud": "🏥", "Compras": "🛍️", "Otro": "📦",
};

// Cómo viene guardada ("Comida", "🍽️ Comida", "comida", "Gas") -> una de las categorías de arriba.
export function canonCategory(c) {
  const t = String(c || "").trim().toLowerCase();
  if (!t) return "Misceláneo";
  return CATEGORIES.find(k => t === k.toLowerCase() || t.endsWith(` ${k.toLowerCase()}`)) || "Misceláneo";
}

// Para comparar la categoría de una línea del presupuesto con una de la lista (sin convertir las viejas).
export const sameCategory = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

export const FREE_SPENDING = { Omar: "Free spending Omar", Shelsy: "Free spending Shelsy" };

// En qué categorías cae un gasto: lo que Omar o Shelsy deben a la cuenta (su gasto personal) va al free spending de
// cada quien, y lo demás se queda en la categoría del gasto. Lo que deba una tercera persona no se aparta.
// Devuelve [{ cat, amount }] y las partes suman el monto del gasto.
export function splitByCategory(expense) {
  const amount = Number(expense.amount) || 0;
  const parts = [];
  let rest = amount;
  for (const who of DEBTORS) {
    const d = Math.min(debtOf(expense, who), Math.max(rest, 0));
    if (d > 0) { parts.push({ cat: FREE_SPENDING[who], amount: d }); rest -= d; }
  }
  if (parts.length === 0 || Math.abs(rest) > 0.005) parts.push({ cat: canonCategory(expense.category), amount: rest });
  return parts;
}
