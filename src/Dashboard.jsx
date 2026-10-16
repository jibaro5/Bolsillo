import { useState, useEffect, useMemo } from "react";
import { lineAmount } from "./budgetMath.js";

// Dashboard: budget proportions (doughnut), spending so far this month by
// category, best card today, the three money tiles and last month's summary.
// Everything is computed from the expenses the app already loaded (all cards +
// débito); only the budget doughnut needs one extra call.

const MONTHS = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const CAT_COLORS = {
  "Comida": "#f59e0b", "Super": "#10b981", "Gas": "#ef4444", "Ocio": "#8b5cf6", "Viaje": "#06b6d4",
  "Salud": "#ec4899", "Compras": "#3b82f6", "Gastos fijos": "#64748b", "Otro": "#94a3b8",
};
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
// Category as stored ("Comida", "🍽️ Comida", "comida") -> canonical name.
const canonCat = (c, known) => {
  const t = String(c || "").trim();
  if (!t) return "Otro";
  const hit = known.find(k => t.toLowerCase().endsWith(k.toLowerCase()));
  return hit || t;
};

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
export function BestCardWidget({ recommendations, cards, fmt, catEmoji }) {
  if (!recommendations.length) return null;
  return (
    <div className="card" style={{ padding: 14, marginBottom: 16 }}>
      <div style={{ fontSize: 11, letterSpacing: 1, color: "#94a3b8", fontWeight: 700, marginBottom: 10 }}>💳 MEJOR TARJETA HOY</div>
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

export default function Dashboard({ inboxSlot, expenses, cards, recommendations, fmt, catEmoji, categories, owedFor, todayStr, fetcher, scriptUrl }) {
  const [budget, setBudget] = useState(null); // { lines } | "none"

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetcher(`${scriptUrl}?action=budget-list`);
        if (!res.ok) throw new Error(String(res.status));
        const out = await res.json();
        if (alive) setBudget({ lines: out.lines || [] });
      } catch (err) {
        console.warn("budget not available for dashboard", err);
        if (alive) setBudget("none");
      }
    })();
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const thisKey = monthKey(todayStr);
  const lastKey = monthKey(todayStr, -1);
  const prevKey = monthKey(todayStr, -2);

  const cardName = id => id === "debit" ? "Débito" : (cards.find(c => c.id === id)?.nombre || id);
  const cardColor = id => id === "debit" ? "#475569" : (cards.find(c => c.id === id)?.color || "#0f4c81");

  const sumMonth = key => {
    const rows = expenses.filter(e => String(e.date).slice(0, 7) === key);
    const byCat = {}, byAcct = {};
    let gross = 0, owed = 0;
    for (const e of rows) {
      const o = owedFor(e);
      gross += e.amount; owed += o;
      const c = canonCat(e.category, categories);
      byCat[c] = (byCat[c] || 0) + e.amount;
      byAcct[e.account] = (byAcct[e.account] || 0) + e.amount;
    }
    return { count: rows.length, gross, owed, net: gross - owed, byCat, byAcct };
  };
  const cur = useMemo(() => sumMonth(thisKey), [expenses, thisKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const last = useMemo(() => sumMonth(lastKey), [expenses, lastKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const prev = useMemo(() => sumMonth(prevKey), [expenses, prevKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // The three money tiles (all cards + débito).
  const porIngresar = expenses.filter(e => e.account !== "debit" && !e.added).reduce((s, e) => s + e.amount, 0);
  const meDeben = expenses.filter(e => !e.paid).reduce((s, e) => s + owedFor(e), 0);

  const catSlices = obj => Object.entries(obj)
    .filter(([, v]) => v > 0.005)
    .sort((a, b) => b[1] - a[1])
    .map(([c, v]) => ({ label: c, value: v, color: CAT_COLORS[c] || "#94a3b8", emoji: catEmoji[c] }));
  const curSlices = catSlices(cur.byCat);
  const lastSlices = catSlices(last.byCat);

  const groupSlices = budget && budget !== "none"
    ? GROUP_SLICES.map(g => ({ ...g, value: budget.lines.filter(l => l.grupo === g.id).reduce((s, l) => s + (Number(l.anual) || 0), 0) })).filter(s => s.value > 0)
    : [];
  const planAnual = groupSlices.reduce((s, x) => s + x.value, 0);

  const diff = last.gross - prev.gross;
  const diffPct = prev.gross > 0 ? Math.abs(diff / prev.gross * 100).toFixed(0) : null;

  const secTitle = { fontSize: 11, letterSpacing: 1, color: "#94a3b8", fontWeight: 700, marginBottom: 10 };

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 16 }}>
        <div className="stat blue" style={{ padding: "10px 12px" }}>
          <div className="stat-label">POR INGRESAR</div>
          <div className="stat-value" style={{ fontSize: 15 }}>{fmt(porIngresar)}</div>
        </div>
        <div className="stat amber" style={{ padding: "10px 12px" }}>
          <div className="stat-label">ME DEBEN</div>
          <div className="stat-value" style={{ fontSize: 15 }}>{fmt(meDeben)}</div>
        </div>
        <div className="stat green" style={{ padding: "10px 12px" }}>
          <div className="stat-label">NETO DEL MES</div>
          <div className="stat-value" style={{ fontSize: 15 }}>{fmt(cur.net)}</div>
        </div>
      </div>

      <BestCardWidget recommendations={recommendations} cards={cards} fmt={fmt} catEmoji={catEmoji} />

      {inboxSlot}

      <div className="card" style={{ padding: 14, marginBottom: 16 }}>
        <div style={secTitle}>📆 MES ACTUAL · {monthName(thisKey).toUpperCase()}</div>
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
      </div>

      <div className="card" style={{ padding: 14 }}>
        <div style={secTitle}>📅 MES PASADO · {monthName(lastKey).toUpperCase()}</div>
        {last.count === 0 ? <div style={{ fontSize: 12, color: "#94a3b8" }}>No hay gastos registrados en {monthName(lastKey)}.</div> : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
              <div><div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 700 }}>GASTADO</div><div style={{ fontSize: 16, fontWeight: 700 }}>{fmt(last.gross)}</div></div>
              <div><div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 700 }}>ME DEBÍAN</div><div style={{ fontSize: 16, fontWeight: 700, color: "#b45309" }}>{fmt(last.owed)}</div></div>
              <div><div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 700 }}>NETO</div><div style={{ fontSize: 16, fontWeight: 700, color: "#059669" }}>{fmt(last.net)}</div></div>
            </div>
            {diffPct !== null && (
              <div style={{ fontSize: 12, marginBottom: 12, color: diff > 0 ? "#dc2626" : "#059669", fontWeight: 600 }}>
                {diff > 0 ? "▲" : "▼"} {diffPct}% {diff > 0 ? "más" : "menos"} que {monthName(prevKey)} ({fmt(prev.gross)})
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
              <Donut slices={lastSlices} center={{ top: "TOTAL", main: fmt(last.gross) }} size={130} />
              <Legend slices={lastSlices} fmt={fmt} />
            </div>
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid #f1f5f9" }}>
              {Object.entries(last.byAcct).sort((a, b) => b[1] - a[1]).map(([id, v]) => (
                <div key={id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, padding: "3px 0" }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: cardColor(id) }} />
                  <span style={{ flex: 1, color: "#475569" }}>{cardName(id)}</span>
                  <b style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(v)}</b>
                </div>
              ))}
              <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>{last.count} gastos</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
