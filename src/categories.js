// Las categorías de los gastos. Los gastos viejos pueden traer otras (Gas, Salud, Ocio, Compras, Viaje, Otro):
// no se reescriben en el Sheet; al sumar por categoría se cuentan como Misceláneo.
export const CATEGORIES = ["Comida", "Super", "Gastos fijos", "Free spending Omar", "Free spending Shelsy", "Misceláneo"];

// Incluye los iconos de las categorías viejas para que los gastos antiguos se sigan viendo igual.
export const CAT_EMOJI = {
  "Comida": "🍽️", "Super": "🛒", "Gastos fijos": "📅", "Free spending Omar": "💸", "Free spending Shelsy": "✨", "Misceláneo": "📦",
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
