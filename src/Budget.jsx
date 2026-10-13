import { useState, useEffect, useMemo } from "react";
import {
  KINDS, lineAmount, annualFromPeriod, budgetPeriod, shiftPeriod,
  spentFor, budgetStatus, planTotals, categoryConflicts,
} from "./budgetMath.js";

// Budget section. The numbers live in the Sheet ("Presupuesto" tab) and are
// edited here. Each line keeps one ANNUAL amount; biweekly / monthly / annual
// are just three views of it (see budgetMath.js).

const KIND_LABEL = { bisemanal: "Bisemanal", mensual: "Mensual", anual: "Anual" };
const KIND_ADJ = { bisemanal: "bisemanal", mensual: "mensual", anual: "anual" };
const GROUPS = [
  { id: "esencial", title: "ESENCIALES", icon: "🏠" },
  { id: "no_esencial", title: "NO ESENCIALES", icon: "🎯" },
  { id: "ahorro", title: "AHORRO E INVERSIÓN", icon: "🌱" },
];
const STATUS_COLOR = { ok: "#16a34a", warn: "#d97706", over: "#dc2626" };
const EMPTY_FORM = { id: null, grupo: "esencial", nombre: "", unit: "mensual", monto: "", categorias: [], nota: "" };

const readKind = () => { try { const k = localStorage.getItem("bolsillo_budget_kind"); return KINDS.includes(k) ? k : "mensual"; } catch { return "mensual"; } };
const saveKind = k => { try { localStorage.setItem("bolsillo_budget_kind", k); } catch { /* storage unavailable */ } };

export default function Budget({ expenses, fetcher, showToast, owedFor, categories, catEmoji, fmt, todayStr, scriptUrl }) {
  const [data, setData] = useState({ lines: [], config: { sueldoNetoAnual: 0, anclaPago: "" } });
  const [state, setState] = useState("loading"); // loading | ok | error
  const [kind, setKind] = useState(readKind);
  const [ref, setRef] = useState(todayStr);
  const [form, setForm] = useState(null);       // edit/add modal
  const [confirmDel, setConfirmDel] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [cfgForm, setCfgForm] = useState({ sueldoNetoAnual: "", anclaPago: "" });
  const [saving, setSaving] = useState(false);

  async function post(action, payload) {
    const res = await fetcher(scriptUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...payload }) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || `${action} failed`);
    return out;
  }
  async function load() {
    try {
      const res = await fetcher(`${scriptUrl}?action=budget-list`);
      if (!res.ok) throw new Error(`budget-list ${res.status}`);
      const out = await res.json();
      setData({ lines: out.lines || [], config: out.config || { sueldoNetoAnual: 0, anclaPago: "" } });
      setState("ok");
    } catch (err) {
      console.error(err);
      setState("error");
    }
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const { lines, config } = data;
  const anchor = config.anclaPago || "";
  const period = budgetPeriod(kind, ref, anchor);
  const isCurrent = period && todayStr >= period.start && todayStr <= period.end;

  const rows = useMemo(() => lines.map(l => {
    const budget = lineAmount(l.anual, kind);
    const measured = l.categorias.length > 0;
    const spent = measured && period ? spentFor(l.categorias, expenses, period, owedFor) : 0;
    return { ...l, budget, measured, spent, status: measured ? budgetStatus(spent, budget) : null };
  }), [lines, kind, period?.start, period?.end, expenses]); // eslint-disable-line react-hooks/exhaustive-deps

  const totals = planTotals(lines, kind, config.sueldoNetoAnual);
  const measuredRows = rows.filter(r => r.measured);
  const measuredBudget = measuredRows.reduce((s, r) => s + r.budget, 0);
  const measuredSpent = measuredRows.reduce((s, r) => s + r.spent, 0);

  function changeKind(k) { setKind(k); saveKind(k); }
  function step(dir) { if (period) setRef(shiftPeriod(period, dir, anchor).start); }

  function openAdd(grupo) { setConfirmDel(false); setForm({ ...EMPTY_FORM, grupo, unit: kind }); }
  function openEdit(r) {
    setConfirmDel(false);
    setForm({ id: r.id, grupo: r.grupo, nombre: r.nombre, unit: kind, monto: String(lineAmount(r.anual, kind)), categorias: r.categorias, nota: r.nota || "" });
  }
  function setUnit(unit) {
    setForm(f => {
      const anual = annualFromPeriod(f.monto, f.unit);
      return { ...f, unit, monto: f.monto === "" ? "" : String(lineAmount(anual, unit)) };
    });
  }
  const conflicts = form ? categoryConflicts(lines, form.categorias, form.id) : [];
  const usedBy = cat => lines.find(l => l.id !== form?.id && l.categorias.some(c => c.toLowerCase() === cat.toLowerCase()));

  async function saveLine(e) {
    e.preventDefault();
    if (!form || saving || conflicts.length) return;
    const payload = { grupo: form.grupo, nombre: form.nombre.trim(), anual: annualFromPeriod(form.monto || 0, form.unit), categorias: form.categorias, nota: form.nota.trim() };
    if (!payload.nombre) return;
    setSaving(true);
    try {
      if (form.id) await post("budget-edit", { id: form.id, ...payload });
      else await post("budget-add", payload);
      setForm(null);
      await load();
      showToast(form.id ? "Línea actualizada" : "Línea agregada");
    } catch (err) {
      console.error(err);
      showToast("No se pudo guardar la línea", "warn");
    } finally { setSaving(false); }
  }
  async function removeLine() {
    if (!form?.id || saving) return;
    setSaving(true);
    try {
      await post("budget-delete", { id: form.id });
      setForm(null);
      await load();
      showToast("Línea eliminada");
    } catch (err) {
      console.error(err);
      showToast("No se pudo eliminar", "warn");
    } finally { setSaving(false); }
  }
  async function saveSettings(e) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const out = await post("budget-config", {
        sueldoNetoAnual: cfgForm.sueldoNetoAnual === "" ? 0 : Number(cfgForm.sueldoNetoAnual),
        anclaPago: cfgForm.anclaPago,
      });
      setData(d => ({ ...d, config: out.config }));
      setShowSettings(false);
      showToast("Ajustes guardados");
    } catch (err) {
      console.error(err);
      showToast("No se pudo guardar", "warn");
    } finally { setSaving(false); }
  }
  function openSettings() {
    setCfgForm({ sueldoNetoAnual: config.sueldoNetoAnual ? String(config.sueldoNetoAnual) : "", anclaPago: config.anclaPago || "" });
    setShowSettings(true);
  }

  const css = `
    .bd-card{background:#fff;border-radius:16px;padding:16px;margin-bottom:12px;box-shadow:0 1px 3px rgba(15,23,42,.06);}
    .bd-nav{display:flex;align-items:center;justify-content:space-between;margin:12px 0;}
    .bd-arrow{border:none;background:#f1f5f9;border-radius:10px;width:36px;height:36px;font-size:18px;cursor:pointer;color:#475569;font-family:inherit;}
    .bd-bar{height:7px;background:#f1f5f9;border-radius:99px;overflow:hidden;margin-top:6px;}
    .bd-bar>div{height:100%;border-radius:99px;transition:width .25s;}
    .bd-row{display:block;width:100%;text-align:left;background:none;border:none;font-family:inherit;padding:11px 0;border-top:1px solid #f1f5f9;cursor:pointer;}
    .bd-row:first-of-type{border-top:none;}
    .bd-pill{display:inline-flex;align-items:center;gap:4px;padding:6px 10px;border-radius:99px;border:1.5px solid #e2e8f0;background:#fff;font-size:12px;font-weight:600;color:#64748b;cursor:pointer;font-family:inherit;}
    .bd-pill.on{border-color:#0f4c81;background:#eff6ff;color:#0f4c81;}
    .bd-pill:disabled{opacity:.45;cursor:not-allowed;}
  `;

  if (state === "loading") return <div className="empty-state">Cargando presupuesto…</div>;
  if (state === "error") return (
    <div className="empty-state">
      No se pudo cargar el presupuesto.
      <div style={{ marginTop: 12 }}><button className="btn btn-p" onClick={() => { setState("loading"); load(); }}>Reintentar</button></div>
    </div>
  );

  const over = totals.sinAsignar < -0.005;

  return (
    <div>
      <style>{css}</style>

      <div className="ptt">
        {KINDS.map(k => (
          <button key={k} className={`pto ${kind === k ? "on" : ""}`} onClick={() => changeKind(k)}>{KIND_LABEL[k]}</button>
        ))}
      </div>

      {period ? (
        <div className="bd-nav">
          <button className="bd-arrow" aria-label="Período anterior" onClick={() => step(-1)}>‹</button>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 18, fontWeight: 700 }}>{period.label}</div>
            {!isCurrent
              ? <button onClick={() => setRef(todayStr)} style={{ border: "none", background: "none", color: "#0f4c81", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Ir a hoy</button>
              : <div style={{ fontSize: 11, color: "#94a3b8" }}>Período actual</div>}
          </div>
          <button className="bd-arrow" aria-label="Período siguiente" onClick={() => step(1)}>›</button>
        </div>
      ) : (
        <div className="bd-card" style={{ marginTop: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Falta la fecha de un día de pago</div>
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 10 }}>Las quincenas se cuentan de 14 en 14 desde un día de pago real.</div>
          <button className="btn btn-p" onClick={openSettings}>Poner fecha de pago</button>
        </div>
      )}

      {lines.length === 0 ? (
        <div className="bd-card" style={{ textAlign: "center" }}>
          <div style={{ fontSize: 13, color: "#64748b", marginBottom: 12 }}>Todavía no hay líneas de presupuesto.</div>
          <button className="btn btn-p" onClick={() => openAdd("esencial")}>+ Agregar línea</button>
        </div>
      ) : (
        <>
          <div className="bd-card">
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#64748b" }}>
              <span>Sueldo neto {KIND_ADJ[kind]}</span><b style={{ color: "#0f172a" }}>{fmt(totals.sueldo)}</b>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#64748b", marginTop: 6 }}>
              <span>Planificado</span><b style={{ color: "#0f172a" }}>{fmt(totals.plan)}</b>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginTop: 6, color: over ? "#dc2626" : "#64748b" }}>
              <span>{over ? "Te pasas del sueldo" : "Sin asignar"}</span><b>{fmt(Math.abs(totals.sinAsignar))}</b>
            </div>
            {measuredRows.length > 0 && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #f1f5f9" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#64748b" }}>
                  <span>Gasto medido en Bolsillo</span>
                  <b style={{ color: STATUS_COLOR[budgetStatus(measuredSpent, measuredBudget)] }}>{fmt(measuredSpent)} <span style={{ color: "#94a3b8", fontWeight: 500 }}>de {fmt(measuredBudget)}</span></b>
                </div>
                <div className="bd-bar"><div style={{ width: `${Math.min(100, measuredBudget > 0 ? (measuredSpent / measuredBudget) * 100 : 0)}%`, background: STATUS_COLOR[budgetStatus(measuredSpent, measuredBudget)] }} /></div>
              </div>
            )}
            <button onClick={openSettings} style={{ marginTop: 12, border: "none", background: "none", color: "#0f4c81", fontSize: 11, fontWeight: 700, cursor: "pointer", padding: 0, fontFamily: "inherit" }}>⚙️ Sueldo y fecha de pago</button>
          </div>

          {GROUPS.map(g => {
            const groupRows = rows.filter(r => r.grupo === g.id);
            return (
              <div key={g.id} className="bd-card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                  <div style={{ fontSize: 11, letterSpacing: 1.5, fontWeight: 700, color: "#94a3b8" }}>{g.icon} {g.title}</div>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{fmt(totals.groups[g.id])}</div>
                </div>
                {groupRows.map(r => (
                  <button key={r.id} className="bd-row" onClick={() => openEdit(r)}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: "#0f172a" }}>{r.nombre}</span>
                      <span style={{ fontSize: 14, fontWeight: 600, color: r.budget > 0 ? "#0f172a" : "#cbd5e1" }}>{fmt(r.budget)}</span>
                    </div>
                    {r.measured && (
                      <>
                        <div className="bd-bar"><div style={{ width: `${Math.min(100, r.budget > 0 ? (r.spent / r.budget) * 100 : (r.spent > 0 ? 100 : 0))}%`, background: STATUS_COLOR[r.status] }} /></div>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginTop: 4, color: "#94a3b8" }}>
                          <span>Gastado {fmt(r.spent)}</span>
                          <span style={{ color: r.status === "over" ? "#dc2626" : "#94a3b8", fontWeight: r.status === "over" ? 700 : 400 }}>
                            {r.budget - r.spent >= 0 ? `Quedan ${fmt(r.budget - r.spent)}` : `Te pasaste ${fmt(r.spent - r.budget)}`}
                          </span>
                        </div>
                      </>
                    )}
                    {!r.measured && r.nota && <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{r.nota}</div>}
                  </button>
                ))}
                <button className="btn btn-g" style={{ width: "100%", marginTop: 8, padding: "8px" }} onClick={() => openAdd(g.id)}>+ Agregar línea</button>
              </div>
            );
          })}
        </>
      )}

      {form && (
        <div className="modal-overlay" onClick={() => setForm(null)}>
          <form className="modal" style={{ maxWidth: 420, maxHeight: "88vh", overflowY: "auto" }} onClick={e => e.stopPropagation()} onSubmit={saveLine}>
            <div style={{ fontSize: 11, letterSpacing: 2, color: "#0f4c81", marginBottom: 14, fontWeight: 700 }}>{form.id ? "EDITAR LÍNEA" : "NUEVA LÍNEA"}</div>

            <div className="field"><label>Nombre</label>
              <input className="inp" value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Ej. Renta" required />
            </div>

            <div className="field"><label>Grupo</label>
              <select className="sel" value={form.grupo} onChange={e => setForm(f => ({ ...f, grupo: e.target.value }))}>
                {GROUPS.map(g => <option key={g.id} value={g.id}>{g.title[0] + g.title.slice(1).toLowerCase()}</option>)}
              </select>
            </div>

            <div className="field"><label>Monto</label>
              <div className="ptt" style={{ marginBottom: 8 }}>
                {KINDS.map(k => <button key={k} type="button" className={`pto ${form.unit === k ? "on" : ""}`} onClick={() => setUnit(k)}>{KIND_LABEL[k]}</button>)}
              </div>
              <input className="inp" type="number" min="0" step="0.01" inputMode="decimal" value={form.monto} onChange={e => setForm(f => ({ ...f, monto: e.target.value }))} placeholder="0.00" required />
              {form.monto !== "" && (
                <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>
                  {KINDS.map(k => `${KIND_LABEL[k]} ${fmt(lineAmount(annualFromPeriod(form.monto, form.unit), k))}`).join(" · ")}
                </div>
              )}
            </div>

            <div className="field"><label>Medir con gastos de Bolsillo (opcional)</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {categories.map(c => {
                  const on = form.categorias.some(x => x.toLowerCase() === c.toLowerCase());
                  const other = !on && usedBy(c);
                  return (
                    <button key={c} type="button" disabled={!!other} title={other ? `Ya se mide en "${other.nombre}"` : ""}
                      className={`bd-pill ${on ? "on" : ""}`}
                      onClick={() => setForm(f => ({ ...f, categorias: on ? f.categorias.filter(x => x.toLowerCase() !== c.toLowerCase()) : [...f.categorias, c] }))}>
                      {catEmoji[c]} {c}
                    </button>
                  );
                })}
              </div>
              {categories.some(c => usedBy(c) && !form.categorias.includes(c)) && (
                <div style={{ fontSize: 10.5, color: "#94a3b8", marginTop: 8 }}>
                  Ya se miden en otra línea: {categories.filter(c => usedBy(c)).map(c => `${c} (${usedBy(c).nombre})`).join(", ")}
                </div>
              )}
              <div style={{ fontSize: 10.5, color: "#94a3b8", marginTop: 6 }}>
                Los gastos de esas categorías (todas las tarjetas y débito, menos lo que te deben) se cuentan contra esta línea. Una categoría solo puede medirse en una línea.
              </div>
            </div>

            <div className="field"><label>Nota (opcional)</label>
              <input className="inp" value={form.nota} onChange={e => setForm(f => ({ ...f, nota: e.target.value }))} placeholder="Ej. se paga el 1 de cada mes" />
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button className="btn btn-p" style={{ flex: 1 }} type="submit" disabled={saving}>{saving ? "Guardando…" : "Guardar"}</button>
              <button className="btn btn-g" type="button" onClick={() => setForm(null)}>Cancelar</button>
            </div>
            {form.id && (
              <button className="btn btn-d" type="button" style={{ width: "100%", marginTop: 8 }} disabled={saving}
                onClick={() => confirmDel ? removeLine() : setConfirmDel(true)}>
                {confirmDel ? "¿Seguro? Toca otra vez para eliminar" : "Eliminar línea"}
              </button>
            )}
          </form>
        </div>
      )}

      {showSettings && (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <form className="modal" onClick={e => e.stopPropagation()} onSubmit={saveSettings}>
            <div style={{ fontSize: 11, letterSpacing: 2, color: "#0f4c81", marginBottom: 14, fontWeight: 700 }}>SUELDO Y FECHA DE PAGO</div>
            <div className="field"><label>Sueldo neto anual</label>
              <input className="inp" type="number" min="0" step="0.01" inputMode="decimal" value={cfgForm.sueldoNetoAnual} onChange={e => setCfgForm(f => ({ ...f, sueldoNetoAnual: e.target.value }))} placeholder="72000" />
              {cfgForm.sueldoNetoAnual !== "" && (
                <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>
                  {KINDS.map(k => `${KIND_LABEL[k]} ${fmt(lineAmount(cfgForm.sueldoNetoAnual, k))}`).join(" · ")}
                </div>
              )}
            </div>
            <div className="field"><label>Un día de pago real</label>
              <input className="inp" type="date" value={cfgForm.anclaPago} onChange={e => setCfgForm(f => ({ ...f, anclaPago: e.target.value }))} />
              <div style={{ fontSize: 10.5, color: "#94a3b8", marginTop: 6 }}>Cualquier fecha en que te hayan pagado. De ahí se cuentan las quincenas, de 14 en 14.</div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button className="btn btn-p" style={{ flex: 1 }} type="submit" disabled={saving}>{saving ? "Guardando…" : "Guardar"}</button>
              <button className="btn btn-g" type="button" onClick={() => setShowSettings(false)}>Cancelar</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
