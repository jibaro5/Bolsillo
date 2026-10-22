import { useState, useEffect, useMemo, useRef, Fragment } from "react";
import {
  KINDS, lineAmount, annualFromPeriod, budgetPeriod, shiftPeriod,
  spentFor, budgetStatus, planTotals, categoryConflicts, moveLine,
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

// ---- search ----
const norm = t => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
// Words that point at the same kind of expense, so a search also surfaces related lines.
const RELATED = [
  ["comida", "restaurante", "groceries", "super", "supermercado", "almuerzo", "cena", "afuera"],
  ["gas", "gasolina", "combustible", "guagua", "carro", "auto", "peaje", "marbete", "maintenance", "aceite", "malpractice"],
  ["ahorro", "ahorros", "hysa", "oficina", "vacaciones", "inversiones", "inversion", "invertir"],
  ["seguro", "medico", "salud", "malpractice", "plan"],
  ["suscripcion", "suscripciones", "netflix", "spotify", "hbo", "costco", "servicio", "carretera", "streaming"],
  ["casa", "renta", "phone", "telefono", "luz", "agua", "internet"],
  ["gym", "grooming", "personal", "cuidado", "ocio", "entertainment", "free", "spending", "entretenimiento"],
  ["impuestos", "taxes", "fica", "prestamo"],
];
const GROUP_WORDS = { esencial: "esencial esenciales", no_esencial: "no esencial esenciales", ahorro: "ahorro inversion inversiones" };

function searchLines(lines, query) {
  const tokens = norm(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return { direct: [], related: [] };
  const hay = l => norm([l.nombre, l.nota, (l.categorias || []).join(" "), GROUP_WORDS[l.grupo],
    [bi(l.anual), me(l.anual), l.anual].join(" ")].join(" "));
  const direct = lines.filter(l => { const h = hay(l); return tokens.every(t => h.includes(t)); });
  const directIds = new Set(direct.map(l => l.id));
  const hit = RELATED.filter(g => tokens.some(t => g.some(w => w.startsWith(t) || (t.length >= 3 && t.startsWith(w)))));
  const related = lines.filter(l => {
    if (directIds.has(l.id)) return false;
    const h = norm(l.nombre);
    return hit.some(g => g.some(w => h.includes(w)));
  });
  return { direct, related };
}
const bi = a => lineAmount(a, "bisemanal").toFixed(2);
const me = a => lineAmount(a, "mensual").toFixed(2);

const readKind = () => { try { const k = localStorage.getItem("bolsillo_budget_kind"); return KINDS.includes(k) ? k : "mensual"; } catch { return "mensual"; } };
const saveKind = k => { try { localStorage.setItem("bolsillo_budget_kind", k); } catch { /* storage unavailable */ } };

export default function Budget({ expenses, fetcher, showToast, owedFor, categories, catEmoji, fmt, todayStr, scriptUrl }) {
  const [data, setData] = useState({ lines: [], config: { sueldoNetoAnual: 0, anclaPago: "", fondoMeses: 3 }, ingresos: [] });
  const [state, setState] = useState("loading"); // loading | ok | error
  const [kind, setKind] = useState(readKind);
  const [ref, setRef] = useState(todayStr);
  const [form, setForm] = useState(null);       // edit/add modal
  const [confirmDel, setConfirmDel] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [cfgForm, setCfgForm] = useState({ ingresos: [], fondoMeses: "3", anclaPago: "" });
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");
  const [searchFocus, setSearchFocus] = useState(false);

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
      setData({ lines: out.lines || [], config: out.config || { sueldoNetoAnual: 0, anclaPago: "", fondoMeses: 3 }, ingresos: out.ingresos || [] });
      setState("ok");
    } catch (err) {
      console.error(err);
      setState("error");
    }
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const { lines, config, ingresos } = data;
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
  // Emergency fund suggested: N months of essential expenses.
  const fondoMeses = config.fondoMeses || 3;
  const esencialesAnual = lines.filter(l => l.grupo === "esencial").reduce((sum, l) => sum + (Number(l.anual) || 0), 0);
  const esencialesMes = lineAmount(esencialesAnual, "mensual");
  const fondoSugerido = Math.round(esencialesMes * fondoMeses * 100) / 100;
  const measuredRows = rows.filter(r => r.measured);
  const searching = q.trim().length > 0;
  const found = useMemo(() => searchLines(lines, q), [lines, q]);
  const shownIds = new Set([...found.direct, ...found.related].map(l => l.id));
  const suggestions = [...found.direct.slice(0, 5).map(l => ({ l, rel: false })), ...found.related.slice(0, 3).map(l => ({ l, rel: true }))];
  const measuredBudget = measuredRows.reduce((s, r) => s + r.budget, 0);
  const measuredSpent = measuredRows.reduce((s, r) => s + r.spent, 0);

  function changeKind(k) { setKind(k); saveKind(k); }

  // ---- drag and drop: reorder lines, or move one to another table ----
  const [drag, setDrag] = useState(null);            // { id, name, x, y, over: { grupo, beforeId } | null }
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const saveChain = useRef(Promise.resolve());

  // Where would the dragged line land if released at (x, y)?
  function locate(x, y, dragId) {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const tr = el.closest("tr[data-line-id]");
    if (tr) {
      const id = tr.dataset.lineId, grupo = tr.dataset.group;
      if (id === dragId) return { grupo, beforeId: dragId };
      const r = tr.getBoundingClientRect();
      if (y < r.top + r.height / 2) return { grupo, beforeId: id };
      let next = tr.nextElementSibling;
      while (next && !next.dataset.lineId) next = next.nextElementSibling;   // skip the Total row
      return { grupo, beforeId: next ? next.dataset.lineId : null };
    }
    const box = el.closest("[data-group]");
    if (!box) return null;
    if (el.closest("thead")) {
      const first = box.querySelector("tr[data-line-id]");
      return { grupo: box.dataset.group, beforeId: first ? first.dataset.lineId : null };
    }
    return { grupo: box.dataset.group, beforeId: null };
  }

  function startDrag(e, row) {
    e.preventDefault();
    e.stopPropagation();
    const st = { id: row.id, name: row.nombre, x: e.clientX, y: e.clientY, over: null };
    const sync = () => setDrag({ ...st });
    const place = () => { st.over = locate(st.x, st.y, st.id); sync(); };
    const onMove = ev => { st.x = ev.clientX; st.y = ev.clientY; place(); };
    // Near the top or bottom edge the page scrolls by itself so a line can travel far.
    const tick = setInterval(() => {
      const zone = 90, h = window.innerHeight;
      if (st.y < zone) window.scrollBy(0, -Math.ceil((zone - st.y) / 6));
      else if (st.y > h - zone) window.scrollBy(0, Math.ceil((st.y - (h - zone)) / 6));
      else return;
      place();
    }, 30);
    const finish = commit => {
      clearInterval(tick);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      document.body.style.userSelect = "";
      setDrag(null);
      if (commit) dropLine(st);
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    place();
  }

  function dropLine(st) {
    const over = st.over;
    if (!over || over.beforeId === st.id) return;
    const current = linesRef.current;
    const next = moveLine(current, st.id, over.grupo, over.beforeId);
    const same = next.length === current.length && next.every((l, i) => l.id === current[i].id && l.grupo === current[i].grupo);
    if (same) return;
    setData(d => ({ ...d, lines: next }));
    // One save at a time, in the order they were made (the Drive view is rebuilt after each).
    saveChain.current = saveChain.current
      .then(() => post("budget-reorder", { items: next.map(l => ({ id: l.id, grupo: l.grupo })) }))
      .catch(err => { console.error(err); showToast("No se pudo guardar el orden", "warn"); return load(); });
  }
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
    const people = cfgForm.ingresos.filter(p => String(p.nombre).trim() || p.neto !== "" || p.bruto !== "");
    if (people.some(p => !String(p.nombre).trim())) { showToast("Cada ingreso necesita un nombre", "warn"); return; }
    setSaving(true);
    try {
      const out = await post("budget-ingresos", {
        ingresos: people.map(p => ({ id: p.id, nombre: String(p.nombre).trim(), bruto: p.bruto === "" ? "" : Number(p.bruto), neto: p.neto === "" ? 0 : Number(p.neto) })),
        fondoMeses: Number(cfgForm.fondoMeses) || 3,
      });
      const cfg = await post("budget-config", { anclaPago: cfgForm.anclaPago });
      setData(d => ({ ...d, ingresos: out.ingresos, config: { ...cfg.config, fondoMeses: out.config.fondoMeses } }));
      setShowSettings(false);
      showToast("Ajustes guardados");
    } catch (err) {
      console.error(err);
      showToast("No se pudo guardar", "warn");
    } finally { setSaving(false); }
  }
  function openSettings() {
    // Older installs only have a single net amount: start the list with it.
    const list = ingresos.length ? ingresos : (config.sueldoNetoAnual ? [{ nombre: "Sueldo", bruto: "", neto: config.sueldoNetoAnual }] : [{ nombre: "", bruto: "", neto: "" }]);
    setCfgForm({
      ingresos: list.map(p => ({ id: p.id, nombre: p.nombre, bruto: p.bruto === "" ? "" : String(p.bruto), neto: p.neto === "" ? "" : String(p.neto) })),
      fondoMeses: String(fondoMeses),
      anclaPago: config.anclaPago || "",
    });
    setShowSettings(true);
  }
  const setPerson = (i, patch) => setCfgForm(f => ({ ...f, ingresos: f.ingresos.map((p, k) => k === i ? { ...p, ...patch } : p) }));
  const netoNido = cfgForm.ingresos.reduce((sum, p) => sum + (Number(p.neto) || 0), 0);
  const brutoNido = cfgForm.ingresos.reduce((sum, p) => sum + (Number(p.bruto) || 0), 0);

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
    .bd-handle{display:inline-block;width:20px;margin-right:2px;color:#b8c2d0;font-size:15px;line-height:1;letter-spacing:-3px;cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none;vertical-align:middle;padding:6px 0;}
    .bd-dragging td{opacity:.35;}
    .bd-t tr.bd-drop td{box-shadow:inset 0 3px 0 #0f4c81;}
    .bd-t tr.bd-quiet td{color:#64748b;font-style:italic;font-size:12px;}
    .bd-t tr.bd-sub td{font-weight:700;background:#eef2f7!important;border-top:1px solid #94a3b8;}
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

      {lines.length > 0 && (
        <div style={{ position: "relative", marginBottom: 12 }}>
          <div style={{ position: "relative" }}>
            <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 14, color: "#94a3b8", pointerEvents: "none" }}>🔍</span>
            <input className="inp" style={{ paddingLeft: 36, paddingRight: 36 }} type="text" inputMode="search" enterKeyHint="search" autoComplete="off" autoCorrect="off" autoCapitalize="off"
              placeholder="Buscar en el presupuesto (renta, gas, 900…)" value={q} aria-label="Buscar en el presupuesto"
              onChange={e => setQ(e.target.value)} onFocus={() => setSearchFocus(true)} onBlur={() => setTimeout(() => setSearchFocus(false), 150)}
              onKeyDown={e => { if (e.key === "Enter" && suggestions[0]) { e.preventDefault(); openEdit(rows.find(r => r.id === suggestions[0].l.id)); setSearchFocus(false); } if (e.key === "Escape") setQ(""); }} />
            {searching && (
              <button aria-label="Borrar búsqueda" onMouseDown={e => e.preventDefault()} onClick={() => setQ("")}
                style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", width: 30, height: 30, border: "none", background: "none", fontSize: 16, color: "#94a3b8", cursor: "pointer" }}>✕</button>
            )}
          </div>
          {searching && searchFocus && (
            <div className="suggest" style={{ maxHeight: 340, overflowY: "auto" }}>
              {suggestions.length === 0 && <div style={{ padding: "12px 14px", fontSize: 13, color: "#94a3b8" }}>Sin resultados para “{q.trim()}”</div>}
              {suggestions.map(({ l, rel }, i) => {
                const g = GROUPS.find(x => x.id === l.grupo);
                const prev = suggestions[i - 1];
                return (
                  <div key={l.id}>
                    {rel && (!prev || !prev.rel) && <div style={{ padding: "6px 14px", fontSize: 10, letterSpacing: 1, fontWeight: 700, color: "#94a3b8", background: "#f8fafc" }}>RELACIONADO</div>}
                    <div className="suggest-item" onMouseDown={e => e.preventDefault()}
                      onClick={() => { openEdit(rows.find(r => r.id === l.id)); setSearchFocus(false); }}
                      style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontWeight: 600 }}>{l.nombre}</span>
                        <span style={{ display: "block", fontSize: 11, color: "#94a3b8" }}>{g?.title} · {fmt(lineAmount(l.anual, "mensual"))}/mes</span>
                      </span>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 99, background: g?.bg, color: g?.fg }}>{g?.title}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
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
            <button onClick={openSettings} style={{ marginTop: 12, border: "none", background: "none", color: "#0f4c81", fontSize: 11, fontWeight: 700, cursor: "pointer", padding: 0, fontFamily: "inherit" }}>⚙️ Ingresos, fondo y fecha de pago</button>
          </div>

          {!searching && <table className="bd-t">
            <thead>
              <tr><th className="g" colSpan={4} style={{ background: "#f8fafc", color: "#0f172a" }}>Ingresos y resumen</th></tr>
              <ColHead />
            </thead>
            <tbody>
              {ingresos.map(p => (
                <Fragment key={p.id}>
                  {Number(p.bruto) > 0 && <tr className="bd-quiet"><td>Sueldo bruto {p.nombre}</td><Nums vals={amountsOf(p.bruto)} fmt={fmt} /></tr>}
                  <tr><td>Sueldo neto {p.nombre}</td><Nums vals={amountsOf(p.neto)} fmt={fmt} /></tr>
                </Fragment>
              ))}
              {ingresos.length > 1 && <tr className="bd-sub"><td>Sueldo neto Nido</td><Nums vals={totals.sueldo} fmt={fmt} /></tr>}
              {ingresos.length === 0 && <tr><td>Sueldo neto</td><Nums vals={totals.sueldo} fmt={fmt} /></tr>}
              <tr><td>Planificado</td><Nums vals={totals.plan} fmt={fmt} /></tr>
              <tr className="tot"><td style={over ? { color: "#dc2626" } : undefined}>{over ? "Te pasas del sueldo" : "Sin asignar"}</td><Nums vals={totals.sinAsignar} fmt={fmt} tone={over ? "#dc2626" : null} /></tr>
            </tbody>
          </table>}

          {!searching && (
            <div className="bd-card" style={{ padding: 14 }}>
              <div style={{ fontSize: 11, letterSpacing: 1, fontWeight: 700, color: "#94a3b8", marginBottom: 6 }}>🛟 FONDO DE EMERGENCIA SUGERIDO</div>
              <div style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmt(fondoSugerido)}</div>
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>{fondoMeses} {fondoMeses === 1 ? "mes" : "meses"} × {fmt(esencialesMes)} de gastos esenciales al mes</div>
              <button onClick={openSettings} style={{ marginTop: 8, border: "none", background: "none", color: "#0f4c81", fontSize: 11, fontWeight: 700, cursor: "pointer", padding: 0, fontFamily: "inherit" }}>Cambiar los meses</button>
            </div>
          )}

          {searching && (
            <div style={{ fontSize: 12, color: "#64748b", margin: "0 2px 10px" }}>
              {shownIds.size === 0 ? `Sin resultados para “${q.trim()}”` : `${found.direct.length} resultado${found.direct.length !== 1 ? "s" : ""}${found.related.length ? ` · ${found.related.length} relacionado${found.related.length !== 1 ? "s" : ""}` : ""}`}
            </div>
          )}

          {GROUPS.map(g => {
            const groupRows = rows.filter(r => r.grupo === g.id && (!searching || shownIds.has(r.id)));
            if (searching && groupRows.length === 0) return null;
            const over = drag?.over;
            const canDrag = !searching && lines.length > 1;
            return (
              <div key={g.id} data-group={g.id} style={{ marginBottom: 14 }}>
                <table className="bd-t" style={{ marginBottom: 6 }}>
                  <thead>
                    <tr><th className="g" colSpan={4} style={{ background: g.bg, color: g.fg }}>{g.title}</th></tr>
                    <ColHead />
                  </thead>
                  <tbody>
                    {groupRows.map(r => (
                      <tr key={r.id} data-line-id={r.id} data-group={g.id}
                        className={`bd-tr ${drag?.id === r.id ? "bd-dragging" : ""} ${over && over.grupo === g.id && over.beforeId === r.id && drag.id !== r.id ? "bd-drop" : ""}`}
                        onClick={() => openEdit(r)}>
                        <td>
                          {canDrag && (
                            <span className="bd-handle" role="button" aria-label={`Arrastrar ${r.nombre} para reordenar`}
                              onPointerDown={e => startDrag(e, r)} onClick={e => e.stopPropagation()}>⋮⋮</span>
                          )}
                          {r.nombre}{searching && !found.direct.some(d => d.id === r.id) && <span className="sub" style={{ color: "#0f4c81" }}>Relacionado</span>}
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
                    {!searching && <tr className={`tot ${over && over.grupo === g.id && over.beforeId === null ? "bd-drop" : ""}`}><td>Total</td><Nums vals={totals.groups[g.id]} fmt={fmt} /></tr>}
                  </tbody>
                </table>
                <button className="btn btn-g" style={{ width: "100%", padding: "8px" }} onClick={() => openAdd(g.id)}>+ Agregar línea</button>
              </div>
            );
          })}
        </>
      )}

      {drag && (
        <div style={{ position: "fixed", left: drag.x + 12, top: drag.y - 18, zIndex: 400, pointerEvents: "none", background: "#0f4c81", color: "#fff", fontSize: 13, fontWeight: 600, padding: "7px 12px", borderRadius: 10, boxShadow: "0 8px 20px rgba(15,76,129,.35)", maxWidth: 220, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{drag.name}</div>
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
            <div style={{ fontSize: 11, letterSpacing: 2, color: "#0f4c81", marginBottom: 14, fontWeight: 700 }}>INGRESOS, FONDO Y FECHA DE PAGO</div>
            <div className="field"><label>Ingresos de cada persona (por año)</label>
              {cfgForm.ingresos.map((p, i) => (
                <div key={i} style={{ padding: "10px 0", borderBottom: "1px solid #f1f5f9" }}>
                  <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                    <input className="inp" placeholder="Nombre" value={p.nombre} maxLength={40} onChange={e => setPerson(i, { nombre: e.target.value })} />
                    {cfgForm.ingresos.length > 1 && <button type="button" className="btn btn-g btn-sm" aria-label={`Quitar a ${p.nombre || "persona"}`} onClick={() => setCfgForm(f => ({ ...f, ingresos: f.ingresos.filter((_, k) => k !== i) }))}>✕</button>}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 700, marginBottom: 4 }}>Sueldo bruto</div>
                      <input className="inp" type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" value={p.bruto} onChange={e => setPerson(i, { bruto: e.target.value })} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 700, marginBottom: 4 }}>Sueldo neto</div>
                      <input className="inp" type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" value={p.neto} onChange={e => setPerson(i, { neto: e.target.value })} />
                    </div>
                  </div>
                </div>
              ))}
              {cfgForm.ingresos.length < 10 && <button type="button" className="btn btn-g btn-sm" style={{ marginTop: 10 }} onClick={() => setCfgForm(f => ({ ...f, ingresos: [...f.ingresos, { nombre: "", bruto: "", neto: "" }] }))}>+ Agregar persona</button>}
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700, marginTop: 12 }}>
                <span>Neto combinado (Nido)</span><span>{fmt(netoNido)}</span>
              </div>
              {brutoNido > 0 && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#94a3b8", marginTop: 2 }}><span>Bruto combinado</span><span>{fmt(brutoNido)}</span></div>}
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>
                {KINDS.map(k => `${KIND_LABEL[k]} ${fmt(lineAmount(netoNido, k))}`).join(" · ")}
              </div>
            </div>
            <div className="field"><label>Fondo de emergencia: meses de gastos esenciales</label>
              <input className="inp" type="number" min="1" max="36" step="1" inputMode="numeric" value={cfgForm.fondoMeses} onChange={e => setCfgForm(f => ({ ...f, fondoMeses: e.target.value }))} />
              <div style={{ fontSize: 10.5, color: "#94a3b8", marginTop: 6 }}>El fondo sugerido es la suma de tus gastos esenciales de un mes por esta cantidad de meses.</div>
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
