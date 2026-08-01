import { useState, useEffect, useRef } from "react";

const SCRIPT_URL = "/api/sheet";
const CLOSE_DAY = 20;
const DUE_DAY = 17;

function today() { return new Date().toISOString().slice(0,10); }
function fmt(n) {
  const num = parseFloat(n) || 0;
  return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(num);
}
function parseAmt(s) {
  if (s === null || s === undefined || s === "") return 0;
  const cleaned = String(s).replace(/[$,\s]/g,"");
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : Math.abs(num);
}
function getMonth(dateStr) {
  if (!dateStr) return "";
  return String(dateStr).slice(0, 7);
}
function calcOwedAmt(p, total) {
  if (!p || !p.value) return 0;
  if (p.type === "pct") return (total * (parseFloat(p.value) || 0)) / 100;
  return parseFloat(p.value) || 0;
}
function parseOwedStr(s) {
  if (!s || String(s).trim() === "") return [];
  try {
    return String(s).split(",").map(part => {
      part = part.trim();
      if (!part) return null;
      const colonIdx = part.lastIndexOf(":");
      if (colonIdx > -1) {
        const name = part.slice(0, colonIdx).trim();
        const val = part.slice(colonIdx + 1).replace(/[$\s]/g, "").trim();
        const num = parseFloat(val);
        if (isNaN(num)) return null;
        return { name, type: "fixed", value: String(num) };
      }
      const val = part.replace(/[$\s]/g, "");
      const num = parseFloat(val);
      if (isNaN(num)) return null;
      return { name: "", type: "fixed", value: String(num) };
    }).filter(Boolean);
  } catch { return []; }
}
function owedForExp(ex) {
  if (!ex.owed || !Array.isArray(ex.owed)) return 0;
  return ex.owed.reduce((s,p) => s + (parseFloat(p.value)||0), 0);
}
const MONTH_NAMES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
function monthLabel(monthStr) {
  if (!monthStr) return "";
  const [y,m] = monthStr.split("-");
  const idx = parseInt(m,10) - 1;
  return `${MONTH_NAMES[idx]||m} ${y}`;
}
const WEEKDAYS = ["Dom","Lun","Mar","Mie","Jue","Vie","Sab"];
const MONTHS_SHORT = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
function dayHeaderLabel(dateStr, opts={}) {
  const { relative = true } = opts;
  const [y,m,d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m-1, d);
  if (relative) {
    if (dateStr === today()) return "Hoy";
    if (dateStr === new Date(Date.now()-86400000).toISOString().slice(0,10)) return "Ayer";
  }
  const label = `${WEEKDAYS[dt.getDay()]} ${d} ${MONTHS_SHORT[m-1]}`;
  return y === new Date().getFullYear() ? label : `${label} ${y}`;
}
function groupByDate(list) {
  const map = new Map();
  for (const ex of list) {
    if (!map.has(ex.date)) map.set(ex.date, []);
    map.get(ex.date).push(ex);
  }
  return [...map.entries()]
    .sort((a,b)=>b[0].localeCompare(a[0]))
    .map(([date,items])=>({ date, items, total: items.reduce((s,e)=>s+e.amount,0) }));
}
function buildShareText(items) {
  const groups = groupByDate(items);
  const lines = ["Gastos pendientes de cobro", ""];
  groups.forEach(g => {
    lines.push(`*${dayHeaderLabel(g.date,{relative:false})}* - Total: ${fmt(g.total)}`);
    g.items.forEach(ex => {
      const owedAmt = owedForExp(ex);
      const mine = ex.amount - owedAmt;
      const debtors = (ex.owed||[]).map(p=>`${p.name||"Alguien"}: ${fmt(parseFloat(p.value)||0)}`).join(", ");
      lines.push(`${ex.desc} - ${fmt(ex.amount)}`);
      lines.push(`  ${debtors}${debtors?", ":""}Tu: ${fmt(mine)}`);
    });
    lines.push("");
  });
  const grandTotal = items.reduce((s,e)=>s+owedForExp(e),0);
  lines.push(`*Total a cobrar: ${fmt(grandTotal)}*`);
  return lines.join("\n").trim();
}
function getCycleInfo() {
  const now = new Date();
  const day = now.getDate();
  const year = now.getFullYear();
  const month = now.getMonth();
  let cycleStart, cycleEnd, dueDate;
  if (day <= CLOSE_DAY) {
    cycleStart = new Date(year, month - 1, CLOSE_DAY + 1);
    cycleEnd = new Date(year, month, CLOSE_DAY);
    dueDate = new Date(year, month + 1, DUE_DAY);
  } else {
    cycleStart = new Date(year, month, CLOSE_DAY + 1);
    cycleEnd = new Date(year, month + 1, CLOSE_DAY);
    dueDate = new Date(year, month + 2, DUE_DAY);
  }
  const msPerDay = 1000 * 60 * 60 * 24;
  const daysUntilDue = Math.ceil((dueDate - now) / msPerDay);
  return {
    start: cycleStart.toISOString().slice(0,10),
    end: cycleEnd.toISOString().slice(0,10),
    due: dueDate.toISOString().slice(0,10),
    daysUntilDue,
    isUrgent: daysUntilDue <= 5,
  };
}

async function sheetRead() {
  const res = await fetch(`${SCRIPT_URL}?action=read`);
  const data = await res.json();
  return data.expenses || [];
}
async function parseJsonSafe(res) {
  try { return await res.json(); } catch { return null; }
}
async function sheetAppend(expense) {
  const owedStr = (expense.owed||[]).map(p => {
    const amt = calcOwedAmt(p, expense.amount).toFixed(2);
    return p.name ? `${p.name}: $${amt}` : `$${amt}`;
  }).join(", ");
  const res = await fetch(SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action:"append", desc:expense.desc, amount:expense.amount, date:expense.date, category:expense.category||"", owed:owedStr }),
  });
  if (!res.ok) throw new Error(`sheetAppend failed: ${res.status}`);
  return parseJsonSafe(res);
}
async function sheetEdit(expense) {
  const owedStr = (expense.owed||[]).map(p => {
    const amt = calcOwedAmt(p, expense.amount).toFixed(2);
    return p.name ? `${p.name}: $${amt}` : `$${amt}`;
  }).join(", ");
  const res = await fetch(SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action:"edit", id:String(expense.sheetId), desc:expense.desc, amount:expense.amount, date:expense.date, category:expense.category||"", owed:owedStr }),
  });
  if (!res.ok) throw new Error(`sheetEdit failed: ${res.status}`);
  return parseJsonSafe(res);
}
async function sheetUpdateStatus(expense) {
  const owedStr = (expense.owed||[]).map(p => {
    const amt = calcOwedAmt(p, expense.amount).toFixed(2);
    return p.name ? `${p.name}: $${amt}` : `$${amt}`;
  }).join(", ");
  const res = await fetch(SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action:"update", id:String(expense.sheetId), desc:expense.desc, date:expense.date, amount:String(expense.amount), added:String(expense.added), paid:String(expense.paid), owed:owedStr }),
  });
  if (!res.ok) throw new Error(`sheetUpdateStatus failed: ${res.status}`);
  return parseJsonSafe(res);
}
async function sheetDelete(expense) {
  const res = await fetch(SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action:"delete", id:String(expense.sheetId), desc:expense.desc, date:expense.date, amount:String(expense.amount) }),
  });
  if (!res.ok) throw new Error(`sheetDelete failed: ${res.status}`);
  return parseJsonSafe(res);
}
async function recurringRead() {
  const res = await fetch(`${SCRIPT_URL}?action=recurring-read`);
  const data = await res.json();
  return data.items || [];
}
async function recurringAppend(item) {
  const res = await fetch(SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action:"recurring-append", name:item.name, amount:item.amount, day:item.day }),
  });
  if (!res.ok) throw new Error(`recurringAppend failed: ${res.status}`);
  return parseJsonSafe(res);
}
async function recurringEdit(item) {
  const res = await fetch(SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action:"recurring-edit", id:String(item.sheetId), name:item.name, amount:item.amount, day:item.day }),
  });
  if (!res.ok) throw new Error(`recurringEdit failed: ${res.status}`);
  return parseJsonSafe(res);
}
async function recurringDelete(item) {
  const res = await fetch(SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action:"recurring-delete", id:String(item.sheetId) }),
  });
  if (!res.ok) throw new Error(`recurringDelete failed: ${res.status}`);
  return parseJsonSafe(res);
}

const CATEGORIES = ["Comida","Super","Gas","Ocio","Viaje","Salud","Compras","Gastos fijos","Otro"];
const CAT_EMOJI = {"Comida":"🍽️","Super":"🛒","Gas":"⛽","Ocio":"🎬","Viaje":"✈️","Salud":"🏥","Compras":"🛍️","Gastos fijos":"📅","Otro":"📦"};
function catDisplay(c) {
  if (!c) return "";
  const trimmed = c.trim();
  if (CAT_EMOJI[trimmed]) return `${CAT_EMOJI[trimmed]} ${trimmed}`;
  const key = Object.keys(CAT_EMOJI).find(k => k.toLowerCase() === trimmed.toLowerCase());
  return key ? `${CAT_EMOJI[key]} ${key}` : trimmed;
}

const EMPTY_FORM = { desc:"", amount:"", date:today(), category:"", note:"", owed:[] };
const EMPTY_REC = { name:"", amount:"", day:"" };

export default function App() {
  const [expenses, setExpenses] = useState([]);
  const [recurring, setRecurring] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [recForm, setRecForm] = useState(EMPTY_REC);
  const [editId, setEditId] = useState(null);
  const [editRecId, setEditRecId] = useState(null);
  const [showRecForm, setShowRecForm] = useState(false);
  const [showOwed, setShowOwed] = useState(false);
  const [filter, setFilter] = useState("pending");
  const [monthFilter, setMonthFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [nameFilter, setNameFilter] = useState("");
  const [showNameSuggestions, setShowNameSuggestions] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [shareText, setShareText] = useState(null);
  const [loading, setLoading] = useState(false);
  const [pendingSyncs, setPendingSyncs] = useState(0);
  const syncing = pendingSyncs > 0;
  const [status, setStatus] = useState("idle");
  const [toast, setToast] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmRecDelete, setConfirmRecDelete] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [tab, setTab] = useState("list");
  const [confirmBulkPaid, setConfirmBulkPaid] = useState(false);
  const descRef = useRef();
  const syncQueueRef = useRef({});

  useEffect(() => { loadAll(); }, []);

  // Runs `task` in the background, tracked by the `syncing` indicator.
  // Tasks sharing the same `key` (e.g. the same expense id) are chained
  // in order so, for example, a freshly-created expense finishes its
  // "append" call (and picks up its real sheetId) before an edit/delete
  // for that same expense is sent.
  function runSync(key, task) {
    setPendingSyncs(n => n + 1);
    const prevTail = syncQueueRef.current[key] || Promise.resolve();
    const run = prevTail.then(task, task);
    syncQueueRef.current[key] = run.catch(() => {});
    run.finally(() => setPendingSyncs(n => Math.max(0, n - 1)));
    return run;
  }

  async function loadAll() {
    setLoading(true); setStatus("idle");
    try {
      const [rows, recItems] = await Promise.all([sheetRead(), recurringRead()]);
      const normalized = [];
      for (let i = 0; i < rows.length; i++) {
        try {
          const e = rows[i];
          const dateVal = e.date ? String(e.date).trim() : "";
          if (!dateVal) continue;
          const amt = parseAmt(e.amount);
          if (amt === 0 && !e.desc) continue;
          normalized.push({
            id: e.id || String(Date.now()+i),
            sheetId: e.id,
            desc: String(e.desc||""),
            amount: amt,
            date: dateVal,
            category: String(e.category||""),
            note: String(e.note||""),
            owed: parseOwedStr(e.owed),
            added: e.added === true || String(e.added).toUpperCase().trim() === "SI",
            paid: e.paid === true || String(e.paid).toUpperCase().trim() === "SI",
          });
        } catch(err) { console.warn("Skipping row", i, err); }
      }
      setExpenses(normalized);
      setRecurring(recItems.map((r,i) => ({
        id: r.id || String(i),
        sheetId: r.id,
        name: r.name,
        amount: parseAmt(r.amount),
        day: r.day,
      })));
      setStatus("ok");
      showToast(`${normalized.length} gastos cargados`);
    } catch(err) {
      console.error(err);
      setStatus("error");
      showToast("No se pudo conectar al Sheet","warn");
    }
    setLoading(false);
  }

  function showToast(msg, type="ok") {
    setToast({msg,type});
    setTimeout(()=>setToast(null), 2500);
  }

  function owedTotalFromForm() {
    const base = parseFloat(form.amount)||0;
    return form.owed.reduce((s,p)=>s+calcOwedAmt(p,base),0);
  }
  function addPerson() { setForm(f=>({...f,owed:[...f.owed,{name:"",type:"fixed",value:""}]})); }
  function removePerson(i) { setForm(f=>({...f,owed:f.owed.filter((_,j)=>j!==i)})); }
  function updatePerson(i,k,v) { setForm(f=>({...f,owed:f.owed.map((p,j)=>j===i?{...p,[k]:v}:p)})); }

  function submitForm(e) {
    e.preventDefault();
    if (!form.desc.trim()||!form.amount) return;
    const base = parseFloat(form.amount);
    const convertedOwed = form.owed.filter(p=>p.value).map(p=>({
      name: p.name||"", type:"fixed", value:String(calcOwedAmt(p,base).toFixed(2)),
    }));
    const isEdit = !!editId;
    const prevExpense = isEdit ? expenses.find(x=>x.id===editId) : null;
    const expense = {
      id: editId??Date.now(),
      sheetId: isEdit ? prevExpense?.sheetId : null,
      desc:form.desc, amount:base, date:form.date, category:form.category, note:form.note,
      owed:convertedOwed,
      added: isEdit ? (prevExpense?.added??false) : false,
      paid: isEdit ? (prevExpense?.paid??false) : false,
    };
    const snapshot = expenses;

    // Optimistic update: reflect the change and close the form immediately.
    if (isEdit) setExpenses(ex=>ex.map(x=>x.id===editId?expense:x));
    else setExpenses(ex=>[expense,...ex]);
    setForm(EMPTY_FORM);
    setShowOwed(false);
    setShowForm(false);
    setEditId(null);

    // Sync with Google Sheets in the background.
    runSync(expense.id, () => isEdit ? sheetEdit(expense) : sheetAppend(expense))
      .then(result => {
        if (!isEdit && result && result.id != null) {
          setExpenses(ex=>ex.map(x=>x.id===expense.id?{...x,sheetId:result.id}:x));
        }
        showToast(isEdit?"Gasto actualizado":"Guardado en Sheet");
      })
      .catch(err => {
        console.error(err);
        setExpenses(snapshot);
        showToast(isEdit?"Error al actualizar":"Error al guardar","warn");
      });
  }
  function addRecurringToList(rec) {
    const expense = {
      id: Date.now(),
      sheetId: null,
      desc: rec.name,
      amount: rec.amount,
      date: today(),
      category: "Gastos fijos",
      note: "",
      owed: [],
      added: false,
      paid: false,
    };
    const snapshot = expenses;
    setExpenses(ex=>[expense,...ex]);
    runSync(expense.id, () => sheetAppend(expense))
      .then(result => {
        if (result && result.id != null) {
          setExpenses(ex=>ex.map(x=>x.id===expense.id?{...x,sheetId:result.id}:x));
        }
        showToast(`${rec.name} agregado`);
      })
      .catch(err => {
        console.error(err);
        setExpenses(snapshot);
        showToast("Error al guardar","warn");
      });
  }

  function submitRecForm(e) {
    e.preventDefault();
    if (!recForm.name.trim()||!recForm.amount||!recForm.day) return;
    const isEdit = !!editRecId;
    const prevItem = isEdit ? recurring.find(x=>x.id===editRecId) : null;
    const item = {
      id: editRecId??Date.now(),
      sheetId: isEdit ? prevItem?.sheetId : null,
      name:recForm.name, amount:parseFloat(recForm.amount), day:recForm.day,
    };
    const snapshot = recurring;

    // Optimistic update: reflect the change and close the form immediately.
    if (isEdit) setRecurring(r=>r.map(x=>x.id===editRecId?item:x));
    else setRecurring(r=>[...r,item]);
    setRecForm(EMPTY_REC);
    setShowRecForm(false);
    setEditRecId(null);

    // Sync with Google Sheets in the background.
    runSync(`rec-${item.id}`, () => isEdit ? recurringEdit(item) : recurringAppend(item))
      .then(result => {
        if (!isEdit && result && result.id != null) {
          setRecurring(r=>r.map(x=>x.id===item.id?{...x,sheetId:result.id}:x));
        }
        showToast(isEdit?"Gasto fijo actualizado":"Gasto fijo guardado");
      })
      .catch(err => {
        console.error(err);
        setRecurring(snapshot);
        showToast(isEdit?"Error al actualizar":"Error al guardar","warn");
      });
  }

  function doDeleteRec() {
    const item = confirmRecDelete;
    setConfirmRecDelete(null);
    const snapshot = recurring;
    setRecurring(r=>r.filter(x=>x.id!==item.id));
    runSync(`rec-${item.id}`, () => recurringDelete(item))
      .then(() => showToast("Eliminado"))
      .catch(err => {
        console.error(err);
        setRecurring(snapshot);
        showToast("Error al eliminar","warn");
      });
  }

  function toggleField(id, field) {
    const snapshot = expenses;
    const updated = expenses.map(x=>x.id===id?{...x,[field]:!x[field]}:x);
    setExpenses(updated);
    const exp = updated.find(x=>x.id===id);
    runSync(id, () => sheetUpdateStatus(exp))
      .catch(err => {
        console.error(err);
        setExpenses(snapshot);
        showToast("Error al sincronizar","warn");
      });
  }

  // Runs a bulk field update optimistically; if some items fail to sync,
  // only those items are rolled back instead of the whole batch.
  function bulkToggle(items, field, successMsg) {
    setExpenses(ex => ex.map(x => items.some(i=>i.id===x.id) ? {...x,[field]:true} : x));
    Promise.all(items.map(exp =>
      runSync(exp.id, () => sheetUpdateStatus({...exp,[field]:true}))
        .then(() => ({id:exp.id, ok:true}), () => ({id:exp.id, ok:false}))
    )).then(results => {
      const failedIds = new Set(results.filter(r=>!r.ok).map(r=>r.id));
      if (failedIds.size) {
        setExpenses(ex => ex.map(x => failedIds.has(x.id) ? {...x,[field]:false} : x));
        showToast(`${items.length-failedIds.size} actualizados, ${failedIds.size} fallaron`,"warn");
      } else {
        showToast(successMsg);
      }
    });
  }

  function markAllPaid() {
    setConfirmBulkPaid(false);
    const unpaid = expenses.filter(e => owedForExp(e) > 0 && !e.paid);
    if (!unpaid.length) return;
    bulkToggle(unpaid, "paid", `${unpaid.length} gastos marcados como pagados`);
  }

  function markAllAdded() {
    const pending = expenses.filter(e=>!e.added);
    if (!pending.length) return;
    bulkToggle(pending, "added", `${pending.length} gastos marcados como ingresados`);
  }

  function doDelete() {
    const ex = confirmDelete;
    setConfirmDelete(null);
    const snapshot = expenses;
    setExpenses(prev=>prev.filter(x=>x.id!==ex.id));
    runSync(ex.id, () => sheetDelete(ex))
      .then(() => showToast("Eliminado"))
      .catch(err => {
        console.error(err);
        setExpenses(snapshot);
        showToast("Error al eliminar","warn");
      });
  }

  function startEdit(ex) {
    setEditId(ex.id);
    setForm({desc:ex.desc, amount:String(ex.amount), date:ex.date, category:ex.category||"", note:ex.note||"", owed:ex.owed||[]});
    setShowOwed((ex.owed||[]).length > 0);
    setShowForm(true);
    setTimeout(()=>descRef.current?.focus(),100);
  }
  function cancelEdit() { setEditId(null); setForm(EMPTY_FORM); setShowOwed(false); setShowForm(false); }

  function startEditRec(item) {
    setEditRecId(item.id);
    setRecForm({name:item.name, amount:String(item.amount), day:String(item.day)});
    setShowRecForm(true);
  }

  function changeFilter(v) {
    setFilter(v);
    if (v !== "medeben") { setSelectMode(false); setSelectedIds(new Set()); }
  }

  function toggleSelect(id) {
    setSelectedIds(s => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function shareSelected(items) {
    if (!items.length) return;
    const text = buildShareText(items);
    if (navigator.share) navigator.share({ text }).catch(()=>{});
    else setShareText(text);
  }

  const cycle = getCycleInfo();
  const cycleExpenses = expenses.filter(e => e.date >= cycle.start && e.date <= cycle.end);
  const cycleTotal = cycleExpenses.reduce((s,e)=>s+e.amount,0);
  const cyclePending = cycleExpenses.filter(e=>!e.added).reduce((s,e)=>s+e.amount,0);
  const totalOwed = expenses.filter(e=>!e.paid).reduce((s,e)=>s+owedForExp(e),0);
  const netCost = cycleExpenses.reduce((s,e)=>s+(e.amount-owedForExp(e)),0);
  const months = [...new Set(expenses.map(e=>getMonth(e.date)))].sort().reverse();
  const availableMonths = [...new Set(expenses.map(e=>getMonth(e.date)))].sort().reverse();
  const meDeben = expenses.filter(e => owedForExp(e) > 0 && !e.paid);
  const meDebenTotal = meDeben.reduce((s,e)=>s+owedForExp(e),0);

  let filtered = filter === "medeben" ? meDeben : expenses;
  if (filter === "pending") filtered = filtered.filter(e=>!e.added);
  else if (filter === "added") filtered = filtered.filter(e=>e.added);
  if (dateFrom) filtered = filtered.filter(e=>e.date >= dateFrom);
  if (dateTo) filtered = filtered.filter(e=>e.date <= dateTo);
  if (!dateFrom && !dateTo && monthFilter !== "all") filtered = filtered.filter(e=>getMonth(e.date)===monthFilter);
  if (nameFilter.trim()) {
    const q = nameFilter.trim().toLowerCase();
    filtered = filtered.filter(e=>e.desc.toLowerCase().includes(q));
  }
  const filteredGroups = groupByDate(filtered);

  const expenseNames = [...new Set(expenses.map(e=>e.desc.trim()).filter(Boolean))];
  const qName = nameFilter.trim().toLowerCase();
  const nameSuggestions = qName
    ? expenseNames.filter(n=>n.toLowerCase().includes(qName) && n.toLowerCase()!==qName).slice(0,6)
    : [];
  const selectedTotal = meDeben.filter(e=>selectedIds.has(e.id)).reduce((s,e)=>s+owedForExp(e),0);
  const hasActiveFilters = !!(nameFilter || dateFrom || dateTo);

  const statusDot = status==="ok"?"#059669":status==="error"?"#dc2626":"#94a3b8";

  return (
    <div style={{minHeight:"100vh",background:"#f1f5f9",fontFamily:"'DM Sans','Helvetica Neue',sans-serif",color:"#0f172a"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=Playfair+Display:wght@700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        input,select,textarea{outline:none;-webkit-appearance:none;}
        input:focus,select:focus,textarea:focus{border-color:#0f4c81!important;box-shadow:0 0 0 3px rgba(15,76,129,0.12);}
        .inp{background:#fff;border:1.5px solid #e2e8f0;color:#0f172a;padding:11px 14px;border-radius:10px;font-family:'DM Sans',sans-serif;font-size:14px;width:100%;transition:all .15s;}
        .sel{background:#fff;border:1.5px solid #e2e8f0;color:#0f172a;padding:11px 14px;border-radius:10px;font-family:'DM Sans',sans-serif;font-size:14px;width:100%;cursor:pointer;}
        .btn{cursor:pointer;border:none;font-family:'DM Sans',sans-serif;font-size:13px;border-radius:10px;padding:10px 18px;transition:all .15s;font-weight:600;}
        .btn:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 4px 12px rgba(0,0,0,.1);}
        .btn:active{transform:translateY(0);}
        .btn:disabled{opacity:.5;cursor:default;}
        .btn-p{background:#0f4c81;color:#fff;}
        .btn-g{background:#fff;color:#64748b;border:1.5px solid #e2e8f0;}
        .btn-g:hover:not(:disabled){border-color:#cbd5e1;color:#0f172a;}
        .btn-d{background:#fef2f2;color:#dc2626;border:1.5px solid #fecaca;}
        .btn-amber{background:#fffbeb;color:#b45309;border:1.5px solid #fde68a;}
        .btn-sm{padding:6px 12px;font-size:12px;border-radius:8px;}
        .tog{padding:8px 14px;border-radius:20px;font-size:12px;cursor:pointer;border:none;background:transparent;color:#64748b;font-family:'DM Sans',sans-serif;font-weight:600;transition:all .15s;white-space:nowrap;}
        .tog.on{background:#0f4c81;color:#fff;}
        .tog.on-amber{background:#b45309;color:#fff;}
        .tog:hover:not(.on):not(.on-amber){background:#e2e8f0;}
        .ptt{display:flex;background:#f1f5f9;border-radius:8px;padding:3px;gap:2px;}
        .pto{flex:1;padding:7px 8px;text-align:center;font-size:12px;cursor:pointer;border:none;background:transparent;color:#64748b;font-family:'DM Sans',sans-serif;font-weight:600;transition:all .15s;border-radius:6px;}
        .pto.on{background:#fff;color:#0f4c81;box-shadow:0 1px 4px rgba(0,0,0,.1);}
        .row{display:flex;align-items:flex-start;gap:12px;padding:14px 16px;border-radius:12px;background:#fff;margin-bottom:8px;transition:all .2s;box-shadow:0 1px 3px rgba(0,0,0,.05);border:1.5px solid transparent;}
        .row:hover{border-color:#e2e8f0;box-shadow:0 4px 12px rgba(0,0,0,.08);}
        .row.dim{opacity:.35;}
        .row.owed-highlight{border-color:#fde68a;background:#fffdf5;}
        .chk{width:24px;height:24px;border-radius:7px;border:2px solid #e2e8f0;background:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .15s;}
        .chk:hover{border-color:#94a3b8;transform:scale(1.05);}
        .chk.blue.on{background:#0f4c81;border-color:#0f4c81;box-shadow:0 2px 8px rgba(15,76,129,.3);}
        .chk.green.on{background:#059669;border-color:#059669;box-shadow:0 2px 8px rgba(5,150,105,.3);}
        .chk.amber.on{background:#b45309;border-color:#b45309;box-shadow:0 2px 8px rgba(180,83,9,.3);}
        .suggest{position:absolute;top:100%;left:0;right:0;background:#fff;border:1.5px solid #e2e8f0;border-radius:10px;margin-top:4px;z-index:50;box-shadow:0 8px 24px rgba(0,0,0,.1);overflow:hidden;}
        .suggest-item{padding:9px 14px;font-size:13px;cursor:pointer;}
        .suggest-item:hover{background:#f1f5f9;}
        .card{background:#fff;border-radius:14px;padding:20px;box-shadow:0 1px 4px rgba(0,0,0,.06);}
        .toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);padding:12px 24px;border-radius:12px;font-size:13px;z-index:999;animation:pop .2s ease;font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,.15);white-space:nowrap;}
        .tok{background:#0f4c81;color:#fff;}
        .twarn{background:#dc2626;color:#fff;}
        @keyframes pop{from{opacity:0;transform:translateX(-50%) translateY(8px);}to{opacity:1;transform:translateX(-50%) translateY(0);}}
        .spin{display:inline-block;animation:spin .7s linear infinite;}
        @keyframes spin{from{transform:rotate(0deg);}to{transform:rotate(360deg);}}
        .pulse{animation:pulse 1.5s ease-in-out infinite;}
        @keyframes pulse{0%,100%{opacity:1;}50%{opacity:.4;}}
        .overlay{position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:200;display:flex;align-items:flex-end;justify-content:center;backdrop-filter:blur(4px);}
        .sheet{background:#fff;border-radius:20px 20px 0 0;padding:28px 24px 40px;width:100%;max-width:720px;max-height:90vh;overflow-y:auto;animation:slideUp .25s ease;}
        @keyframes slideUp{from{transform:translateY(100%);}to{transform:translateY(0);}}
        .modal-overlay{position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:300;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);}
        .modal{background:#fff;border-radius:20px;padding:28px;max-width:380px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,.2);animation:popIn .2s ease;}
        @keyframes popIn{from{opacity:0;transform:scale(.95);}to{opacity:1;transform:scale(1);}}
        .badge{display:inline-flex;align-items:center;gap:4px;font-size:10px;padding:3px 8px;border-radius:20px;font-weight:600;white-space:nowrap;}
        .badge-blue{background:#eff6ff;color:#0f4c81;border:1px solid #bfdbfe;}
        .badge-gray{background:#f8fafc;color:#94a3b8;border:1px solid #e2e8f0;}
        .badge-amber{background:#fffbeb;color:#b45309;border:1px solid #fde68a;}
        .badge-green{background:#f0fdf4;color:#059669;border:1px solid #bbf7d0;}
        .nav-tab{display:flex;align-items:center;gap:6px;padding:10px 18px;border-radius:10px;cursor:pointer;font-size:13px;font-weight:600;color:#64748b;transition:all .15s;border:none;background:transparent;font-family:'DM Sans',sans-serif;}
        .nav-tab.on{background:#fff;color:#0f4c81;box-shadow:0 1px 4px rgba(0,0,0,.08);}
        .fab{position:fixed;bottom:24px;right:24px;width:56px;height:56px;border-radius:50%;background:#0f4c81;color:#fff;border:none;font-size:26px;cursor:pointer;box-shadow:0 4px 16px rgba(15,76,129,.4);display:flex;align-items:center;justify-content:center;transition:all .2s;z-index:100;}
        .fab:hover{transform:scale(1.1);}
        .medeben-banner{background:linear-gradient(135deg,#b45309,#d97706);border-radius:12px;padding:16px 20px;color:#fff;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;}
        .rec-row{display:flex;align-items:center;gap:10px;padding:11px 14px;background:#fff;border:1.5px solid #e2e8f0;border-radius:10px;margin-bottom:8px;}
        @media(max-width:640px){.sg{grid-template-columns:1fr 1fr!important;}}
      `}</style>

      {confirmDelete && (
        <div className="modal-overlay" onClick={()=>setConfirmDelete(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:11,letterSpacing:2,color:"#dc2626",marginBottom:12,fontWeight:700}}>ELIMINAR GASTO</div>
            <div style={{fontSize:16,marginBottom:4,fontWeight:600}}>{confirmDelete.desc}</div>
            <div style={{fontSize:13,color:"#64748b",marginBottom:20}}>{fmt(confirmDelete.amount)} · {confirmDelete.date}</div>
            <div style={{display:"flex",gap:8}}>
              <button className="btn btn-d" style={{flex:1}} onClick={doDelete}>Eliminar</button>
              <button className="btn btn-g" onClick={()=>setConfirmDelete(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {confirmRecDelete && (
        <div className="modal-overlay" onClick={()=>setConfirmRecDelete(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:11,letterSpacing:2,color:"#dc2626",marginBottom:12,fontWeight:700}}>ELIMINAR GASTO FIJO</div>
            <div style={{fontSize:16,marginBottom:4,fontWeight:600}}>{confirmRecDelete.name}</div>
            <div style={{fontSize:13,color:"#64748b",marginBottom:20}}>{fmt(confirmRecDelete.amount)} · dia {confirmRecDelete.day}</div>
            <div style={{display:"flex",gap:8}}>
              <button className="btn btn-d" style={{flex:1}} onClick={doDeleteRec}>Eliminar</button>
              <button className="btn btn-g" onClick={()=>setConfirmRecDelete(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {confirmBulkPaid && (
        <div className="modal-overlay" onClick={()=>setConfirmBulkPaid(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:11,letterSpacing:2,color:"#b45309",marginBottom:12,fontWeight:700}}>MARCAR TODOS COMO PAGADOS</div>
            <div style={{fontSize:15,marginBottom:8,fontWeight:600}}>{meDeben.length} gastos · {fmt(meDebenTotal)}</div>
            <div style={{fontSize:13,color:"#64748b",marginBottom:24}}>Marca todos los pendientes de cobro como pagados.</div>
            <div style={{display:"flex",gap:8}}>
              <button className="btn btn-amber" style={{flex:1}} onClick={markAllPaid}>Si, todos pagados</button>
              <button className="btn btn-g" onClick={()=>setConfirmBulkPaid(false)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {shareText && (
        <div className="modal-overlay" onClick={()=>setShareText(null)}>
          <div className="modal" style={{maxWidth:420}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:11,letterSpacing:2,color:"#0f4c81",marginBottom:12,fontWeight:700}}>COMPARTIR</div>
            <textarea readOnly value={shareText}
              style={{width:"100%",minHeight:160,fontSize:12,fontFamily:"'DM Sans',sans-serif",border:"1.5px solid #e2e8f0",borderRadius:10,padding:10,marginBottom:14,resize:"vertical",color:"#0f172a"}} />
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              <a className="btn btn-p" style={{textAlign:"center",textDecoration:"none"}}
                href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noreferrer">Abrir WhatsApp</a>
              <a className="btn btn-g" style={{textAlign:"center",textDecoration:"none"}}
                href={`sms:?&body=${encodeURIComponent(shareText)}`}>Enviar por SMS</a>
              <button className="btn btn-g" onClick={()=>{navigator.clipboard?.writeText(shareText);showToast("Copiado");}}>Copiar texto</button>
              <button className="btn btn-g" onClick={()=>setShareText(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <div className="overlay" onClick={cancelEdit}>
          <div className="sheet" onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div style={{fontSize:16,fontWeight:700,color:editId?"#0f4c81":"#0f172a"}}>{editId?"Editar gasto":"Nuevo gasto"}</div>
              <button className="btn btn-g btn-sm" onClick={cancelEdit}>X</button>
            </div>
            <form onSubmit={submitForm}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 110px",gap:10,marginBottom:12}}>
                <input ref={descRef} className="inp" placeholder="Descripcion" value={form.desc}
                  onChange={e=>setForm(f=>({...f,desc:e.target.value}))} required />
                <input className="inp" type="number" placeholder="$ Total" value={form.amount}
                  min="0.01" step="0.01" onChange={e=>setForm(f=>({...f,amount:e.target.value}))} required />
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
                <input className="inp" type="date" value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))} />
                <select className="sel" value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))}>
                  <option value="">Sin categoria</option>
                  {CATEGORIES.map(c=><option key={c} value={c}>{CAT_EMOJI[c]||""} {c}</option>)}
                </select>
              </div>
              <input className="inp" placeholder="Nota (opcional)" value={form.note}
                onChange={e=>setForm(f=>({...f,note:e.target.value}))} style={{marginBottom:14}} />

              <div style={{marginBottom:14}}>
                <button type="button" onClick={()=>setShowOwed(o=>!o)}
                  style={{display:"flex",alignItems:"center",gap:8,background:"none",border:"none",cursor:"pointer",color:"#b45309",fontSize:13,fontWeight:600,padding:0}}>
                  <span style={{width:20,height:20,borderRadius:5,border:"1.5px solid #b45309",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14}}>
                    {showOwed?"-":"+"}
                  </span>
                  Alguien me debe de este gasto
                </button>
                {showOwed && (
                  <div style={{background:"#fffbeb",border:"1.5px solid #fde68a",borderRadius:12,padding:"14px 16px",marginTop:10}}>
                    {form.owed.length===0 && (
                      <button type="button" className="btn btn-g btn-sm" onClick={addPerson} style={{fontSize:11,width:"100%"}}>+ agregar persona</button>
                    )}
                    {form.owed.map((p,i)=>(
                      <div key={i} style={{display:"flex",gap:8,alignItems:"center",marginBottom:8}}>
                        <input className="inp" placeholder="Nombre (opcional)" value={p.name}
                          onChange={e=>updatePerson(i,"name",e.target.value)} style={{flex:2,fontSize:13}} />
                        <div className="ptt" style={{flexShrink:0,width:80}}>
                          <button type="button" className={`pto ${p.type==="fixed"?"on":""}`} onClick={()=>updatePerson(i,"type","fixed")}>$</button>
                          <button type="button" className={`pto ${p.type==="pct"?"on":""}`} onClick={()=>updatePerson(i,"type","pct")}>%</button>
                        </div>
                        <input className="inp" type="number" min="0" step="0.01"
                          placeholder={p.type==="pct"?"50":"25.00"} value={p.value}
                          onChange={e=>updatePerson(i,"value",e.target.value)} style={{flex:1,fontSize:13}} />
                        <button type="button" className="btn btn-d btn-sm" style={{padding:"6px 10px"}} onClick={()=>removePerson(i)}>X</button>
                      </div>
                    ))}
                    {form.owed.length>0 && (
                      <>
                        <button type="button" className="btn btn-g btn-sm" onClick={addPerson} style={{fontSize:11,marginBottom:8}}>+ agregar otro</button>
                        {form.amount && (
                          <div style={{display:"flex",gap:16,fontSize:12,paddingTop:8,borderTop:"1px solid #fde68a"}}>
                            <span style={{color:"#92400e"}}>Cobras: <strong style={{color:"#b45309"}}>{fmt(owedTotalFromForm())}</strong></span>
                            <span style={{color:"#92400e"}}>Tu parte: <strong style={{color:"#059669"}}>{fmt(Math.max(0,(parseFloat(form.amount)||0)-owedTotalFromForm()))}</strong></span>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>

              <button type="submit" className="btn btn-p" style={{width:"100%",padding:"13px"}}>
                {editId?"Guardar cambios":"Agregar gasto"}
              </button>
            </form>
          </div>
        </div>
      )}

      {showRecForm && (
        <div className="overlay" onClick={()=>{setShowRecForm(false);setEditRecId(null);setRecForm(EMPTY_REC);}}>
          <div className="sheet" onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div style={{fontSize:16,fontWeight:700}}>{editRecId?"Editar gasto fijo":"Nuevo gasto fijo"}</div>
              <button className="btn btn-g btn-sm" onClick={()=>{setShowRecForm(false);setEditRecId(null);setRecForm(EMPTY_REC);}}>X</button>
            </div>
            <form onSubmit={submitRecForm}>
              <input className="inp" placeholder="Nombre (ej. Netflix)" value={recForm.name}
                onChange={e=>setRecForm(f=>({...f,name:e.target.value}))} required style={{marginBottom:12}} />
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
                <input className="inp" type="number" placeholder="$ Monto" value={recForm.amount}
                  min="0.01" step="0.01" onChange={e=>setRecForm(f=>({...f,amount:e.target.value}))} required />
                <input className="inp" type="number" placeholder="Dia del mes" value={recForm.day}
                  min="1" max="31" onChange={e=>setRecForm(f=>({...f,day:e.target.value}))} required />
              </div>
              <button type="submit" className="btn btn-p" style={{width:"100%",padding:"13px"}}>
                {editRecId?"Guardar cambios":"Agregar gasto fijo"}
              </button>
            </form>
          </div>
        </div>
      )}

      <div style={{background:"#fff",borderBottom:"1px solid #e2e8f0",padding:"0 20px",position:"sticky",top:0,zIndex:100}}>
        <div style={{maxWidth:720,margin:"0 auto",display:"flex",alignItems:"center",justifyContent:"space-between",height:58}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:34,height:34,background:"linear-gradient(135deg,#0f4c81,#1e6ab0)",borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 2px 8px rgba(15,76,129,.3)"}}>
              <span style={{color:"#fff",fontSize:16,fontWeight:700}}>B</span>
            </div>
            <div>
              <div style={{fontFamily:"'Playfair Display',serif",fontSize:18,fontWeight:700,letterSpacing:-.3,lineHeight:1}}>Bolsillo</div>
              <div style={{fontSize:9,color:"#94a3b8",letterSpacing:1.5,fontWeight:600}}>DISCOVER - CONTROL</div>
            </div>
          </div>
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            {syncing && <span style={{fontSize:11,color:"#94a3b8",fontWeight:500}} className="pulse">Guardando...</span>}
            <div style={{display:"flex",alignItems:"center",gap:4,fontSize:11,color:"#64748b",fontWeight:500}}>
              <span style={{width:7,height:7,borderRadius:"50%",background:statusDot,display:"inline-block"}}></span>
              Sheet
            </div>
            <button className="btn btn-g btn-sm" onClick={loadAll} disabled={loading}>
              {loading?"...":"Sync"}
            </button>
          </div>
        </div>
      </div>

      <div style={{maxWidth:720,margin:"0 auto",padding:"20px 16px 100px"}}>
        <div style={{background:`linear-gradient(135deg,${cycle.isUrgent?"#dc2626,#b91c1c":"#0f4c81,#1e6ab0"})`,borderRadius:14,padding:"20px 24px",color:"#fff",marginBottom:16}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}>
            <div>
              <div style={{fontSize:10,letterSpacing:2,opacity:.7,fontWeight:600,marginBottom:4}}>CICLO - DISCOVER</div>
              <div style={{fontSize:12,opacity:.8,marginBottom:2}}>Cierre: {cycle.end}</div>
              <div style={{fontSize:12,opacity:.8}}>
                Vence: {cycle.due}
                {cycle.daysUntilDue <= 10 && (
                  <span style={{marginLeft:8,background:"rgba(255,255,255,.2)",padding:"2px 8px",borderRadius:20,fontSize:11,fontWeight:700}}>
                    {cycle.daysUntilDue<=0?"VENCIDO":cycle.daysUntilDue===1?"Manana":`${cycle.daysUntilDue}d`}
                  </span>
                )}
              </div>
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:10,letterSpacing:1.5,opacity:.7,fontWeight:600,marginBottom:2}}>TOTAL CICLO</div>
              <div style={{fontFamily:"'Playfair Display',serif",fontSize:28,fontWeight:700,lineHeight:1}}>{fmt(cycleTotal)}</div>
            </div>
          </div>
          <div style={{background:"rgba(255,255,255,.15)",borderRadius:10,padding:"12px 16px",display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
            <div>
              <div style={{opacity:.7,fontSize:9,marginBottom:3,letterSpacing:1,fontWeight:600}}>POR INGRESAR</div>
              <div style={{fontWeight:700,fontSize:15}}>{fmt(cyclePending)}</div>
            </div>
            <div style={{textAlign:"center"}}>
              <div style={{opacity:.7,fontSize:9,marginBottom:3,letterSpacing:1,fontWeight:600}}>ME DEBEN</div>
              <div style={{fontWeight:700,fontSize:15,color:"#fde68a"}}>{fmt(totalOwed)}</div>
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{opacity:.7,fontSize:9,marginBottom:3,letterSpacing:1,fontWeight:600}}>COSTO NETO</div>
              <div style={{fontWeight:700,fontSize:15,color:"#6ee7b7"}}>{fmt(netCost)}</div>
            </div>
          </div>
        </div>

        <div style={{display:"flex",background:"#e2e8f0",borderRadius:12,padding:"4px",gap:4,marginBottom:20}}>
          <button className={`nav-tab ${tab==="list"?"on":""}`} style={{flex:1,justifyContent:"center"}} onClick={()=>setTab("list")}>Gastos</button>
          <button className={`nav-tab ${tab==="recurring"?"on":""}`} style={{flex:1,justifyContent:"center"}} onClick={()=>setTab("recurring")}>Fijos</button>
          <button className={`nav-tab ${tab==="summary"?"on":""}`} style={{flex:1,justifyContent:"center"}} onClick={()=>setTab("summary")}>Resumen</button>
        </div>

        {tab==="list" && <>
          <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:12,flexWrap:"wrap"}}>
            <div style={{display:"flex",background:"#e2e8f0",borderRadius:20,padding:"3px",gap:2}}>
              {[["all","Todos"],["pending","Pendientes"],["added","Ingresados"]].map(([v,l])=>(
                <button key={v} className={`tog ${filter===v?"on":""}`} style={{padding:"6px 12px",fontSize:11}} onClick={()=>changeFilter(v)}>{l}</button>
              ))}
              <button className={`tog ${filter==="medeben"?"on-amber":""}`} style={{padding:"6px 12px",fontSize:11,display:"flex",alignItems:"center",gap:4}} onClick={()=>changeFilter("medeben")}>
                Me deben
                {meDeben.length > 0 && (
                  <span style={{background:filter==="medeben"?"rgba(255,255,255,.3)":"#b45309",color:"#fff",borderRadius:20,padding:"0px 6px",fontSize:10,fontWeight:700}}>
                    {meDeben.length}
                  </span>
                )}
              </button>
            </div>
            {filter !== "medeben" && availableMonths.length > 1 && (
              <select className="sel" value={monthFilter}
                onChange={e=>{setMonthFilter(e.target.value);setDateFrom("");setDateTo("");}}
                style={{width:"auto",padding:"7px 12px",fontSize:12,borderRadius:20}}>
                <option value="all">Todos los meses</option>
                {availableMonths.map(m=><option key={m} value={m}>{monthLabel(m)}</option>)}
              </select>
            )}
            <button className="btn btn-g btn-sm" style={{borderRadius:20,borderColor:hasActiveFilters?"#0f4c81":undefined,color:hasActiveFilters?"#0f4c81":undefined}}
              onClick={()=>setShowFilters(s=>!s)}>
              Filtros{hasActiveFilters?" •":""}
            </button>
            <span style={{marginLeft:"auto",fontSize:11,color:"#94a3b8",fontWeight:500}}>{filtered.length}</span>
          </div>

          {showFilters && (
            <div className="card" style={{padding:14,marginBottom:14}}>
              <div style={{position:"relative",marginBottom:10}}>
                <input className="inp" placeholder="Buscar por nombre de gasto..." value={nameFilter}
                  onChange={e=>setNameFilter(e.target.value)}
                  onFocus={()=>setShowNameSuggestions(true)}
                  onBlur={()=>setTimeout(()=>setShowNameSuggestions(false),150)} />
                {showNameSuggestions && nameSuggestions.length>0 && (
                  <div className="suggest">
                    {nameSuggestions.map(n=>(
                      <div key={n} className="suggest-item" onMouseDown={()=>{setNameFilter(n);setShowNameSuggestions(false);}}>{n}</div>
                    ))}
                  </div>
                )}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:hasActiveFilters?10:0}}>
                <div>
                  <div style={{fontSize:10,color:"#94a3b8",marginBottom:4,fontWeight:600}}>DESDE</div>
                  <input className="inp" type="date" value={dateFrom} onChange={e=>{setDateFrom(e.target.value);setMonthFilter("all");}} />
                </div>
                <div>
                  <div style={{fontSize:10,color:"#94a3b8",marginBottom:4,fontWeight:600}}>HASTA</div>
                  <input className="inp" type="date" value={dateTo} onChange={e=>{setDateTo(e.target.value);setMonthFilter("all");}} />
                </div>
              </div>
              {hasActiveFilters && (
                <button className="btn btn-g btn-sm" onClick={()=>{setNameFilter("");setDateFrom("");setDateTo("");}}>Limpiar filtros</button>
              )}
            </div>
          )}

          {filter === "medeben" && meDeben.length > 0 && (
            <div className="medeben-banner">
              <div>
                <div style={{fontSize:10,letterSpacing:2,opacity:.8,fontWeight:600,marginBottom:4}}>TOTAL POR COBRAR</div>
                <div style={{fontFamily:"'Playfair Display',serif",fontSize:26,fontWeight:700}}>{fmt(meDebenTotal)}</div>
                <div style={{fontSize:11,opacity:.8,marginTop:2}}>{meDeben.length} gastos pendientes</div>
              </div>
              <button className="btn" style={{background:"rgba(255,255,255,.2)",color:"#fff",border:"1.5px solid rgba(255,255,255,.4)",fontSize:12,padding:"10px 16px"}}
                onClick={()=>setConfirmBulkPaid(true)}>
                Marcar todos pagados
              </button>
            </div>
          )}

          {filter === "medeben" && meDeben.length > 0 && (
            <div style={{display:"flex",justifyContent:"flex-end",marginBottom:8}}>
              <button className="btn btn-g btn-sm" onClick={()=>{setSelectMode(s=>!s);setSelectedIds(new Set());}}>
                {selectMode?"Cancelar seleccion":"Seleccionar para compartir"}
              </button>
            </div>
          )}

          {selectMode && selectedIds.size>0 && (
            <div style={{background:"#0f172a",color:"#fff",borderRadius:12,padding:"12px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,boxShadow:"0 8px 24px rgba(0,0,0,.15)"}}>
              <div style={{fontSize:12}}>{selectedIds.size} seleccionados · {fmt(selectedTotal)}</div>
              <button className="btn btn-p btn-sm" onClick={()=>shareSelected(meDeben.filter(e=>selectedIds.has(e.id)))}>Compartir</button>
            </div>
          )}

          {filter !== "medeben" && (
            <div style={{display:"flex",gap:12,marginBottom:14,fontSize:11,color:"#94a3b8",fontWeight:500}}>
              <div style={{display:"flex",alignItems:"center",gap:5}}>
                <div style={{width:18,height:18,borderRadius:5,background:"#0f4c81",display:"flex",alignItems:"center",justifyContent:"center"}}>
                  <span style={{color:"#fff",fontSize:10,fontWeight:700}}>v</span>
                </div>
                Ingresado
              </div>
              <div style={{display:"flex",alignItems:"center",gap:5}}>
                <div style={{width:18,height:18,borderRadius:5,background:"#059669",display:"flex",alignItems:"center",justifyContent:"center"}}>
                  <span style={{color:"#fff",fontSize:10,fontWeight:700}}>v</span>
                </div>
                Pagado
              </div>
            </div>
          )}

          {loading ? (
            <div style={{textAlign:"center",padding:"60px 0",color:"#94a3b8",fontSize:13}}>Cargando...</div>
          ) : <>
            {filtered.length===0 && (
              <div style={{textAlign:"center",padding:"60px 0",fontSize:13}}>
                <div style={{color:"#cbd5e1"}}>{filter==="medeben"?"Nadie te debe nada":"Sin gastos aqui."}</div>
              </div>
            )}
            {filteredGroups.map(group => (
              <div key={group.date}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",margin:"18px 0 8px",padding:"0 2px"}}>
                  <div style={{fontSize:11,fontWeight:700,color:"#64748b",letterSpacing:1,textTransform:"uppercase"}}>{dayHeaderLabel(group.date)}</div>
                  <div style={{fontSize:11,fontWeight:700,color:"#94a3b8"}}>{fmt(group.total)}</div>
                </div>
                {group.items.map(ex => {
                  const owedAmt = owedForExp(ex);
                  const hasOwed = owedAmt > 0;
                  const fullyDone = ex.added && (!hasOwed || ex.paid);
                  const inCycle = ex.date >= cycle.start && ex.date <= cycle.end;
                  return (
                    <div key={ex.id} className={`row ${fullyDone?"dim":""} ${filter==="medeben"?"owed-highlight":""}`}>
                      <div style={{display:"flex",flexDirection:"column",gap:6,flexShrink:0,paddingTop:2}}>
                        {filter==="medeben" && selectMode && (
                          <div className={`chk amber ${selectedIds.has(ex.id)?"on":""}`} onClick={()=>toggleSelect(ex.id)}>
                            {selectedIds.has(ex.id) && <span style={{fontSize:11,color:"#fff",fontWeight:800}}>v</span>}
                          </div>
                        )}
                        <div className={`chk blue ${ex.added?"on":""}`} onClick={()=>toggleField(ex.id,"added")}>
                          {ex.added && <span style={{fontSize:11,color:"#fff",fontWeight:800}}>v</span>}
                        </div>
                        {hasOwed && (
                          <div className={`chk green ${ex.paid?"on":""}`} onClick={()=>toggleField(ex.id,"paid")}>
                            {ex.paid && <span style={{fontSize:11,color:"#fff",fontWeight:800}}>v</span>}
                          </div>
                        )}
                      </div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:3}}>
                          <div style={{fontSize:14,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ex.desc}</div>
                          {ex.category && <span style={{fontSize:11,color:"#64748b",flexShrink:0,background:"#f1f5f9",padding:"2px 6px",borderRadius:4}}>{catDisplay(ex.category)}</span>}
                        </div>
                        <div style={{fontSize:11,color:"#94a3b8",display:"flex",flexWrap:"wrap",gap:5,alignItems:"center"}}>
                          <span>{ex.date}</span>
                          {inCycle && filter!=="medeben" && <span className="badge badge-blue" style={{fontSize:9}}>ciclo actual</span>}
                          {hasOwed && !ex.paid && <span className="badge badge-amber">{(ex.owed||[]).map(p=>p.name||"Alguien").join(", ")} debe {fmt(owedAmt)}</span>}
                          {hasOwed && ex.paid && <span className="badge badge-green">Cobrado {fmt(owedAmt)}</span>}
                        </div>
                        {ex.note && <div style={{fontSize:11,color:"#94a3b8",marginTop:3,fontStyle:"italic"}}>{ex.note}</div>}
                      </div>
                      <div style={{textAlign:"right",flexShrink:0}}>
                        <div style={{fontSize:16,fontWeight:700}}>{fmt(ex.amount)}</div>
                        {hasOwed && !ex.paid && <div style={{fontSize:12,color:"#b45309",fontWeight:600}}>cobras {fmt(owedAmt)}</div>}
                        {hasOwed && <div style={{fontSize:11,color:"#059669",fontWeight:500}}>neto {fmt(ex.amount-owedAmt)}</div>}
                        {filter !== "medeben" && (
                          <div style={{marginTop:4}}>
                            <span className={`badge ${ex.added?"badge-blue":"badge-gray"}`}>
                              {ex.added?"ingresado":"pendiente"}
                            </span>
                          </div>
                        )}
                      </div>
                      <div style={{display:"flex",flexDirection:"column",gap:4,flexShrink:0}}>
                        <button className="btn btn-g btn-sm" style={{padding:"6px 8px"}} onClick={()=>startEdit(ex)}>E</button>
                        <button className="btn btn-d btn-sm" style={{padding:"6px 8px"}} onClick={()=>setConfirmDelete(ex)}>D</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
            {filter !== "medeben" && expenses.some(e=>!e.added) && (
              <button className="btn btn-g" style={{width:"100%",marginTop:14,borderStyle:"dashed",fontSize:12,padding:"13px"}}
                onClick={markAllAdded}>
                Marcar todos como ingresados ({fmt(expenses.filter(e=>!e.added).reduce((s,e)=>s+e.amount,0))})
              </button>
            )}
            {filter === "medeben" && meDeben.length > 0 && (
              <button className="btn btn-amber" style={{width:"100%",marginTop:14,fontSize:13,padding:"14px"}}
                onClick={()=>setConfirmBulkPaid(true)}>
                Marcar todos como pagados - {fmt(meDebenTotal)}
              </button>
            )}
          </>}
        </>}

        {tab==="recurring" && (
          <div>
            <div style={{fontSize:12,color:"#64748b",marginBottom:16,lineHeight:1.5}}>
              Toca el <strong>+</strong> para agregar el cargo al listado de pendientes con la fecha de hoy.
            </div>
            {recurring.length===0 && !loading && (
              <div style={{textAlign:"center",padding:"40px 0",color:"#cbd5e1",fontSize:13}}>Sin gastos fijos aun.</div>
            )}
            {recurring.sort((a,b)=>parseInt(a.day)-parseInt(b.day)).map(rec=>(
              <div key={rec.id} className="rec-row">
                <div style={{flex:1}}>
                  <div style={{fontSize:14,fontWeight:600}}>{rec.name}</div>
                  <div style={{fontSize:11,color:"#94a3b8",marginTop:2}}>Dia {rec.day} de cada mes</div>
                </div>
                <div style={{fontSize:15,fontWeight:700,marginRight:8}}>{fmt(rec.amount)}</div>
                <button className="btn btn-g btn-sm" style={{padding:"6px 8px",marginRight:4}} onClick={()=>startEditRec(rec)}>E</button>
                <button className="btn btn-d btn-sm" style={{padding:"6px 8px",marginRight:8}} onClick={()=>setConfirmRecDelete(rec)}>D</button>
                <button onClick={()=>addRecurringToList(rec)}
                  style={{width:32,height:32,borderRadius:"50%",background:"#0f4c81",border:"none",color:"#fff",fontSize:20,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                  +
                </button>
              </div>
            ))}
            <button className="btn btn-g" style={{width:"100%",marginTop:8,borderStyle:"dashed",fontSize:12,padding:"13px"}}
              onClick={()=>{setShowRecForm(true);setEditRecId(null);setRecForm(EMPTY_REC);}}>
              + agregar gasto fijo
            </button>
          </div>
        )}

        {tab==="summary" && (
          <div>
            {months.length===0 && <div style={{textAlign:"center",padding:"60px 0",color:"#cbd5e1",fontSize:13}}>Sin gastos para resumir.</div>}
            {months.map((month, monthIdx) => {
              const monthExps = expenses.filter(e=>getMonth(e.date)===month);
              const total = monthExps.reduce((s,e)=>s+e.amount,0);
              const pending = monthExps.filter(e=>!e.added).reduce((s,e)=>s+e.amount,0);
              const owedTotal = monthExps.reduce((s,e)=>s+owedForExp(e),0);
              const net = total - owedTotal;
              const prevMonth = months[monthIdx + 1];
              const prevTotal = prevMonth ? expenses.filter(e=>getMonth(e.date)===prevMonth).reduce((s,e)=>s+e.amount,0) : 0;
              const diff = total - prevTotal;
              const diffPct = prevTotal > 0 ? Math.abs(diff/prevTotal*100).toFixed(0) : null;
              const catMap = {};
              monthExps.forEach(e=>{ const cat=catDisplay(e.category||"Otro"); catMap[cat]=(catMap[cat]||0)+e.amount; });
              const topCats = Object.entries(catMap).sort((a,b)=>b[1]-a[1]).slice(0,5);
              const top3 = [...monthExps].sort((a,b)=>b.amount-a.amount).slice(0,3);
              return (
                <div key={month} className="card" style={{marginBottom:12}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}>
                    <div>
                      <div style={{fontFamily:"'Playfair Display',serif",fontSize:18,fontWeight:700}}>{monthLabel(month)}</div>
                      {diffPct !== null && (
                        <div style={{display:"flex",alignItems:"center",gap:4,marginTop:4}}>
                          <span style={{fontSize:12,fontWeight:700,color:diff>0?"#dc2626":"#059669"}}>{diff>0?"^":"v"} {fmt(Math.abs(diff))}</span>
                          <span style={{fontSize:11,color:"#94a3b8"}}>({diffPct}% {diff>0?"mas":"menos"} que {monthLabel(prevMonth)})</span>
                        </div>
                      )}
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontSize:22,fontWeight:700,color:"#0f4c81"}}>{fmt(total)}</div>
                      <div style={{fontSize:11,color:"#94a3b8"}}>neto {fmt(net)}</div>
                    </div>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:16}}>
                    <div style={{background:"#f8fafc",borderRadius:8,padding:"8px 10px"}}>
                      <div style={{fontSize:9,color:"#94a3b8",letterSpacing:1,fontWeight:600,marginBottom:2}}>GASTOS</div>
                      <div style={{fontSize:15,fontWeight:700}}>{monthExps.length}</div>
                    </div>
                    <div style={{background:"#eff6ff",borderRadius:8,padding:"8px 10px"}}>
                      <div style={{fontSize:9,color:"#0f4c81",letterSpacing:1,fontWeight:600,marginBottom:2}}>PENDIENTE</div>
                      <div style={{fontSize:15,fontWeight:700,color:"#0f4c81"}}>{fmt(pending)}</div>
                    </div>
                    <div style={{background:"#fffbeb",borderRadius:8,padding:"8px 10px"}}>
                      <div style={{fontSize:9,color:"#b45309",letterSpacing:1,fontWeight:600,marginBottom:2}}>ME DEBEN</div>
                      <div style={{fontSize:15,fontWeight:700,color:"#b45309"}}>{fmt(owedTotal)}</div>
                    </div>
                  </div>
                  {topCats.length>0 && (
                    <div style={{marginBottom:16}}>
                      <div style={{fontSize:10,color:"#94a3b8",letterSpacing:1,fontWeight:600,marginBottom:10}}>CATEGORIAS</div>
                      {topCats.map(([cat,amt])=>{
                        const pct = total>0 ? Math.round(amt/total*100) : 0;
                        return (
                          <div key={cat} style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                            <div style={{fontSize:12,color:"#64748b",width:100,flexShrink:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{cat}</div>
                            <div style={{flex:1,height:6,background:"#f1f5f9",borderRadius:3,overflow:"hidden"}}>
                              <div style={{width:`${pct}%`,height:"100%",background:"linear-gradient(90deg,#0f4c81,#1e6ab0)",borderRadius:3}}></div>
                            </div>
                            <div style={{fontSize:11,color:"#94a3b8",fontWeight:600,width:28,textAlign:"right",flexShrink:0}}>{pct}%</div>
                            <div style={{fontSize:12,fontWeight:700,width:60,textAlign:"right",flexShrink:0}}>{fmt(amt)}</div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {top3.length>0 && (
                    <div>
                      <div style={{fontSize:10,color:"#94a3b8",letterSpacing:1,fontWeight:600,marginBottom:10}}>TOP GASTOS</div>
                      {top3.map((ex,i)=>(
                        <div key={ex.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 10px",background:i===0?"#eff6ff":i===1?"#f8fafc":"#fafafa",borderRadius:8,marginBottom:6}}>
                          <div style={{width:20,height:20,borderRadius:"50%",background:i===0?"#0f4c81":i===1?"#64748b":"#94a3b8",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                            <span style={{color:"#fff",fontSize:10,fontWeight:700}}>{i+1}</span>
                          </div>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontSize:13,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ex.desc}</div>
                            <div style={{fontSize:10,color:"#94a3b8"}}>{ex.date}{ex.category?" - "+catDisplay(ex.category):""}</div>
                          </div>
                          <div style={{fontSize:14,fontWeight:700,color:i===0?"#0f4c81":"#0f172a",flexShrink:0}}>{fmt(ex.amount)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {!showForm && !showRecForm && tab==="list" && (
        <button className="fab" onClick={()=>{setEditId(null);setForm(EMPTY_FORM);setShowOwed(false);setShowForm(true);setTimeout(()=>descRef.current?.focus(),200);}}>+</button>
      )}

      {toast && <div className={`toast ${toast.type==="warn"?"twarn":"tok"}`}>{toast.msg}</div>}
    </div>
  );
}
