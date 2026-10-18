import { useState, useEffect, useMemo } from "react";
import { computeSplit, buildMessage, money, toCents } from "./splitMath.js";

// "Dividir cuenta", step by step: 1 people, 2 subtotal and tax from the receipt,
// 3 dishes (assigned to people, with what's left of the subtotal), 4 tip and
// total, 5 message. Inspired by Plates by Splitwise. Math in splitMath.js.

const DRAFT_KEY = "bolsillo_split_draft_v2";
const COLORS = ["#0f4c81", "#b45309", "#059669", "#7c3aed", "#db2777", "#0891b2", "#65a30d", "#dc2626", "#475569", "#ca8a04"];
const MAX_PEOPLE = 10;
const REST_ID = "rest";
const uid = () => Math.random().toString(36).slice(2, 9);
const blankItem = () => ({ id: uid(), name: "", price: "", people: [] });

const fresh = (todayStr, me) => {
  const id = uid();
  return {
    merchant: "", date: todayStr, payer: id, withItems: false,
    people: [{ id, name: me, mergedInto: null }],
    subtotal: "",
    items: [blankItem()],
    tax: { mode: "amt", value: "" }, tip: { mode: "pct", value: "" },
  };
};
const readDraft = (todayStr, me) => {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
    if (d && Array.isArray(d.people) && Array.isArray(d.items) && d.people.length) return d;
  } catch { /* no draft */ }
  return fresh(todayStr, me);
};

export default function Split({ suggestedNames, me = "Omar", todayStr, showToast }) {
  const [s, setS] = useState(() => readDraft(todayStr, me));
  const [newName, setNewName] = useState("");
  const set = patch => setS(prev => ({ ...prev, ...patch }));

  useEffect(() => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
  }, [s]);

  const idx = Object.fromEntries(s.people.map((p, i) => [p.id, i]));
  const colorOf = id => COLORS[(idx[id] ?? 0) % COLORS.length];
  const result = useMemo(() => computeSplit({ items: s.items, people: s.people, subtotal: s.subtotal, tax: s.tax, tip: s.tip }),
    [s.items, s.people, s.subtotal, s.tax, s.tip]);
  const message = useMemo(() => buildMessage({ merchant: s.merchant, date: s.date, payerId: s.payer, result, withItems: s.withItems }),
    [s.merchant, s.date, s.payer, result, s.withItems]);

  // ---- people ----
  function addPerson(name) {
    const n = String(name || "").trim();
    if (!n || s.people.length >= MAX_PEOPLE) return;
    if (s.people.some(p => p.name.toLowerCase() === n.toLowerCase())) { showToast("Ya está en la cuenta", "warn"); return; }
    set({ people: [...s.people, { id: uid(), name: n, mergedInto: null }] });
    setNewName("");
  }
  function removePerson(id) {
    if (s.people.length <= 1) return;
    const people = s.people.filter(p => p.id !== id).map(p => p.mergedInto === id ? { ...p, mergedInto: null } : p);
    set({
      people,
      payer: s.payer === id ? people[0].id : s.payer,
      items: s.items.map(it => ({ ...it, people: it.people.filter(x => x !== id) })),
    });
  }
  const renamePerson = (id, name) => set({ people: s.people.map(p => p.id === id ? { ...p, name } : p) });
  function mergePerson(id, headId) {
    set({ people: s.people.map(p => p.id === id ? { ...p, mergedInto: headId || null } : p.mergedInto === id && headId ? { ...p, mergedInto: headId } : p) });
  }

  // ---- dishes ----
  const updateItem = (id, patch) => set({ items: s.items.map(it => it.id === id ? { ...it, ...patch } : it) });
  const addItem = () => set({ items: [...s.items, blankItem()] });
  const removeItem = id => set({ items: s.items.length > 1 ? s.items.filter(it => it.id !== id) : [blankItem()] });
  const toggleWho = (itemId, personId) => set({
    items: s.items.map(it => it.id !== itemId ? it : { ...it, people: it.people.includes(personId) ? it.people.filter(x => x !== personId) : [...it.people, personId] }),
  });
  const allIds = s.people.map(p => p.id);
  const isEveryone = it => allIds.length > 0 && allIds.every(id => it.people.includes(id));
  const toggleEveryone = it => updateItem(it.id, { people: isEveryone(it) ? [] : allIds });

  // What's left of the subtotal goes to everyone in equal parts, as one more line.
  function splitRest() {
    if (result.remaining <= 0) return;
    const price = (result.remaining / 100).toFixed(2);
    const has = s.items.some(it => it.id === REST_ID);
    const rest = { id: REST_ID, name: "Resto de la cuenta", price, people: allIds };
    const items = has ? s.items.map(it => it.id === REST_ID ? rest : it) : [...s.items.filter(it => it.name || it.price), rest];
    set({ items });
  }

  function reset() {
    if (!window.confirm("¿Empezar una cuenta nueva? Se borra la actual.")) return;
    setS(fresh(todayStr, me));
  }

  async function share() {
    try {
      if (navigator.share) await navigator.share({ text: message });
      else { await navigator.clipboard.writeText(message); showToast("Mensaje copiado"); }
    } catch (err) { if (err?.name !== "AbortError") showToast("No se pudo compartir", "warn"); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(message); showToast("Mensaje copiado"); }
    catch { showToast("No se pudo copiar", "warn"); }
  }

  const heads = s.people.filter(p => !p.mergedInto);
  const hasSubtotal = result.declared > 0;
  const over = result.remaining < 0;
  const done = hasSubtotal && result.remaining === 0;
  const pendingItems = s.items.filter(it => toCents(it.price) > 0 && !it.people.length);
  const barColor = over ? "#dc2626" : done ? "#059669" : "#0f4c81";
  const barPct = hasSubtotal ? Math.min(100, Math.round((result.itemsTotal / result.declared) * 100)) : 0;

  const css = `
    .sp-card{background:#fff;border-radius:16px;padding:16px;margin-bottom:12px;box-shadow:0 1px 3px rgba(15,23,42,.06);}
    .sp-title{font-size:11px;letter-spacing:1px;font-weight:700;color:#94a3b8;margin-bottom:10px;}
    .sp-chip{display:inline-flex;align-items:center;gap:5px;padding:6px 11px;border-radius:99px;border:1.5px solid #e2e8f0;background:#fff;font-size:12px;font-weight:600;color:#64748b;cursor:pointer;font-family:inherit;margin:0 5px 5px 0;}
    .sp-chip.on{background:#eff6ff;border-color:#0f4c81;color:#0f4c81;}
    .sp-in{background:#fff;border:1.5px solid #e2e8f0;border-radius:10px;padding:9px 11px;font-family:inherit;font-size:14px;color:#0f172a;min-width:0;}
    .sp-in:focus{border-color:#0f4c81;}
    .sp-row{display:flex;gap:8px;align-items:center;}
    .sp-mini{border:none;background:none;color:#94a3b8;font-size:12px;cursor:pointer;font-family:inherit;padding:4px 6px;}
    .sp-sum{display:flex;justify-content:space-between;font-size:13px;padding:3px 0;color:#475569;}
    .sp-lab{font-size:12px;font-weight:600;color:#475569;margin-bottom:5px;}
    .sp-bar{height:8px;background:#f1f5f9;border-radius:99px;overflow:hidden;}
    .sp-bar>div{height:100%;border-radius:99px;transition:width .2s;}
  `;

  // Tax or tip: an amount ($) or a percentage (%) of the subtotal.
  const modeToggle = key => (
    <div className="ptt" style={{ width: 84, flexShrink: 0 }}>
      <button type="button" className={`pto ${s[key].mode === "pct" ? "on" : ""}`} onClick={() => set({ [key]: { ...s[key], mode: "pct", value: "" } })}>%</button>
      <button type="button" className={`pto ${s[key].mode === "amt" ? "on" : ""}`} onClick={() => set({ [key]: { ...s[key], mode: "amt", value: "" } })}>$</button>
    </div>
  );
  const amountInput = (key, label) => (
    <input className="sp-in" style={{ flex: 1, textAlign: "right" }} type="number" inputMode="decimal" min="0" step="0.01"
      placeholder={s[key].mode === "pct" ? "0" : "0.00"} value={s[key].value} aria-label={label}
      onChange={e => set({ [key]: { ...s[key], value: e.target.value } })} />
  );
  const tipIs = pct => s.tip.mode === "pct" && String(s.tip.value) === String(pct);

  return (
    <div>
      <style>{css}</style>

      {/* 1. People */}
      <div className="sp-card">
        <div className="sp-title">1 · QUIÉNES PARTICIPAN ({s.people.length}/{MAX_PEOPLE})</div>
        {s.people.map(p => {
          const t = result.per[p.id]?.total || 0;
          const others = heads.filter(h => h.id !== p.id && !s.people.some(x => x.mergedInto === p.id));
          return (
            <div key={p.id} style={{ padding: "8px 0", borderBottom: "1px solid #f1f5f9" }}>
              <div className="sp-row">
                <span style={{ width: 12, height: 12, borderRadius: "50%", background: colorOf(p.id), flexShrink: 0 }} />
                <input className="sp-in" style={{ flex: 1 }} value={p.name} onChange={e => renamePerson(p.id, e.target.value)} aria-label="Nombre" />
                {t > 0 && <b style={{ fontSize: 13, fontVariantNumeric: "tabular-nums", color: "#64748b" }}>{money(t)}</b>}
                {s.people.length > 1 && <button className="sp-mini" aria-label={`Quitar a ${p.name}`} onClick={() => removePerson(p.id)}>✕</button>}
              </div>
              <div className="sp-row" style={{ marginTop: 6, paddingLeft: 20, flexWrap: "wrap" }}>
                <button type="button" className={`sp-chip ${s.payer === p.id ? "on" : ""}`} aria-pressed={s.payer === p.id} style={{ margin: 0 }} onClick={() => set({ payer: p.id })}>
                  {s.payer === p.id ? "✓ Pagó" : "Pagó"}
                </button>
                {s.people.length > 1 && (
                  <select className="sp-in" style={{ padding: "4px 8px", fontSize: 12 }} value={p.mergedInto || ""} onChange={e => mergePerson(p.id, e.target.value)} aria-label={`Quién paga por ${p.name}`}>
                    <option value="">Paga por sí mismo</option>
                    {others.map(h => <option key={h.id} value={h.id}>Lo paga {h.name}</option>)}
                  </select>
                )}
              </div>
            </div>
          );
        })}
        {s.people.length < MAX_PEOPLE && (
          <>
            <form className="sp-row" style={{ marginTop: 10 }} onSubmit={e => { e.preventDefault(); addPerson(newName); }}>
              <input className="sp-in" style={{ flex: 1 }} placeholder="Agregar persona" value={newName} onChange={e => setNewName(e.target.value)} />
              <button className="btn btn-p btn-sm" type="submit">Agregar</button>
            </form>
            <div style={{ marginTop: 8 }}>
              {(suggestedNames || []).filter(n => !s.people.some(p => p.name.toLowerCase() === n.toLowerCase())).slice(0, 8).map(n => (
                <button key={n} type="button" className="sp-chip" onClick={() => addPerson(n)}>+ {n}</button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* 2. Subtotal and tax */}
      <div className="sp-card">
        <div className="sp-title">2 · SUBTOTAL E IMPUESTO DEL RECIBO</div>
        <div className="sp-lab">Subtotal (antes de impuesto y propina)</div>
        <input className="sp-in" style={{ width: "100%", marginBottom: 14, fontSize: 16 }} type="number" inputMode="decimal" min="0" step="0.01" placeholder="$ 0.00"
          value={s.subtotal} onChange={e => set({ subtotal: e.target.value })} aria-label="Subtotal" />
        <div className="sp-lab">Impuesto total</div>
        <div className="sp-row">
          {modeToggle("tax")}
          {amountInput("tax", "Impuesto")}
        </div>
        <div style={{ marginTop: 8, display: "flex", alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" className={`sp-chip ${s.tax.mode === "pct" && String(s.tax.value) === "11.5" ? "on" : ""}`} style={{ padding: "4px 10px", fontSize: 11 }}
            onClick={() => set({ tax: { mode: "pct", value: "11.5" } })}>IVU 11.5%</button>
          {s.tax.mode === "pct" && result.taxCents > 0 && <span style={{ fontSize: 12, color: "#64748b" }}>= {money(result.taxCents)}</span>}
        </div>
      </div>

      {/* 3. Dishes */}
      <div className="sp-card">
        <div className="sp-title">3 · PLATOS</div>
        {hasSubtotal ? (
          <div style={{ marginBottom: 12 }}>
            <div className="sp-row" style={{ justifyContent: "space-between", marginBottom: 6, fontSize: 12 }}>
              <span style={{ color: "#64748b" }}>Asignado {money(result.itemsTotal)} de {money(result.declared)}</span>
              <b style={{ color: barColor }}>{over ? `Te pasaste ${money(-result.remaining)}` : done ? "Completo ✓" : `Quedan ${money(result.remaining)}`}</b>
            </div>
            <div className="sp-bar"><div style={{ width: `${barPct}%`, background: barColor }} /></div>
          </div>
        ) : (
          <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 12 }}>Pon el subtotal arriba para ver cuánto va quedando mientras agregas platos.</div>
        )}

        {s.items.map(it => {
          const pending = toCents(it.price) > 0 && !it.people.length;
          return (
            <div key={it.id} style={{ padding: "10px 0", borderBottom: "1px solid #f1f5f9" }}>
              <div className="sp-row">
                <input className="sp-in" style={{ flex: 1 }} placeholder="Plato" value={it.name} onChange={e => updateItem(it.id, { name: e.target.value })} aria-label="Plato" />
                <input className="sp-in" style={{ width: 84, textAlign: "right" }} type="number" inputMode="decimal" min="0" step="0.01" placeholder="0.00" value={it.price} onChange={e => updateItem(it.id, { price: e.target.value })} aria-label="Precio" />
                <button className="sp-mini" aria-label="Quitar plato" onClick={() => removeItem(it.id)}>✕</button>
              </div>
              <div style={{ marginTop: 8 }}>
                {s.people.length > 1 && (
                  <button type="button" className={`sp-chip ${isEveryone(it) ? "on" : ""}`} aria-pressed={isEveryone(it)} onClick={() => toggleEveryone(it)}>
                    {isEveryone(it) ? "✓ " : ""}Partes iguales
                  </button>
                )}
                {s.people.map(p => {
                  const on = it.people.includes(p.id);
                  return (
                    <button key={p.id} type="button" className="sp-chip" onClick={() => toggleWho(it.id, p.id)}
                      style={on ? { background: colorOf(p.id), borderColor: colorOf(p.id), color: "#fff" } : undefined}>
                      {p.name || "…"}
                    </button>
                  );
                })}
                {pending && <span style={{ fontSize: 11, color: "#b45309", fontWeight: 700, marginLeft: 4 }}>Sin asignar</span>}
                {it.people.length > 1 && toCents(it.price) > 0 && <span style={{ fontSize: 11, color: "#94a3b8", marginLeft: 4 }}>{money(Math.floor(toCents(it.price) / it.people.length))} c/u</span>}
              </div>
            </div>
          );
        })}

        <div className="sp-row" style={{ marginTop: 10 }}>
          <button className="btn btn-g" style={{ flex: 1 }} onClick={addItem}>+ Plato</button>
          <button className="btn btn-g" style={{ flex: 1 }} onClick={splitRest} disabled={!(result.remaining > 0)}>Dividir el resto</button>
        </div>
        {pendingItems.length > 0 && <div style={{ fontSize: 11, color: "#b45309", marginTop: 8 }}>{pendingItems.length} plato{pendingItems.length !== 1 ? "s" : ""} sin asignar ({money(result.unassigned)}). Toca “Partes iguales” o los nombres de quienes lo comieron.</div>}
        {result.remaining > 0 && <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 8 }}>“Dividir el resto” reparte los {money(result.remaining)} que faltan en partes iguales entre todos.</div>}
      </div>

      {/* 4. Tip and total */}
      <div className="sp-card">
        <div className="sp-title">4 · PROPINA Y TOTAL</div>
        <div className="sp-sum"><span>Subtotal</span><span>{money(hasSubtotal ? result.declared : result.assigned)}</span></div>
        <div className="sp-sum"><span>Impuesto</span><span>{money(result.taxCents)}</span></div>

        <div className="sp-lab" style={{ marginTop: 12 }}>Propina</div>
        <div style={{ marginBottom: 6 }}>
          {[15, 18, 20].map(q => (
            <button key={q} type="button" className={`sp-chip ${tipIs(q) ? "on" : ""}`} onClick={() => set({ tip: { mode: "pct", value: String(q) } })}>{q}%</button>
          ))}
          <button type="button" className={`sp-chip ${s.tip.value !== "" && ![15, 18, 20].some(tipIs) ? "on" : ""}`} onClick={() => set({ tip: { mode: "amt", value: "" } })}>Otro</button>
          <button type="button" className="sp-chip" onClick={() => set({ tip: { mode: "pct", value: "" } })}>Sin propina</button>
        </div>
        <div className="sp-row">
          {modeToggle("tip")}
          {amountInput("tip", "Propina")}
        </div>
        <div className="sp-sum" style={{ marginTop: 8 }}><span>Propina{s.tip.mode === "pct" && s.tip.value ? ` (${s.tip.value}%)` : ""}</span><span>{money(result.tipCents)}</span></div>

        <div className="sp-sum" style={{ fontWeight: 700, fontSize: 17, color: "#0f172a", borderTop: "1px solid #e2e8f0", marginTop: 6, paddingTop: 10 }}>
          <span>Total</span><span>{money(result.grand)}</span>
        </div>
        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>La propina y el impuesto se reparten en proporción a lo que consumió cada quien. La propina se calcula sobre el subtotal.</div>

        <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #f1f5f9" }}>
          <div className="sp-title" style={{ marginBottom: 6 }}>CADA QUIEN</div>
          {result.groups.map(g => (
            <div key={g.head.id} className="sp-row" style={{ padding: "6px 0" }}>
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: colorOf(g.head.id) }} />
              <span style={{ flex: 1, fontSize: 14 }}>
                {g.head.name}{g.members.length > 1 && <span style={{ color: "#94a3b8", fontSize: 11 }}> (+ {g.members.filter(m => m.id !== g.head.id).map(m => m.name).join(", ")})</span>}
                {g.members.some(m => m.id === s.payer) && <span className="badge badge-blue" style={{ fontSize: 9, marginLeft: 6 }}>Pagó</span>}
              </span>
              <b style={{ fontVariantNumeric: "tabular-nums" }}>{money(g.total)}</b>
            </div>
          ))}
        </div>
      </div>

      {/* 5. Message */}
      <div className="sp-card">
        <div className="sp-title">5 · MENSAJE PARA EL GRUPO</div>
        <input className="sp-in" style={{ width: "100%", marginBottom: 8 }} placeholder="Restaurante o motivo (ej. Texas Roadhouse)" value={s.merchant} onChange={e => set({ merchant: e.target.value })} aria-label="Restaurante o motivo" />
        <input className="sp-in" style={{ width: "100%", marginBottom: 10 }} type="date" value={s.date} onChange={e => set({ date: e.target.value })} aria-label="Fecha" />
        <div style={{ background: "#f8fafc", borderRadius: 10, padding: 12, fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap", color: "#334155" }}>
          {result.grand > 0 ? message : "Agrega el subtotal y los platos para ver el mensaje."}
        </div>
        <div style={{ margin: "10px 0" }}>
          <button type="button" className={`sp-chip ${s.withItems ? "on" : ""}`} aria-pressed={s.withItems} onClick={() => set({ withItems: !s.withItems })}>
            {s.withItems ? "✓ " : ""}Incluir el desglose por plato
          </button>
        </div>
        {result.grand > 0 && !result.complete && (
          <div style={{ fontSize: 11, color: "#b45309", marginBottom: 8 }}>
            {over ? `Los platos suman ${money(-result.remaining)} más que el subtotal.` : result.remaining > 0 ? `Todavía faltan ${money(result.remaining)} por asignar.` : "Hay platos sin asignar."} Puedes compartir igual, pero las partes no sumarán el total.
          </div>
        )}
        <div className="sp-row">
          <button className="btn btn-p" style={{ flex: 1 }} onClick={share} disabled={!(result.grand > 0)}>Compartir</button>
          <button className="btn btn-g" style={{ flex: 1 }} onClick={copy} disabled={!(result.grand > 0)}>Copiar</button>
        </div>
      </div>

      <button className="btn btn-g" style={{ width: "100%", marginBottom: 12 }} onClick={reset}>Empezar cuenta nueva</button>
    </div>
  );
}
