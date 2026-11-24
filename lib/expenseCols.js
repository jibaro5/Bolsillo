// En el Sheet, las columnas D y E de un gasto son la categoría y lo que se debe, pero los gastos más viejos las
// traen cambiadas (lo que se debe en D, la categoría en E). Se distinguen por los números: una categoría nunca
// lleva dígitos y lo anotado en "Me deben" ("Shel: $78.17", "$20") siempre. Así no depende de la lista de
// categorías, que cambia (antes, una categoría nueva se leía como deuda y la deuda como categoría).
const looksOwed = s => /\d/.test(s);

export function splitCategoryOwed(colD, colE) {
  const d = String(colD ?? "").trim();
  const e = String(colE ?? "").trim();
  if (!d) return looksOwed(e) || !e ? { category: "", owed: e } : { category: e, owed: "" };
  if (looksOwed(d)) return looksOwed(e) ? { category: "", owed: e } : { category: e, owed: d };   // las dos con números: la categoría se perdió
  return { category: d, owed: e };
}
