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
  { id: "esencial", title: "Esenciales", bg: "#eff6ff", fg: "#0f4c81" },
  { id: "no_esencial", title: "No esenciales", bg: "#fffbeb", fg: "#b45309" },
  { id: "ahorro", title: "Ahorro e inversión", bg: "#ecfdf5", fg: "#059669" },
];
const STATUS_COLOR = { ok: "#16a34a", warn: "#d97706", over: "#dc2626" };
const EMPTY_FORM = { id: null, grupo: "esencial", nombre: "", anual: 0, vals: { bisemanal: "", mensual: "", anual: "" }, categorias: [], nota: "" };
const f2 = n => String(Math.round(n * 100) / 100);
// The three amounts of a line, as strings for the inputs, from its annual value.
const valsFromAnual = anual => Object.fromEntries(KINDS.map(k => [k, f2(lineAmount(anual, k))]));

const amountsOf = anual => Object.fromEntries(KINDS.map(k => [k, lineAmount(anual, k)]));

// Table helpers: the heading row and one row of three amounts (bisemanal / mensual / anual).
function ColHead() {
  return <tr className="ch"><th></th>{KINDS.map(k => <th key={k}>{KIND_LABEL[k]}</th>)}</tr>;
}
function Nums({ vals, fmt, dim, tone }) {
  return KINDS.map(k => <td key={k} className="n" style={{ color: tone || (dim ? "#cbd5e1" : undefined) }}>{fmt(Math.abs(vals[k]))}</td>);
}

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
    return { ...l, budget, amounts: amountsOf(l.anual), measured, spent, status: measured ? budgetStatus(spent, budget) : null };
  }), [lines, kind, period?.start, period?.end, expenses]); // eslint-disable-line react-hooks/exhaustive-deps

  // Totals for the three views at once; `totals.x` is { bisemanal, mensual, anual }.
  const totals = useMemo(() => {
    const t = Object.fromEntries(KINDS.map(k => [k, planTotals(lines, k, config.sueldoNetoAnual)]));
    const pick = f => Object.fromEntries(KINDS.map(k => [k, f(t[k])]));
    return {
      sueldo: pick(x => x.sueldo), plan: pick(x => x.plan), sinAsignar: pick(x => x.sinAsignar),
      groups: Object.fromEntries(GROUPS.map(g => [g.id, pick(x => x.groups[g.id])])),
    };
  }, [lines, config.sueldoNetoAnual]);
  const measuredRows = rows.filter(r => r.measured);
  const measuredBudget = measuredRows.reduce((s, r) => s + r.budget, 0);
  const measuredSpent = measuredRows.reduce((s, r) => s + r.spent, 0);

  function changeKind(k) { setKind(k); saveKind(k); }
  function step(dir) { if (period) setRef(shiftPeriod(period, dir, anchor).start); }

  function openAdd(grupo) { setConfirmDel(false); setForm({ ...EMPTY_FORM, grupo }); }
  function openEdit(r) {
    setConfirmDel(false);
    setForm({ id: r.id, grupo: r.grupo, nombre: r.nombre, anual: r.anual, vals: valsFromAnual(r.anual), categorias: r.categorias, nota: r.nota || "" });
  }
  // Typing in any of the three boxes recomputes the other two (annual is the pivot).
  function setAmount(kind_, v) {
    setForm(f => {
      if (v === "") return { ...f, anual: 0, vals: { bisemanal: "", mensual: "", anual: "", [kind_]: "" } };
      const anual = annualFromPeriod(v, kind_);
      return { ...f, anual, vals: { ...valsFromAnual(anual), [kind_]: v } };
    });
  }
  const conflicts = form ? categoryConflicts(lines, form.categorias, form.id) : [];
  const usedBy = cat => lines.find(l => l.id !== form?.id && l.categorias.some(c => c.toLowerCase() === cat.toLowerCase()));

  async function saveLine(e) {
    e.preventDefault();
    if (!form || saving || conflicts.length) return;
    const payload = { grupo: form.grupo, nombre: form.nombre.trim(), anual: form.anual || 0, categorias: form.categorias, nota: form.nota.trim() };
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
    .bd-t{width:100%;border-collapse:collapse;table-layout:fixed;background:#fff;border:1px solid #cbd5e1;margin-bottom:14px;font-size:12px;}
    .bd-t th,.bd-t td{padding:8px 5px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:400;vertical-align:top;}
    .bd-t th:first-child,.bd-t td:first-child{text-align:left;width:37%;padding-left:10px;}
    .bd-t th.g{text-align:left;font-size:13px;font-weight:700;padding:9px 10px;letter-spacing:.3px;}
    .bd-t tr.ch th{font-size:10px;font-weight:700;color:#64748b;background:#f8fafc;text-transform:uppercase;letter-spacing:.2px;}
    .bd-t td.n{font-variant-numeric:tabular-nums;font-size:12px;white-space:nowrap;}
    .bd-t tbody tr:nth-child(even) td{background:#f8fafc;}
    .bd-t tr.tot td{font-weight:700;border-top:2px solid #94a3b8;border-bottom:none;background:#f1f5f9!important;}
    .bd-t td{font-size:13px;color:#0f172a;}
    .bd-t td .sub{display:block;font-size:10.5px;color:#64748b;margin-top:1px;white-space:nowrap;}
    .bd-tr{cursor:pointer;}
    .bd-tr:active td{background:#e2e8f0!important;}
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

  const over = totals.sinAsignar.anual < -0.005;

  return (
    <div>
      <style>{css}</style>

      {lines.length === 0 ? (
        <div className="bd-card" style={{ textAlign: "center" }}>
          <div style={{ fontSize: 13, color: "#64748b", marginBottom: 12 }}>Todavía no hay líneas de presupuesto.</div>
          <button className="btn btn-p" onClick={() => openAdd("esencial")}>+ Agregar línea</button>
        </div>
      ) : (
        <>
          <div className="bd-card">
            <div style={{ fontSize: 11, letterSpacing: 1, fontWeight: 700, color: "#94a3b8", marginBottom: 8 }}>GASTO REAL EN BOLSILLO</div>
            <div className="ptt">
              {KINDS.map(k => (
                <button key={k} className={`pto ${kind === k ? "on" : ""}`} onClick={() => changeKind(k)}>{KIND_LABEL[k]}</button>
              ))}
            </div>
            {period ? (
              <>
                <div className="bd-nav" style={{ margin: "10px 0 6px" }}>
                  <button className="bd-arrow" aria-label="Período anterior" onClick={() => step(-1)}>‹</button>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 16, fontWeight: 700 }}>{period.label}</div>
                    {!isCurrent
                      ? <button onClick={() => setRef(todayStr)} style={{ border: "none", background: "none", color: "#0f4c81", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Ir a hoy</button>
                      : <div style={{ fontSize: 11, color: "#94a3b8" }}>Período actual</div>}
                  </div>
                  <button className="bd-arrow" aria-label="Período siguiente" onClick={() => step(1)}>›</button>
                </div>
                {measuredRows.length > 0 && (
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#64748b" }}>
                      <span>Líneas medidas</span>
                      <b style={{ color: STATUS_COLOR[budgetStatus(measuredSpent, measuredBudget)] }}>{fmt(measuredSpent)} <span style={{ color: "#94a3b8", fontWeight: 500 }}>de {fmt(measuredBudget)}</span></b>
                    </div>
                    <div className="bd-bar"><div style={{ width: `${Math.min(100, measuredBudget > 0 ? (measuredSpent / measuredBudget) * 100 : 0)}%`, background: STATUS_COLOR[budgetStatus(measuredSpent, measuredBudget)] }} /></div>
                  </>
                )}
              </>
            ) : (
              <div style={{ marginTop: 10, fontSize: 12, color: "#64748b" }}>
                Para ver el gasto por quincena falta la fecha de un día de pago real (las quincenas se cuentan de 14 en 14).
                <div style={{ marginTop: 8 }}><button className="btn btn-p" onClick={openSettings}>Poner fecha de pago</button></div>
              </div>
            )}
            <button onClick={openSettings} style={{ marginTop: 12, border: "none", background: "none", color: "#0f4c81", fontSize: 11, fontWeight: 700, cursor: "pointer", padding: 0, fontFamily: "inherit" }}>⚙️ Sueldo y fecha de pago</button>
          </div>

          <table className="bd-t">
            <thead>
              <tr><th className="g" colSpan={4} style={{ background: "#f8fafc", color: "#0f172a" }}>Resumen del sueldo</th></tr>
              <ColHead />
            </thead>
            <tbody>
              <tr><td>Sueldo neto</td><Nums vals={totals.sueldo} fmt={fmt} /></tr>
              <tr><td>Planificado</td><Nums vals={totals.plan} fmt={fmt} /></tr>
              <tr className="tot"><td style={over ? { color: "#dc2626" } : undefined}>{over ? "Te pasas del sueldo" : "Sin asignar"}</td><Nums vals={totals.sinAsignar} fmt={fmt} tone={over ? "#dc2626" : null} /></tr>
            </tbody>
          </table>

          {GROUPS.map(g => {
            const groupRows = rows.filter(r => r.grupo === g.id);
            return (
              <div key={g.id} style={{ marginBottom: 14 }}>
                <table className="bd-t" style={{ marginBottom: 6 }}>
                  <thead>
                    <tr><th className="g" colSpan={4} style={{ background: g.bg, color: g.fg }}>{g.title}</th></tr>
                    <ColHead />
                  </thead>
                  <tbody>
                    {groupRows.map(r => (
                      <tr key={r.id} className="bd-tr" onClick={() => openEdit(r)}>
                        <td>
                          {r.nombre}
                          {r.measured && period && (
                            <>
                              <span className="sub">Gastado {fmt(r.spent)}</span>
                              <span className="sub" style={r.status === "over" ? { color: "#dc2626", fontWeight: 700 } : undefined}>
                                {r.status === "over" ? `Te pasaste ${fmt(r.spent - r.budget)}` : `Quedan ${fmt(r.budget - r.spent)}`}
                              </span>
                              <div className="bd-bar" style={{ marginTop: 4, height: 4 }}><div style={{ width: `${Math.min(100, r.budget > 0 ? (r.spent / r.budget) * 100 : (r.spent > 0 ? 100 : 0))}%`, background: STATUS_COLOR[r.status] }} /></div>
                            </>
                          )}
                          {!r.measured && r.nota && <span className="sub">{r.nota}</span>}
                        </td>
                        <Nums vals={r.amounts} fmt={fmt} dim={r.anual <= 0} />
                      </tr>
                    ))}
                    <tr className="tot"><td>Total</td><Nums vals={totals.groups[g.id]} fmt={fmt} /></tr>
                  </tbody>
                </table>
                <button className="btn btn-g" style={{ width: "100%", padding: "8px" }} onClick={() => openAdd(g.id)}>+ Agregar línea</button>
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
              <div style={{ display: "flex", gap: 8 }}>
                {KINDS.map(k => (
                  <div key={k} style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 700, marginBottom: 4 }}>{KIND_LABEL[k]}</div>
                    <input className="inp" style={{ padding: "10px 8px" }} type="number" min="0" step="0.01" inputMode="decimal" value={form.vals[k]} onChange={e => setAmount(k, e.target.value)} placeholder="0.00" required={k === "mensual"} />
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 10.5, color: "#94a3b8", marginTop: 6 }}>Cambia cualquiera de los tres y los otros se ajustan solos (anual ÷ 12 = mensual, anual ÷ 26 = bisemanal).</div>
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
