// Lo que le toca a cada quien de un gasto (Omar y Shelsy), sin React ni red para poder probarlo aparte.
//
// Quien pagó se queda con el monto menos todo lo que otros le deben; cada persona nombrada en "Me deben"
// suma su parte. Lo que debe una tercera persona (Mamá, un amigo) no cuenta para ninguno de los dos.

export const PEOPLE = ["Omar", "Shelsy"];

// Los nombres a mano no siempre vienen completos: en el Sheet Shelsy aparece como "Shel" (156 veces).
export function personOf(name) {
  const n = String(name || "").trim().toLowerCase();
  if (/^shel/.test(n)) return "Shelsy";
  if (n === "omar") return "Omar";
  return null;
}

// Quién registró el gasto. Los viejos no tienen nombre (eran de Omar) y unos pocos traen un número en esa columna.
export const payerOf = by => personOf(by) || "Omar";

export function sharesOf(expense) {
  const shares = { Omar: 0, Shelsy: 0 };
  const owed = Array.isArray(expense.owed) ? expense.owed : [];
  let owedTotal = 0;
  for (const p of owed) {
    const amt = parseFloat(p.value) || 0;
    owedTotal += amt;
    const who = personOf(p.name);
    if (who) shares[who] += amt;
  }
  const amount = Number(expense.amount) || 0;
  shares[payerOf(expense.by)] += amount > 0 ? Math.max(0, amount - owedTotal) : amount - owedTotal;
  return shares;
}
