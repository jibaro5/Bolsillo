// Pure budget math (no React, no I/O) so it can be tested offline.
//
// Each budget line stores its ANNUAL amount. Monthly = annual / 12 and
// biweekly = annual / 26 (26 paychecks a year), so the three views always agree.

export const KINDS = ["bisemanal", "mensual", "anual"];
export const PER_YEAR = { bisemanal: 26, mensual: 12, anual: 1 };
const MONTHS = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const MONTHS_SHORT = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];

const round2 = n => Math.round(n * 100) / 100;
const pad = n => String(n).padStart(2, "0");
const parse = s => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
const fmtUTC = ms => { const d = new Date(ms); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
const DAY = 86400000;

export const addDays = (s, n) => fmtUTC(parse(s) + n * DAY);

export const lineAmount = (anual, kind) => round2((Number(anual) || 0) / PER_YEAR[kind]);
export const annualFromPeriod = (amount, kind) => round2((Number(amount) || 0) * PER_YEAR[kind]);

function shortDate(s) {
  const [, m, d] = s.split("-").map(Number);
  return `${d} ${MONTHS_SHORT[m - 1]}`;
}

// The period of `kind` that contains `ref` (YYYY-MM-DD).
// Biweekly periods are 14 days long, counted from a real payday (`anchor`);
// without an anchor there is no way to know where they start, so it returns null.
export function budgetPeriod(kind, ref, anchor) {
  const [y, m] = ref.split("-").map(Number);
  if (kind === "mensual") {
    const start = `${y}-${pad(m)}-01`;
    const end = fmtUTC(Date.UTC(y, m, 0));
    return { kind, start, end, key: `${y}-${pad(m)}`, label: `${MONTHS[m - 1]} ${y}` };
  }
  if (kind === "anual") {
    return { kind, start: `${y}-01-01`, end: `${y}-12-31`, key: String(y), label: String(y) };
  }
  if (kind === "bisemanal") {
    if (!anchor) return null;
    const k = Math.floor((parse(ref) - parse(anchor)) / DAY / 14);
    const start = addDays(anchor, k * 14);
    const end = addDays(start, 13);
    return { kind, start, end, key: start, label: `${shortDate(start)} – ${shortDate(end)}` };
  }
  return null;
}

// Previous (dir = -1) or next (dir = +1) period.
export function shiftPeriod(period, dir, anchor) {
  if (period.kind === "mensual") {
    const [y, m] = period.start.split("-").map(Number);
    return budgetPeriod("mensual", fmtUTC(Date.UTC(y, m - 1 + dir, 1)), anchor);
  }
  if (period.kind === "anual") {
    const y = Number(period.start.slice(0, 4)) + dir;
    return budgetPeriod("anual", `${y}-01-01`, anchor);
  }
  return budgetPeriod("bisemanal", addDays(period.start, dir * 14), anchor);
}

// What the user really spent on a line's categories inside a period: every
// expense (all cards + débito) in those categories, minus what other people
// owe back. A category that isn't mapped to the line counts for nothing.
export function spentFor(categorias, expenses, period, owedFn = () => 0) {
  if (!categorias || !categorias.length || !period) return 0;
  const set = new Set(categorias.map(c => c.trim().toLowerCase()));
  let total = 0;
  for (const e of expenses) {
    if (!e.date || e.date < period.start || e.date > period.end) continue;
    if (!set.has(String(e.category || "Otro").trim().toLowerCase())) continue;
    total += (Number(e.amount) || 0) - owedFn(e);
  }
  return round2(total);
}

// Traffic light for a progress bar: green < 80 %, amber 80–100 %, red > 100 %.
export function budgetStatus(spent, budget) {
  if (budget <= 0) return spent > 0 ? "over" : "ok";
  const r = spent / budget;
  return r > 1 ? "over" : r >= 0.8 ? "warn" : "ok";
}

// Totals per group and overall, for a period kind.
export function planTotals(lines, kind, sueldoNetoAnual) {
  const byGroup = { esencial: 0, no_esencial: 0, ahorro: 0 };
  for (const l of lines) byGroup[l.grupo] = (byGroup[l.grupo] || 0) + (Number(l.anual) || 0);
  const planAnual = byGroup.esencial + byGroup.no_esencial + byGroup.ahorro;
  const conv = a => lineAmount(a, kind);
  return {
    groups: { esencial: conv(byGroup.esencial), no_esencial: conv(byGroup.no_esencial), ahorro: conv(byGroup.ahorro) },
    plan: conv(planAnual),
    sueldo: conv(sueldoNetoAnual),
    sinAsignar: conv((Number(sueldoNetoAnual) || 0) - planAnual),
  };
}

// A category may belong to only one line, otherwise one expense would count
// twice. Returns the lines (other than `exceptId`) already using any of `cats`.
export function categoryConflicts(lines, cats, exceptId) {
  const mine = new Set(cats.map(c => c.toLowerCase()));
  return lines
    .filter(l => l.id !== exceptId)
    .map(l => ({ line: l, cats: l.categorias.filter(c => mine.has(c.toLowerCase())) }))
    .filter(x => x.cats.length);
}

// Drag and drop: moves a line to `grupo`, right before `beforeId` (or at the end of that group when
// beforeId is null) and renumbers `orden` 1..N in display order (Esenciales, No esenciales, Ahorro).
const GROUP_ORDER = ["esencial", "no_esencial", "ahorro"];
export function moveLine(lines, id, grupo, beforeId = null) {
  const moving = lines.find(l => l.id === id);
  if (!moving || !GROUP_ORDER.includes(grupo)) return lines;
  const byGroup = Object.fromEntries(GROUP_ORDER.map(g => [g, lines.filter(l => l.id !== id && l.grupo === g)]));
  const item = { ...moving, grupo };
  const target = byGroup[grupo];
  const at = beforeId && beforeId !== id ? target.findIndex(l => l.id === beforeId) : -1;
  if (beforeId === id) {
    // dropped back on itself: keep its place
    const own = lines.filter(l => l.grupo === moving.grupo);
    byGroup[moving.grupo] = [...byGroup[moving.grupo]];
    byGroup[moving.grupo].splice(own.findIndex(l => l.id === id), 0, item);
  } else if (at >= 0) target.splice(at, 0, item);
  else target.push(item);
  return GROUP_ORDER.flatMap(g => byGroup[g]).map((l, i) => ({ ...l, orden: i + 1 }));
}
