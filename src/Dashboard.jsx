import { useState, useEffect, useMemo } from "react";
import { lineAmount, budgetPeriod, budgetStatus } from "./budgetMath.js";
import { pendingFor, totalFor } from "./shares.js";
import { CATEGORIES, splitByCategory, sameCategory } from "./categories.js";
import { getBudgetCache, setBudgetCache } from "./budgetCache.js";

// Dashboard: budget proportions (doughnut), spending so far this month by
// category, best card today, the three money tiles (por pagar, gastos de Omar y de Shelsy) and last month's summary.
// Everything is computed from the expenses the app already loaded (all cards +
// débito); only the budget doughnut needs one extra call.

const MONTHS = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const CAT_COLORS = {
  "Comida": "#f59e0b", "Super": "#10b981", "Gastos fijos": "#64748b",
  "Free spending Omar": "#3b82f6", "Free spending Shelsy": "#ec4899", "Misceláneo": "#94a3b8",
};
const STATUS_COLOR = { ok: "#16a34a", warn: "#d97706", over: "#dc2626" };
const GROUP_SLICES = [
  { id: "esencial", label: "Esenciales", color: "#0f4c81" },
  { id: "no_esencial", label: "No esenciales", color: "#b45309" },
  { id: "ahorro", label: "Ahorro e inversión", color: "#059669" },
];

const monthKey = (dateStr, offset = 0) => {
  const [y, m] = dateStr.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + offset, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
const monthName = key => { const [y, m] = key.split("-").map(Number); return `${MONTHS[m - 1]} ${y}`; };
// Doughnut (hole 50 %, percentage labels inside the ring), like the chart in the sheet.
export function Donut({ slices, center, size = 150 }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const R = 56, r = 28, mid = (R + r) / 2, sw = R - r, C = 2 * Math.PI * mid;
  let acc = 0;
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} role="img" aria-label="Gráfica de proporciones" style={{ flexShrink: 0 }}>
      <circle cx="60" cy="60" r={mid} fill="none" stroke="#f1f5f9" strokeWidth={sw} />
      {total > 0 && slices.map((s, i) => {
        const frac = s.value / total;
        const len = frac * C;
        const start = acc; acc += len;
        const angle = ((start + len / 2) / C) * 2 * Math.PI - Math.PI / 2;
        return (
          <g key={s.label}>
            <circle cx="60" cy="60" r={mid} fill="none" stroke={s.color} strokeWidth={sw}
              strokeDasharray={`${Math.max(len - (slices.length > 1 ? 0.8 : 0), 0)} ${C}`} strokeDashoffset={-start}
              transform="rotate(-90 60 60)" />
            {frac >= 0.06 && (
              <text x={60 + mid * Math.cos(angle)} y={60 + mid * Math.sin(angle)} fontSize="8" fontWeight="700" fill="#fff" textAnchor="middle" dominantBaseline="central">
                {Math.round(frac * 100)}%
              </text>
            )}
          </g>
        );
      })}
      {center && (
        <>
          <text x="60" y="56" fontSize="6" fill="#94a3b8" textAnchor="middle">{center.top}</text>
          <text x="60" y="66" fontSize="9" fontWeight="700" fill="#0f172a" textAnchor="middle">{center.main}</text>
        </>
      )}
    </svg>
  );
}

function Legend({ slices, fmt }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  return (
    <div style={{ width: "100%", minWidth: 0 }}>
      {slices.map(s => (
        <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 12 }}>
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: s.color, flexShrink: 0 }} />
          <span style={{ flex: 1, minWidth: 0, color: "#334155", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.emoji ? `${s.emoji} ` : ""}{s.label}</span>
          <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmt(s.value)}</span>
          <span style={{ width: 34, textAlign: "right", color: "#94a3b8", fontSize: 11 }}>{total > 0 ? Math.round(s.value / total * 100) : 0}%</span>
        </div>
      ))}
    </div>
  );
}

// "Mejor tarjeta hoy": which card to use per category (also shown on Inicio).
export function BestCardWidget({ recommendations, cards, fmt, catEmoji, bare }) {
  if (!recommendations.length) return null;
  return (
    <div id="mejor-tarjeta" className={bare ? undefined : "card"} style={bare ? undefined : { padding: 14, marginBottom: 16 }}>
      {!bare && <div style={{ fontSize: 11, letterSpacing: 1, color: "#94a3b8", fontWeight: 700, marginBottom: 10 }}>💳 MEJOR TARJETA HOY</div>}
      {recommendations.map(rec => {
        const bestCard = cards.find(c => c.id === rec.best.cardId);
        const pct = rec.best.tope > 0 ? Math.min(100, Math.round(rec.best.spent / rec.best.tope * 100)) : null;
        return (
          <div key={rec.categoria} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid #f1f5f9" }}>
            <div style={{ fontSize: 18, width: 22, textAlign: "center" }}>{catEmoji[rec.categoria] || "📦"}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{rec.categoria}</div>
              <div style={{ fontSize: 11, color: "#94a3b8", display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: bestCard?.color || "#0f4c81", display: "inline-block", flexShrink: 0 }}></span>
                {bestCard?.nombre || rec.best.cardId}
                {rec.best.requiereActivacion && <span className="badge badge-amber" style={{ fontSize: 8, padding: "1px 6px" }}>Activar</span>}
              </div>
              {pct !== null && (
                <div style={{ marginTop: 4, height: 4, background: "#f1f5f9", borderRadius: 2, overflow: "hidden", width: 120 }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: pct >= 100 ? "#dc2626" : pct >= 80 ? "#b45309" : "#0f4c81" }}></div>
                </div>
              )}
              {pct !== null && <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>{fmt(rec.best.spent)} de {fmt(rec.best.tope)}{rec.best.shared ? " (tope compartido)" : ""}</div>}
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: rec.best.overCap ? "#dc2626" : "#059669" }}>{rec.best.effectiveRate}%</div>
              {rec.best.overCap && <div style={{ fontSize: 9, color: "#dc2626" }}>tope alcanzado</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Card whose body folds away when you tap its heading (state kept by the parent).
function Collapse({ title, summary, open, onToggle, go, children }) {
  return (
    <div className="card" style={{ padding: 14, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button onClick={onToggle} aria-expanded={open}
          style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0, minHeight: 30, background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
          <span style={{ fontSize: 11, color: "#94a3b8", transition: "transform .2s", transform: open ? "rotate(90deg)" : "none" }}>▸</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 11, letterSpacing: 1, color: "#94a3b8", fontWeight: 700 }}>{title}</span>
            {!open && summary && <span style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#334155", marginTop: 2 }}>{summary}</span>}
          </span>
        </button>
        {go && <GoLink {...go} />}
      </div>
      {open && <div style={{ marginTop: 10 }}>{children}</div>}
    </div>
  );
}

// Link to the section of the app where this block lives.
export function GoLink({ label, onClick }) {
  return (
    <button onClick={onClick} aria-label={`Ir a ${label}`}
      style={{ flexShrink: 0, border: "none", background: "#eff6ff", color: "#0f4c81", borderRadius: 99, padding: "5px 11px", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
      {label} ›
    </button>
  );
}

const OPEN_KEY = "bolsillo_dash_open";
const readOpen = () => {
  try { return { best: true, inbox: true, bis: true, cur: true, ...JSON.parse(localStorage.getItem(OPEN_KEY) || "{}") }; }
  catch { return { best: true, inbox: true, bis: true, cur: true }; }
};

export default function Dashboard({ onGo, renderInbox, expenses, cards, recommendations, fmt, catEmoji, categories, owedFor, todayStr, fetcher, scriptUrl }) {
  const [budget, setBudget] = useState(null); // { lines, config } | "none"
  const [open, setOpen] = useState(readOpen);
  const toggle = id => setOpen(o => {
    const next = { ...o, [id]: !o[id] };
    try { localStorage.setItem(OPEN_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
    return next;
  });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const cached = getBudgetCache();
        if (cached) { setBudget({ lines: cached.lines || [], config: cached.config || {} }); return; }
        const res = await fetcher(`${scriptUrl}?action=budget-list`);
        if (!res.ok) throw new Error(String(res.status));
        const out = await res.json();
        setBudgetCache(out);
        if (alive) setBudget({ lines: out.lines || [], config: out.config || {} });
      } catch (err) {
        console.warn("budget not available for dashboard", err);
        if (alive) setBudget("none");
      }
    })();
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const thisKey = monthKey(todayStr);

  const cardName = id => id === "debit" ? "Débito" : (cards.find(c => c.id === id)?.nombre || id);
  const cardColor = id => id === "debit" ? "#475569" : (cards.find(c => c.id === id)?.color || "#0f4c81");

  const sumMonth = key => {
    const rows = expenses.filter(e => String(e.date).slice(0, 7) === key);
    const byCat = {}, byAcct = {};
    let gross = 0, owed = 0;
    for (const e of rows) {
      const o = owedFor(e);
      gross += e.amount; owed += o;
      for (const part of splitByCategory(e)) byCat[part.cat] = (byCat[part.cat] || 0) + part.amount;
      byAcct[e.account] = (byAcct[e.account] || 0) + e.amount;
    }
    return { count: rows.length, gross, owed, net: gross - owed, byCat, byAcct };
  };
  const cur = useMemo(() => sumMonth(thisKey), [expenses, thisKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Los tres cuadros: lo que falta por ingresar en la cuenta en conjunto y lo que cada quien le debe (aún sin reponer).
  const porIngresar = expenses.filter(e => !e.added).reduce((sum, e) => sum + e.amount, 0);
  // Gastos fijos del mes: lo que se anotó en Crédito dentro de la categoría "Gastos fijos" (con la misma regla de reparto del
  // resto del dashboard).
  const fijosMes = expenses.filter(e => String(e.date).slice(0, 7) === thisKey).map(e => ({ e, parte: splitByCategory(e).filter(p => p.cat === "Gastos fijos").reduce((t, p) => t + p.amount, 0) })).filter(x => x.parte > 0);
  const fijosTotal = fijosMes.reduce((sum, x) => sum + x.parte, 0);
  const debe = { Omar: totalFor(pendingFor(expenses, "Omar"), "Omar"), Shelsy: totalFor(pendingFor(expenses, "Shelsy"), "Shelsy") };

  const catSlices = obj => Object.entries(obj)
    .filter(([, v]) => v > 0.005)
    .sort((a, b) => b[1] - a[1])
    .map(([c, v]) => ({ label: c, value: v, color: CAT_COLORS[c] || "#94a3b8", emoji: catEmoji[c] }));
  const curSlices = catSlices(cur.byCat);

  const groupSlices = budget && budget !== "none"
    ? GROUP_SLICES.map(g => ({ ...g, value: budget.lines.filter(l => l.grupo === g.id).reduce((s, l) => s + (Number(l.anual) || 0), 0) })).filter(s => s.value > 0)
    : [];
  const planAnual = groupSlices.reduce((s, x) => s + x.value, 0);


  // Gastos de la bisemana actual por categoría frente a lo presupuestado (las quincenas se cuentan de 14 en 14 desde un día de pago).
  const budgetReady = budget && budget !== "none";
  const period = budgetReady ? budgetPeriod("bisemanal", todayStr, budget.config?.anclaPago || "") : null;
  const bisRows = period ? CATEGORIES.map(cat => {
    const spent = expenses.filter(e => e.date >= period.start && e.date <= period.end)
      .reduce((sum, e) => sum + splitByCategory(e).filter(p => p.cat === cat).reduce((t, p) => t + p.amount, 0), 0);
    const planned = budget.lines.filter(l => (l.categorias || []).some(c => sameCategory(c, cat))).reduce((sum, l) => sum + lineAmount(l.anual, "bisemanal"), 0);
    return { cat, spent, planned, pct: planned > 0 ? Math.round((spent / planned) * 100) : null, status: planned > 0 ? budgetStatus(spent, planned) : null };
  }) : [];
  const bisSpent = bisRows.filter(r => r.planned > 0).reduce((sum, r) => sum + r.spent, 0);
  const bisPlanned = bisRows.reduce((sum, r) => sum + r.planned, 0);

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 16 }}>
        <button type="button" className="stat slate" style={{ padding: "10px 12px", textAlign: "left", cursor: "pointer", font: "inherit" }} onClick={() => onGo("list")}>
          <div className="stat-label">POR INGRESAR</div>
          <div className="stat-value" style={{ fontSize: 15 }}>{fmt(porIngresar)}</div>
        </button>
        <button type="button" className="stat blue" style={{ padding: "10px 12px", textAlign: "left", cursor: "pointer", font: "inherit" }} onClick={() => onGo("medeben")}>
          <div className="stat-label">OMAR DEBE</div>
          <div className="stat-value" style={{ fontSize: 15 }}>{fmt(debe.Omar)}</div>
        </button>
        <button type="button" className="stat rose" style={{ padding: "10px 12px", textAlign: "left", cursor: "pointer", font: "inherit" }} onClick={() => onGo("medeben")}>
          <div className="stat-label">SHELSY DEBE</div>
          <div className="stat-value" style={{ fontSize: 15 }}>{fmt(debe.Shelsy)}</div>
        </button>
        <button type="button" className="stat amber" style={{ padding: "10px 12px", textAlign: "left", cursor: "pointer", font: "inherit" }} onClick={() => onGo("list")}>
          <div className="stat-label">GASTOS FIJOS</div>
          <div className="stat-value" style={{ fontSize: 15 }}>{fmt(fijosTotal)}</div>
        </button>
      </div>

      {renderInbox({ collapsed: !open.inbox, onToggle: () => toggle("inbox"), onGo: () => onGo("list", "por-revisar") })}

      <Collapse title={`📊 GASTOS ACTUALES · BISEMANA${period ? " " + period.label.toUpperCase() : ""}`}
        summary={!budgetReady ? "" : !period ? "Falta la fecha de pago" : bisPlanned > 0 ? `${fmt(bisSpent)} de ${fmt(bisPlanned)} · ${Math.round((bisSpent / bisPlanned) * 100)}%` : fmt(bisRows.reduce((sum, r) => sum + r.spent, 0))}
        open={open.bis} onToggle={() => toggle("bis")} go={{ label: "Presupuesto", onClick: () => onGo("budget") }}>
        {budget === null && <div style={{ fontSize: 12, color: "#94a3b8" }}>Cargando…</div>}
        {budget === "none" && <div style={{ fontSize: 12, color: "#94a3b8" }}>No se pudo cargar el presupuesto.</div>}
        {budgetReady && !period && (
          <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.5 }}>
            Para contar por bisemana falta la fecha de un día de pago real. Se pone en Presupuesto, en "Ingresos, fondo y fecha de pago".
          </div>
        )}
        {period && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {bisRows.map(r => (
              <div key={r.cat}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}>{catEmoji[r.cat] || "📦"} {r.cat}</span>
                  <span style={{ fontSize: 12, color: "#475569", fontVariantNumeric: "tabular-nums", textAlign: "right" }}>
                    {r.planned > 0
                      ? <><b style={{ color: STATUS_COLOR[r.status] }}>{fmt(r.spent)}</b> de {fmt(r.planned)} · <b style={{ color: STATUS_COLOR[r.status] }}>{r.pct}%</b></>
                      : <><b>{fmt(r.spent)}</b> · sin presupuesto</>}
                  </span>
                </div>
                {r.planned > 0 && (
                  <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, r.pct)} aria-label={`${r.cat}: ${r.pct}% del presupuesto`}
                    style={{ height: 8, background: "#f1f5f9", borderRadius: 99, overflow: "hidden", marginTop: 5 }}>
                    <div style={{ width: `${Math.min(100, r.pct)}%`, height: "100%", background: STATUS_COLOR[r.status], borderRadius: 99, transition: "width .25s" }} />
                  </div>
                )}
              </div>
            ))}
            <div style={{ fontSize: 10.5, color: "#94a3b8" }}>El presupuesto de cada categoría es la suma de las líneas que le asignas en Presupuesto.</div>
          </div>
        )}
      </Collapse>

      {recommendations.length > 0 && (
        <Collapse title="💳 MEJOR TARJETA HOY" open={open.best} onToggle={() => toggle("best")} go={{ label: "Crédito", onClick: () => onGo("list", "mejor-tarjeta") }}
          summary={`${recommendations[0].categoria} · ${cards.find(c => c.id === recommendations[0].best.cardId)?.nombre || ""} ${recommendations[0].best.effectiveRate}%`}>
          <BestCardWidget bare recommendations={recommendations} cards={cards} fmt={fmt} catEmoji={catEmoji} />
        </Collapse>
      )}


      <Collapse title={`📆 MES ACTUAL · ${monthName(thisKey).toUpperCase()}`} summary={fmt(cur.gross)} open={open.cur} onToggle={() => toggle("cur")} go={{ label: "Presupuesto", onClick: () => onGo("budget") }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 8 }}>Gastado hasta hoy, por categoría</div>
        {curSlices.length === 0
          ? <div style={{ fontSize: 12, color: "#94a3b8" }}>Todavía no hay gastos este mes.</div>
          : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
              <Donut slices={curSlices} center={{ top: "TOTAL", main: fmt(cur.gross) }} />
              <Legend slices={curSlices} fmt={fmt} />
            </div>
          )}
        {cur.count > 0 && <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 6 }}>{cur.count} gastos · todas las tarjetas y débito (sin restar lo que te deben).</div>}

        <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid #f1f5f9" }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 8 }}>Proporción de gastos del presupuesto</div>
          {budget === null && <div style={{ fontSize: 12, color: "#94a3b8" }}>Cargando…</div>}
          {budget === "none" && <div style={{ fontSize: 12, color: "#94a3b8" }}>No se pudo cargar el presupuesto.</div>}
          {budget && budget !== "none" && (groupSlices.length === 0
            ? <div style={{ fontSize: 12, color: "#94a3b8" }}>Todavía no hay líneas en el presupuesto.</div>
            : (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
                <Donut slices={groupSlices} center={{ top: "AL MES", main: fmt(lineAmount(planAnual, "mensual")) }} />
                <Legend slices={groupSlices.map(s => ({ ...s, value: lineAmount(s.value, "mensual") }))} fmt={fmt} />
                <div style={{ fontSize: 10, color: "#94a3b8", alignSelf: "flex-start" }}>Montos mensuales planificados.</div>
              </div>
            ))}
        </div>
      </Collapse>

    </div>
  );
}
