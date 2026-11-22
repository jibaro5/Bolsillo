// El Dashboard y el Presupuesto piden los mismos datos del Sheet (6 lecturas cada vez, y Google deja pocas por minuto).
// Se guardan unos segundos en memoria; cualquier cambio al presupuesto la borra.
let cache = null;
export const getBudgetCache = (maxAgeMs = 45000) => (cache && Date.now() - cache.at < maxAgeMs ? cache.data : null);
export const setBudgetCache = data => { cache = { at: Date.now(), data }; };
export const clearBudgetCache = () => { cache = null; };
