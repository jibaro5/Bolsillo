import { useState, useEffect, useRef } from "react";

const SCRIPT_URL = "/api/sheet";
const CLOSE_DAY = 20;
const DUE_DAY = 17;

// Local calendar date as YYYY-MM-DD. Using toISOString() here would shift to
// tomorrow's date in the evening for any timezone behind UTC (e.g. Puerto Rico).
function localDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}
function today() { return localDateStr(new Date()); }
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
    const results = [];
    // Matches "Name: $amount" pairs even when several are run together
    // without a separating comma (e.g. "Shel: 8.00 Devin: 3.00").
    const pairRe = /([^:,]+):\s*\$?\s*(-?\d+(?:\.\d+)?)/g;
    String(s).split(",").forEach(part => {
      part = part.trim();
      if (!part) return;
      const matches = [...part.matchAll(pairRe)];
      if (matches.length) {
        matches.forEach(m => {
          const num = parseFloat(m[2]);
          if (!isNaN(num)) results.push({ name: m[1].trim(), type: "fixed", value: String(num) });
        });
        return;
      }
      const num = parseFloat(part.replace(/[$\s]/g, ""));
      if (!isNaN(num)) results.push({ name: "", type: "fixed", value: String(num) });
    });
    return results;
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
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (dateStr === localDateStr(yesterday)) return "Ayer";
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
  const lines = ["*Pa' cuadrar*", ""];
  groups.forEach(g => {
    lines.push(`*${dayHeaderLabel(g.date,{relative:false})}*`);
    lines.push("");
    g.items.forEach(ex => {
      const owedAmt = owedForExp(ex);
      const mine = ex.amount - owedAmt;
      lines.push(`${ex.desc} - ${fmt(ex.amount)}`);
      (ex.owed||[]).forEach(p => {
        lines.push(`  ${p.name||"Alguien"} debe: ${fmt(parseFloat(p.value)||0)}`);
      });
      lines.push(`  Omar: ${fmt(mine)}`);
      lines.push("");
    });
  });
  const personTotals = {};
  items.forEach(ex => {
    (ex.owed||[]).forEach(p => {
      const name = p.name || "Alguien";
      personTotals[name] = (personTotals[name]||0) + (parseFloat(p.value)||0);
    });
  });
  const totalsLine = Object.entries(personTotals).map(([name,amt])=>`${name}: ${fmt(amt)}`).join(", ");
  lines.push("*Total*");
  lines.push(totalsLine);
  lines.push("");
  lines.push("¿Te debo algo?");
  return lines.join("\n").trim();
}
function getCycleInfo(closeDay = CLOSE_DAY, dueDay = DUE_DAY) {
  const now = new Date();
  const day = now.getDate();
  const year = now.getFullYear();
  const month = now.getMonth();
  let cycleStart, cycleEnd, dueDate;
  if (day <= closeDay) {
    cycleStart = new Date(year, month - 1, closeDay + 1);
    cycleEnd = new Date(year, month, closeDay);
    dueDate = new Date(year, month + 1, dueDay);
  } else {
    cycleStart = new Date(year, month, closeDay + 1);
    cycleEnd = new Date(year, month + 1, closeDay);
    dueDate = new Date(year, month + 2, dueDay);
  }
  const msPerDay = 1000 * 60 * 60 * 24;
  const daysUntilDue = Math.ceil((dueDate - now) / msPerDay);
  return {
    start: localDateStr(cycleStart),
    end: localDateStr(cycleEnd),
    due: localDateStr(dueDate),
    daysUntilDue,
    isUrgent: daysUntilDue <= 5,
  };
}

async function parseJsonSafe(res) {
  try { return await res.json(); } catch { return null; }
}

// Session token for /api/sheet, held here (not in component state) since
// fetchWithTimeout is a plain module-level function shared by every API call.
let sessionToken = (() => { try { return localStorage.getItem("bolsillo_session"); } catch { return null; } })();
let unauthorizedCb = null;
function getSessionToken() { return sessionToken; }
function setSessionToken(token) {
  sessionToken = token;
  try {
    if (token) localStorage.setItem("bolsillo_session", token);
    else localStorage.removeItem("bolsillo_session");
  } catch {}
}
function onUnauthorized(cb) { unauthorizedCb = cb; }
function logout() {
  setSessionToken(null);
  if (unauthorizedCb) unauthorizedCb();
}

// Apps Script can hang far longer than any user should have to wait on a
// loading spinner. Every request to it goes through here so a stuck call
// fails clearly after TIMEOUT_MS instead of spinning indefinitely.
const TIMEOUT_MS = 20000;
async function fetchWithTimeout(url, opts={}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers = { ...(opts.headers||{}) };
    if (sessionToken) headers.Authorization = `Bearer ${sessionToken}`;
    const res = await fetch(url, { ...opts, headers, signal: controller.signal });
    if (res.status === 401) {
      setSessionToken(null);
      if (unauthorizedCb) unauthorizedCb();
    }
    return res;
  } catch (err) {
    if (err.name === "AbortError") throw new Error(`Tiempo de espera agotado (${TIMEOUT_MS/1000}s)`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
function buildOwedStr(expense) {
  return (expense.owed||[]).map(p => {
    const amt = calcOwedAmt(p, expense.amount).toFixed(2);
    return p.name ? `${p.name}: $${amt}` : `$${amt}`;
  }).join(", ");
}
// Builds {read, append, edit, updateStatus, delete} for one "expenses"-shaped
// sheet tab, selected by the action prefix ("" = Discover, "debito-" = Debito).
// Both tabs share the same column layout, so the same requests work for either.
function makeExpenseApi(actionPrefix) {
  async function read() {
    const res = await fetchWithTimeout(`${SCRIPT_URL}?action=${actionPrefix}read`);
    const data = await res.json();
    return data.expenses || [];
  }
  async function append(expense) {
    const res = await fetchWithTimeout(SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action:`${actionPrefix}append`, desc:expense.desc, amount:expense.amount, date:expense.date, category:expense.category||"", owed:buildOwedStr(expense) }),
    });
    if (!res.ok) throw new Error(`${actionPrefix}append failed: ${res.status}`);
    return parseJsonSafe(res);
  }
  async function edit(expense) {
    const res = await fetchWithTimeout(SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action:`${actionPrefix}edit`, id:String(expense.sheetId), desc:expense.desc, amount:expense.amount, date:expense.date, category:expense.category||"", owed:buildOwedStr(expense) }),
    });
    if (!res.ok) throw new Error(`${actionPrefix}edit failed: ${res.status}`);
    return parseJsonSafe(res);
  }
  async function updateStatus(expense) {
    const res = await fetchWithTimeout(SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action:`${actionPrefix}update`, id:String(expense.sheetId), desc:expense.desc, date:expense.date, amount:String(expense.amount), added:String(expense.added), paid:String(expense.paid), owed:buildOwedStr(expense) }),
    });
    if (!res.ok) throw new Error(`${actionPrefix}update failed: ${res.status}`);
    return parseJsonSafe(res);
  }
  async function del(expense) {
    const res = await fetchWithTimeout(SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action:`${actionPrefix}delete`, id:String(expense.sheetId), desc:expense.desc, date:expense.date, amount:String(expense.amount) }),
    });
    if (!res.ok) throw new Error(`${actionPrefix}delete failed: ${res.status}`);
    return parseJsonSafe(res);
  }
  return { read, append, edit, updateStatus, delete: del };
}
const debitApi = makeExpenseApi("debito-");

// Same shape as makeExpenseApi, but for a specific credit card (identified
// by its id from the "Tarjetas" sheet) instead of a fixed action prefix.
function makeCardExpenseApi(cardId) {
  async function read() {
    const res = await fetchWithTimeout(`${SCRIPT_URL}?action=card-read&cardId=${encodeURIComponent(cardId)}`);
    const data = await res.json();
    return data.expenses || [];
  }
  async function append(expense) {
    const res = await fetchWithTimeout(SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action:"card-append", cardId, desc:expense.desc, amount:expense.amount, date:expense.date, category:expense.category||"", owed:buildOwedStr(expense) }),
    });
    if (!res.ok) throw new Error(`card-append failed: ${res.status}`);
    return parseJsonSafe(res);
  }
  async function edit(expense) {
    const res = await fetchWithTimeout(SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action:"card-edit", cardId, id:String(expense.sheetId), desc:expense.desc, amount:expense.amount, date:expense.date, category:expense.category||"", owed:buildOwedStr(expense) }),
    });
    if (!res.ok) throw new Error(`card-edit failed: ${res.status}`);
    return parseJsonSafe(res);
  }
  async function updateStatus(expense) {
    const res = await fetchWithTimeout(SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action:"card-update", cardId, id:String(expense.sheetId), desc:expense.desc, date:expense.date, amount:String(expense.amount), added:String(expense.added), paid:String(expense.paid), owed:buildOwedStr(expense) }),
    });
    if (!res.ok) throw new Error(`card-update failed: ${res.status}`);
    return parseJsonSafe(res);
  }
  async function del(expense) {
    const res = await fetchWithTimeout(SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action:"card-delete", cardId, id:String(expense.sheetId), desc:expense.desc, date:expense.date, amount:String(expense.amount) }),
    });
    if (!res.ok) throw new Error(`card-delete failed: ${res.status}`);
    return parseJsonSafe(res);
  }
  return { read, append, edit, updateStatus, delete: del };
}
const cardApiCache = {};
function apiFor(account) {
  if (account === "debit") return debitApi;
  if (!cardApiCache[account]) cardApiCache[account] = makeCardExpenseApi(account);
  return cardApiCache[account];
}

async function cardsList() {
  const res = await fetchWithTimeout(`${SCRIPT_URL}?action=cards-list`);
  const data = await res.json();
  return data.cards || [];
}
async function cardsAdd(card) {
  const res = await fetchWithTimeout(SCRIPT_URL, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ action:"cards-add", ...card }) });
  if (!res.ok) throw new Error(`cards-add failed: ${res.status}`);
  return parseJsonSafe(res);
}
async function cardsEdit(id, fields) {
  const res = await fetchWithTimeout(SCRIPT_URL, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ action:"cards-edit", id, ...fields }) });
  if (!res.ok) throw new Error(`cards-edit failed: ${res.status}`);
  return parseJsonSafe(res);
}
async function cardsDelete(id) {
  const res = await fetchWithTimeout(SCRIPT_URL, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ action:"cards-delete", id }) });
  if (!res.ok) throw new Error(`cards-delete failed: ${res.status}`);
  return parseJsonSafe(res);
}

async function recurringRead() {
  const res = await fetchWithTimeout(`${SCRIPT_URL}?action=recurring-read`);
  const data = await res.json();
  return data.items || [];
}
async function recurringAppend(item) {
  const res = await fetchWithTimeout(SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action:"recurring-append", name:item.name, amount:item.amount, day:item.day }),
  });
  if (!res.ok) throw new Error(`recurringAppend failed: ${res.status}`);
  return parseJsonSafe(res);
}
async function recurringEdit(item) {
  const res = await fetchWithTimeout(SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action:"recurring-edit", id:String(item.sheetId), name:item.name, amount:item.amount, day:item.day }),
  });
  if (!res.ok) throw new Error(`recurringEdit failed: ${res.status}`);
  return parseJsonSafe(res);
}
async function recurringDelete(item) {
  const res = await fetchWithTimeout(SCRIPT_URL, {
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

// Normalizes raw sheet rows into app-shaped expenses, tagging each with its
// account (a credit card's id, or "debit"). The local id is prefixed with
// the account so rows from different tabs (which each number their own rows
// starting at 1) can never collide; sheetId stays the raw row number for API calls.
function normalizeExpenseRows(rows, account) {
  const normalized = [];
  for (let i = 0; i < rows.length; i++) {
    try {
      const e = rows[i];
      const dateVal = e.date ? String(e.date).trim() : "";
      if (!dateVal) continue;
      const amt = parseAmt(e.amount);
      if (amt === 0 && !e.desc) continue;
      normalized.push({
        id: `${account}-${e.id || String(Date.now()+i)}`,
        sheetId: e.id,
        account,
        desc: String(e.desc||""),
        amount: amt,
        date: dateVal,
        category: String(e.category||""),
        note: String(e.note||""),
        owed: parseOwedStr(e.owed),
        added: account === "debit" ? true : (e.added === true || String(e.added).toUpperCase().trim() === "SI"),
        paid: e.paid === true || String(e.paid).toUpperCase().trim() === "SI",
      });
    } catch(err) { console.warn("Skipping row", i, err); }
  }
  return normalized;
}

const EMPTY_FORM = { desc:"", amount:"", date:today(), category:"", note:"", owed:[] };
const EMPTY_REC = { name:"", amount:"", day:"" };

function App() {
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
  const [dismissedPeople, setDismissedPeople] = useState(() => {
    try { return JSON.parse(localStorage.getItem("bolsillo_dismissed_people") || "[]"); }
    catch { return []; }
  });
  const [loading, setLoading] = useState(false);
  const [pendingSyncs, setPendingSyncs] = useState(0);
  const syncing = pendingSyncs > 0;
  const [status, setStatus] = useState("idle");
  const [toast, setToast] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmRecDelete, setConfirmRecDelete] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [formAccount, setFormAccount] = useState("");
  const [tab, setTab] = useState("list");
  const [cards, setCards] = useState([]);
  const [activeCard, setActiveCard] = useState("");
  const [showCardsModal, setShowCardsModal] = useState(false);
  const [editingCardId, setEditingCardId] = useState(null);
  const [cardForm, setCardForm] = useState({ nombre:"", color:"#0f4c81", cierreDay:"", dueDay:"" });
  const [confirmDeleteCard, setConfirmDeleteCard] = useState(null);
  const [confirmBulkPaid, setConfirmBulkPaid] = useState(false);
  const descRef = useRef();
  const syncQueueRef = useRef({});
  const lastCreditCardRef = useRef("");

  useEffect(() => { loadAll(); }, []);

  // Once cards load, default both the hero and the "Nuevo gasto" toggle to
  // the first one — but only if nothing more specific has been picked yet.
  useEffect(() => {
    if (!cards.length) return;
    if (!activeCard) setActiveCard(cards[0].id);
    if (!formAccount) setFormAccount(cards[0].id);
  }, [cards]);

  useEffect(() => {
    if (activeCard && activeCard !== "debit") lastCreditCardRef.current = activeCard;
  }, [activeCard]);

  function cardName(accountId) {
    if (accountId === "debit") return "Debito";
    return cards.find(c => c.id === accountId)?.nombre || "Tarjeta";
  }

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
      // Cards need to be known before we can fire one read per card, so this
      // one goes first; everything else (debito, recurring, and each card's
      // own expenses) then fires in parallel. Debito and each card's read
      // are wrapped in their own catch so one failing (e.g. a tab not
      // existing yet) resolves to an empty list instead of taking down
      // the rest of the load.
      const cardsRows = await cardsList();
      setCards(cardsRows);
      const debitPromise = debitApi.read().catch(err => {
        console.warn("Debito tab not available yet", err);
        return [];
      });
      const cardPromises = cardsRows.map(c =>
        apiFor(c.id).read().catch(err => {
          console.warn(`Card ${c.id} not available yet`, err);
          return [];
        })
      );
      const [recItems, debitRows, ...cardRowsList] = await Promise.all([
        recurringRead(), debitPromise, ...cardPromises,
      ]);
      const normalized = [
        ...cardsRows.flatMap((c,i) => normalizeExpenseRows(cardRowsList[i], c.id)),
        ...normalizeExpenseRows(debitRows, "debit"),
      ];
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
  function lastSplitForPerson(name) {
    const matches = expenses
      .filter(e => e.amount > 0 && (e.owed||[]).some(p=>p.name===name))
      .sort((a,b) => b.date.localeCompare(a.date));
    if (!matches.length) return null;
    const p = matches[0].owed.find(p=>p.name===name);
    const pct = (parseFloat(p.value) / matches[0].amount) * 100;
    return isFinite(pct) && pct > 0 ? Math.round(pct * 10) / 10 : null;
  }
  function pickKnownPerson(name) {
    const pct = lastSplitForPerson(name);
    const newPerson = { name, type: pct!=null?"pct":"fixed", value: pct!=null?String(pct):"" };
    setForm(f => {
      const emptyIdx = f.owed.findIndex(p=>!p.name.trim());
      if (emptyIdx > -1) return {...f, owed: f.owed.map((p,i)=>i===emptyIdx?newPerson:p)};
      return {...f, owed:[...f.owed, newPerson]};
    });
  }
  function dismissKnownPerson(name) {
    setDismissedPeople(prev => {
      const next = [...new Set([...prev, name])];
      try { localStorage.setItem("bolsillo_dismissed_people", JSON.stringify(next)); } catch {}
      return next;
    });
  }

  function submitForm(e) {
    e.preventDefault();
    if (!form.desc.trim()||!form.amount) return;
    const base = parseFloat(form.amount);
    const convertedOwed = form.owed.filter(p=>p.value).map(p=>({
      name: p.name||"", type:"fixed", value:String(calcOwedAmt(p,base).toFixed(2)),
    }));
    const isEdit = !!editId;
    const prevExpense = isEdit ? expenses.find(x=>x.id===editId) : null;
    const account = isEdit ? (prevExpense?.account || cards[0]?.id) : formAccount;
    const expense = {
      id: editId ?? `${account}-${Date.now()}`,
      sheetId: isEdit ? prevExpense?.sheetId : null,
      account,
      desc:form.desc, amount:base, date:form.date, category:form.category, note:form.note,
      owed:convertedOwed,
      added: isEdit ? (prevExpense?.added??false) : account === "debit",
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
    const api = apiFor(account);
    runSync(expense.id, () => isEdit ? api.edit(expense) : api.append(expense))
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
    const cardId = (activeCard && activeCard !== "debit") ? activeCard : (cards[0]?.id || "discover");
    const expense = {
      id: `${cardId}-${Date.now()}`,
      sheetId: null,
      account: cardId,
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
    runSync(expense.id, () => apiFor(cardId).append(expense))
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
    runSync(id, () => apiFor(exp.account).updateStatus(exp))
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
      runSync(exp.id, () => apiFor(exp.account).updateStatus({...exp,[field]:true}))
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
    const pending = expenses.filter(e=>e.account===activeCard && !e.added);
    if (!pending.length) return;
    bulkToggle(pending, "added", `${pending.length} gastos marcados como ingresados`);
  }

  function doDelete() {
    const ex = confirmDelete;
    setConfirmDelete(null);
    const snapshot = expenses;
    setExpenses(prev=>prev.filter(x=>x.id!==ex.id));
    runSync(ex.id, () => apiFor(ex.account).delete(ex))
      .then(() => showToast("Eliminado"))
      .catch(err => {
        console.error(err);
        setExpenses(snapshot);
        showToast("Error al eliminar","warn");
      });
  }

  function startEdit(ex) {
    setEditId(ex.id);
    setFormAccount(ex.account || cards[0]?.id || "discover");
    setForm({desc:ex.desc, amount:String(ex.amount), date:ex.date, category:ex.category||"", note:ex.note||"", owed:ex.owed||[]});
    setShowOwed((ex.owed||[]).length > 0);
    setShowForm(true);
    setTimeout(()=>descRef.current?.focus(),100);
  }
  function cancelEdit() { setEditId(null); setForm(EMPTY_FORM); setShowOwed(false); setShowForm(false); }
  function startAdd(account) {
    setEditId(null);
    setFormAccount(account);
    setForm(EMPTY_FORM);
    setShowOwed(false);
    setShowForm(true);
    setTimeout(()=>descRef.current?.focus(),200);
  }

  function startEditRec(item) {
    setEditRecId(item.id);
    setRecForm({name:item.name, amount:String(item.amount), day:String(item.day)});
    setShowRecForm(true);
  }

  function startAddCard() {
    setEditingCardId(null);
    setCardForm({ nombre:"", color:"#0f4c81", cierreDay:"", dueDay:"" });
  }
  function startEditCard(card) {
    setEditingCardId(card.id);
    setCardForm({ nombre:card.nombre, color:card.color||"#0f4c81", cierreDay:String(card.cierreDay||""), dueDay:String(card.dueDay||"") });
  }
  async function submitCardForm(e) {
    e.preventDefault();
    if (!cardForm.nombre.trim()) return;
    try {
      if (editingCardId) {
        await cardsEdit(editingCardId, cardForm);
        showToast("Tarjeta actualizada");
      } else {
        await cardsAdd(cardForm);
        showToast("Tarjeta agregada");
      }
      setEditingCardId(null);
      setCardForm({ nombre:"", color:"#0f4c81", cierreDay:"", dueDay:"" });
      await loadAll();
    } catch (err) {
      console.error(err);
      showToast("No se pudo guardar la tarjeta","warn");
    }
  }
  async function doDeleteCard() {
    const card = confirmDeleteCard;
    setConfirmDeleteCard(null);
    try {
      await cardsDelete(card.id);
      showToast("Tarjeta eliminada (sus gastos no se borraron)");
      if (activeCard === card.id) setActiveCard("");
      await loadAll();
    } catch (err) {
      console.error(err);
      showToast("No se pudo eliminar la tarjeta","warn");
    }
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

  // "Gastos"/ciclo/Resumen son exclusivos de la tarjeta Discover (credit);
  // los gastos de debito viven aparte y solo se unen de nuevo en "Me deben".
  const activeCardObj = cards.find(c => c.id === activeCard);
  const cardExpenses = (activeCard && activeCard !== "debit") ? expenses.filter(e => e.account === activeCard) : [];
  const debitExpenses = expenses.filter(e => e.account === "debit");

  const cycle = getCycleInfo(
    activeCardObj?.cierreDay ? parseInt(activeCardObj.cierreDay, 10) : CLOSE_DAY,
    activeCardObj?.dueDay ? parseInt(activeCardObj.dueDay, 10) : DUE_DAY,
  );
  const cycleExpenses = cardExpenses.filter(e => e.date >= cycle.start && e.date <= cycle.end);
  const cycleTotal = cycleExpenses.reduce((s,e)=>s+e.amount,0);
  const cyclePending = cycleExpenses.filter(e=>!e.added).reduce((s,e)=>s+e.amount,0);
  const totalOwed = expenses.filter(e=>!e.paid).reduce((s,e)=>s+owedForExp(e),0);
  const netCost = cycleExpenses.reduce((s,e)=>s+(e.amount-owedForExp(e)),0);
  const months = [...new Set(cardExpenses.map(e=>getMonth(e.date)))].sort().reverse();
  const availableMonths = [...new Set(cardExpenses.map(e=>getMonth(e.date)))].sort().reverse();
  const meDeben = expenses.filter(e => owedForExp(e) > 0 && !e.paid);
  const meDebenTotal = meDeben.reduce((s,e)=>s+owedForExp(e),0);
  const meDebenGroups = groupByDate(meDeben);

  let filtered = cardExpenses;
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
  const filteredTotal = filtered.reduce((s,e)=>s+e.amount,0);
  const debitGroups = groupByDate(debitExpenses);
  const debitTotal = debitExpenses.reduce((s,e)=>s+e.amount,0);

  const expenseNames = [...new Set(expenses.map(e=>e.desc.trim()).filter(Boolean))];
  const qName = nameFilter.trim().toLowerCase();
  const nameSuggestions = qName
    ? expenseNames.filter(n=>n.toLowerCase().includes(qName) && n.toLowerCase()!==qName).slice(0,6)
    : [];
  const knownPeople = [...new Set(expenses.flatMap(e=>(e.owed||[]).map(p=>p.name.trim())).filter(Boolean))]
    .filter(n=>!dismissedPeople.includes(n))
    .sort();
  const categoryByName = {};
  [...expenses].sort((a,b)=>a.date.localeCompare(b.date)).forEach(e => {
    const key = e.desc.trim().toLowerCase();
    if (key && e.category) categoryByName[key] = e.category;
  });
  const selectedTotal = meDeben.filter(e=>selectedIds.has(e.id)).reduce((s,e)=>s+owedForExp(e),0);
  const hasActiveFilters = !!(nameFilter || dateFrom || dateTo);

  // Ultimos 6 meses con datos, para la grafica de Resumen.
  const chartMonths = [...months].slice(0,6).reverse();
  const chartData = chartMonths.map(m => {
    const exps = cardExpenses.filter(e=>getMonth(e.date)===m);
    return { month:m, total: exps.reduce((s,e)=>s+e.amount,0), owed: exps.reduce((s,e)=>s+owedForExp(e),0) };
  });
  const chartMax = Math.max(1, ...chartData.map(d=>Math.max(d.total,d.owed))) * 1.15;

  const statusDot = status==="ok"?"#059669":status==="error"?"#dc2626":"#94a3b8";

  // Fila compartida para gastos de Discover/Debito y para el detalle de "Me deben".
  function ExpenseRow(ex, opts={}) {
    const { showAdded=true, selectable=false, showSource=false } = opts;
    const owedAmt = owedForExp(ex);
    const hasOwed = owedAmt > 0;
    const fullyDone = showAdded ? (ex.added && (!hasOwed || ex.paid)) : (hasOwed && ex.paid);
    const inCycle = ex.account===activeCard && ex.date >= cycle.start && ex.date <= cycle.end;
    return (
      <div key={ex.id} className={`tx ${fullyDone?"tx-dim":""}`}>
        <div className="tx-checks">
          {selectable && selectMode ? (
            <div className={`chk amber ${selectedIds.has(ex.id)?"on":""}`} style={{width:26,height:26}} onClick={()=>toggleSelect(ex.id)}>
              {selectedIds.has(ex.id) && <span style={{fontSize:12,color:"#fff",fontWeight:800}}>v</span>}
            </div>
          ) : (
            <>
              {showAdded && (
                <div className={`chk blue ${ex.added?"on":""}`} onClick={()=>toggleField(ex.id,"added")}>
                  {ex.added && <span style={{fontSize:11,color:"#fff",fontWeight:800}}>v</span>}
                </div>
              )}
              {hasOwed && (
                <div className={`chk green ${ex.paid?"on":""}`} onClick={()=>toggleField(ex.id,"paid")}>
                  {ex.paid && <span style={{fontSize:11,color:"#fff",fontWeight:800}}>v</span>}
                </div>
              )}
            </>
          )}
        </div>
        <div className="tx-ico">{ex.category ? (CAT_EMOJI[ex.category]||"📦") : "💳"}</div>
        <div className="tx-mid">
          <div className="tx-title">{ex.desc}</div>
          <div className="tx-sub">
            <span>{ex.date}</span>
            {showSource && <span className="src-badge">{cardName(ex.account)}</span>}
            {inCycle && !showSource && <span className="badge badge-blue" style={{fontSize:9}}>ciclo actual</span>}
            {hasOwed && !ex.paid && <span className="badge badge-amber">{(ex.owed||[]).map(p=>p.name||"Alguien").join(", ")} debe {fmt(owedAmt)}</span>}
            {hasOwed && ex.paid && <span className="badge badge-green">Cobrado {fmt(owedAmt)}</span>}
          </div>
          {ex.note && <div className="tx-note">{ex.note}</div>}
        </div>
        <div className="tx-amt">
          <div className="n">{fmt(ex.amount)}</div>
          {hasOwed && !ex.paid && <div className="owe">cobras {fmt(owedAmt)}</div>}
          {hasOwed && <div style={{fontSize:11,color:"#059669",fontWeight:500,marginTop:2}}>neto {fmt(ex.amount-owedAmt)}</div>}
          {showAdded && !showSource && (
            <div style={{marginTop:4}}>
              <span className={`badge ${ex.added?"badge-blue":"badge-gray"}`}>{ex.added?"ingresado":"pendiente"}</span>
            </div>
          )}
        </div>
        <div className="tx-actions">
          <button className="btn btn-g btn-sm" style={{padding:"6px 8px"}} onClick={()=>startEdit(ex)}>E</button>
          <button className="btn btn-d btn-sm" style={{padding:"6px 8px"}} onClick={()=>setConfirmDelete(ex)}>D</button>
        </div>
      </div>
    );
  }

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
        .ptt{display:flex;background:#f1f5f9;border-radius:8px;padding:3px;gap:2px;}
        .pto{flex:1;padding:7px 8px;text-align:center;font-size:12px;cursor:pointer;border:none;background:transparent;color:#64748b;font-family:'DM Sans',sans-serif;font-weight:600;transition:all .15s;border-radius:6px;}
        .pto.on{background:#fff;color:#0f4c81;box-shadow:0 1px 4px rgba(0,0,0,.1);}
        .chk{width:24px;height:24px;border-radius:7px;border:2px solid #e2e8f0;background:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .15s;}
        .chk:hover{border-color:#94a3b8;transform:scale(1.05);}
        .chk.blue.on{background:#0f4c81;border-color:#0f4c81;box-shadow:0 2px 8px rgba(15,76,129,.3);}
        .chk.green.on{background:#059669;border-color:#059669;box-shadow:0 2px 8px rgba(5,150,105,.3);}
        .chk.amber.on{background:#b45309;border-color:#b45309;box-shadow:0 2px 8px rgba(180,83,9,.3);}
        .suggest{position:absolute;top:100%;left:0;right:0;background:#fff;border:1.5px solid #e2e8f0;border-radius:10px;margin-top:4px;z-index:50;box-shadow:0 8px 24px rgba(0,0,0,.1);overflow:hidden;}
        .suggest-item{padding:9px 14px;font-size:13px;cursor:pointer;}
        .suggest-item:hover{background:#f1f5f9;}
        .card{background:#fff;border-radius:14px;padding:20px;box-shadow:0 1px 4px rgba(0,0,0,.06);}
        .toast{position:fixed;bottom:88px;left:50%;transform:translateX(-50%);padding:12px 24px;border-radius:12px;font-size:13px;z-index:999;animation:pop .2s ease;font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,.15);white-space:nowrap;}
        .tok{background:#0f4c81;color:#fff;}
        .twarn{background:#dc2626;color:#fff;}
        @keyframes pop{from{opacity:0;transform:translateX(-50%) translateY(8px);}to{opacity:1;transform:translateX(-50%) translateY(0);}}
        .pulse{animation:pulse 1.5s ease-in-out infinite;}
        @keyframes pulse{0%,100%{opacity:1;}50%{opacity:.4;}}
        .overlay{position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:200;display:flex;align-items:flex-end;justify-content:center;backdrop-filter:blur(4px);}
        .sheet{background:#fff;border-radius:20px 20px 0 0;padding:28px 24px 40px;width:100%;max-width:720px;max-height:90vh;overflow-y:auto;animation:slideUp .25s ease;}
        @keyframes slideUp{from{transform:translateY(100%);}to{transform:translateY(0);}}
        .modal-overlay{position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:300;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);padding:20px;}
        .modal{background:#fff;border-radius:20px;padding:28px;max-width:380px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,.2);animation:popIn .2s ease;}
        @keyframes popIn{from{opacity:0;transform:scale(.95);}to{opacity:1;transform:scale(1);}}
        .badge{display:inline-flex;align-items:center;gap:4px;font-size:10px;padding:3px 8px;border-radius:20px;font-weight:600;white-space:nowrap;}
        .badge-blue{background:#eff6ff;color:#0f4c81;border:1px solid #bfdbfe;}
        .badge-gray{background:#f8fafc;color:#94a3b8;border:1px solid #e2e8f0;}
        .badge-amber{background:#fffbeb;color:#b45309;border:1px solid #fde68a;}
        .badge-green{background:#f0fdf4;color:#059669;border:1px solid #bbf7d0;}
        .src-badge{font-size:9px;font-weight:700;letter-spacing:.3px;padding:2px 7px;border-radius:20px;background:#f1f5f9;color:#64748b;}
        .rec-row{display:flex;align-items:center;gap:10px;padding:11px 14px;background:#fff;border:1.5px solid #e2e8f0;border-radius:10px;margin-bottom:8px;}

        /* ---- credit-card hero stack ---- */
        .card-stack{position:relative;height:172px;margin-bottom:6px;}
        .card-stack .stack-card{
          position:absolute;left:0;right:0;top:0;border-radius:20px;padding:18px 20px;color:#fff;overflow:hidden;
          transition:transform .25s cubic-bezier(.3,.9,.4,1), box-shadow .25s ease, opacity .25s ease; cursor:pointer;
        }
        .stack-card::after{content:"";position:absolute;inset:-40% -10% auto auto;width:200px;height:200px;border-radius:50%;
          background:radial-gradient(circle at 30% 30%, rgba(255,255,255,.16), transparent 65%);}
        .stack-card.back{transform:translateY(0) scale(.94);z-index:1;opacity:.92;box-shadow:0 10px 20px -12px rgba(15,23,42,.35);}
        .stack-card.front{transform:translateY(18px) scale(1);z-index:2;box-shadow:0 16px 30px -14px rgba(15,76,129,.5);}
        .card-row1{display:flex;align-items:flex-start;justify-content:space-between;}
        .card-brand{font-size:10.5px;font-weight:700;letter-spacing:2.2px;opacity:.85;}
        .card-chip{width:28px;height:20px;border-radius:5px;margin-top:6px;background:linear-gradient(135deg,#fde68a,#f3c969);box-shadow:inset 0 0 0 1px rgba(0,0,0,.08);}
        .card-dots{font-size:16px;letter-spacing:2px;opacity:.85;}
        .card-row2{display:flex;align-items:flex-end;justify-content:space-between;position:relative;z-index:1;margin-top:22px;}
        .card-label{font-size:9px;letter-spacing:1.5px;opacity:.7;margin-bottom:3px;}
        .card-value{font-size:13px;font-weight:600;}
        .card-total{text-align:right;}
        .card-total .serif{font-size:24px;font-weight:700;line-height:1;}
        .due-pill{display:inline-flex;margin-top:8px;padding:3px 9px;border-radius:20px;background:rgba(255,255,255,.18);font-size:10px;font-weight:700;letter-spacing:.3px;}
        .stack-hint{text-align:center;font-size:10.5px;color:#94a3b8;margin-bottom:14px;}
        .stack-hint b{color:#64748b;}

        /* ---- quick actions ---- */
        .quick{display:flex;justify-content:space-between;margin-bottom:6px;}
        .qbtn{display:flex;flex-direction:column;align-items:center;gap:6px;background:none;border:none;cursor:pointer;color:#0f172a;font-family:inherit;width:70px;}
        .qbtn .qicon{width:44px;height:44px;border-radius:15px;background:#fff;border:1px solid #e2e8f0;display:flex;align-items:center;justify-content:center;font-size:18px;box-shadow:0 1px 2px rgba(15,23,42,.05);transition:transform .15s ease;}
        .qbtn:active .qicon{transform:scale(.94);}
        .qbtn span{font-size:10.5px;font-weight:600;color:#64748b;}

        /* ---- stat tiles ---- */
        .stat{border-radius:14px;}
        .stat.blue{background:#eff6ff;border:1px solid #bfdbfe;}
        .stat.amber{background:#fffbeb;border:1px solid #fde68a;}
        .stat.green{background:#f0fdf4;border:1px solid #bbf7d0;}
        .stat-label{font-size:9px;font-weight:700;letter-spacing:.8px;opacity:.8;}
        .stat.blue .stat-label, .stat.blue .stat-value{color:#0f4c81;}
        .stat.amber .stat-label, .stat.amber .stat-value{color:#b45309;}
        .stat.green .stat-label, .stat.green .stat-value{color:#059669;}
        .stat-value{font-weight:700;margin-top:3px;}

        /* ---- transaction rows ---- */
        .tx{display:flex;align-items:flex-start;gap:10px;padding:12px 0;border-bottom:1px solid #e2e8f0;}
        .tx:last-child{border-bottom:none;}
        .tx.tx-dim{opacity:.4;}
        .tx-checks{display:flex;flex-direction:column;gap:6px;padding-top:2px;flex-shrink:0;}
        .tx-ico{width:38px;height:38px;border-radius:12px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:16px;background:#f1f5f9;margin-top:1px;}
        .tx-mid{flex:1;min-width:0;padding-top:2px;}
        .tx-title{font-size:13.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
        .tx-sub{font-size:11px;color:#94a3b8;margin-top:2px;display:flex;flex-wrap:wrap;gap:5px;align-items:center;}
        .tx-note{font-size:11px;color:#94a3b8;margin-top:3px;font-style:italic;}
        .tx-amt{text-align:right;flex-shrink:0;padding-top:2px;}
        .tx-amt .n{font-size:14px;font-weight:700;}
        .tx-amt .owe{font-size:10.5px;color:#b45309;font-weight:700;margin-top:2px;}
        .tx-actions{display:flex;flex-direction:column;gap:4px;flex-shrink:0;}
        .day-head{display:flex;justify-content:space-between;align-items:baseline;margin:18px 0 8px;padding:0 2px;font-size:11px;font-weight:700;color:#64748b;letter-spacing:1px;text-transform:uppercase;}
        .empty-state{text-align:center;padding:60px 0;font-size:13px;color:#cbd5e1;}

        /* ---- Nuevo gasto: receipt preview + category grid ---- */
        .acct-toggle{display:flex;gap:8px;margin-bottom:16px;}
        .acct-btn{flex:1;padding:10px;border-radius:12px;border:1.5px solid #e2e8f0;background:#fff;font-family:inherit;font-size:12.5px;font-weight:700;color:#64748b;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;}
        .acct-btn.on.discover{border-color:#0f4c81;background:#eff6ff;color:#0f4c81;}
        .acct-btn.on.debito{border-color:#0f172a;background:#f1f5f9;color:#0f172a;}
        .acct-dot{width:7px;height:7px;border-radius:50%;}
        .receipt{border-radius:16px;padding:16px 18px;background:#fff;border:1.5px solid #e2e8f0;box-shadow:0 1px 3px rgba(15,23,42,.05);margin-bottom:16px;}
        .receipt-top{display:flex;align-items:center;gap:12px;}
        .receipt-ico{width:44px;height:44px;border-radius:13px;background:#fffbeb;border:1px solid #fde68a;display:flex;align-items:center;justify-content:center;font-size:19px;flex-shrink:0;}
        .receipt-desc{font-size:14.5px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:150px;}
        .receipt-cat{font-size:11px;color:#64748b;margin-top:2px;}
        .receipt-amt{margin-left:auto;text-align:right;flex-shrink:0;}
        .receipt-amt .serif{font-size:22px;font-weight:700;}
        .receipt-split{margin-top:12px;padding-top:12px;border-top:1px dashed #e2e8f0;display:flex;justify-content:space-between;font-size:12px;color:#64748b;}
        .receipt-split b{color:#b45309;font-weight:700;}
        .field{margin-bottom:12px;}
        .field label{display:block;font-size:10.5px;font-weight:700;letter-spacing:.6px;color:#94a3b8;text-transform:uppercase;margin-bottom:6px;}
        .row2{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
        .catgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;}
        .catchip{display:flex;flex-direction:column;align-items:center;gap:5px;border:1.5px solid #e2e8f0;border-radius:13px;padding:10px 4px;background:#fff;cursor:pointer;font-family:inherit;}
        .catchip .e{font-size:17px;}
        .catchip span{font-size:9.5px;font-weight:700;color:#64748b;text-align:center;}
        .catchip.on{border-color:#0f4c81;background:#eff6ff;}
        .catchip.on span{color:#0f4c81;}
        .save-btn{width:100%;margin-top:8px;padding:14px;border:none;border-radius:14px;background:linear-gradient(135deg,#0f4c81,#1e6ab0);color:#fff;font-family:inherit;font-size:14.5px;font-weight:700;cursor:pointer;box-shadow:0 10px 20px -10px rgba(15,76,129,.6);}

        /* ---- Me deben ---- */
        .medeben-banner{border-radius:18px;padding:18px 20px;color:#fff;margin-bottom:14px;background:linear-gradient(135deg,#b45309,#d97706);box-shadow:0 14px 26px -14px rgba(180,83,9,.5);display:flex;justify-content:space-between;align-items:flex-end;}
        .mb-label{font-size:10px;letter-spacing:2px;font-weight:700;opacity:.85;}
        .mb-total{font-size:30px;font-weight:700;line-height:1.1;margin-top:2px;}
        .mb-sub{font-size:11px;opacity:.85;margin-top:4px;}

        /* ---- Resumen chart ---- */
        .chart-card{margin-bottom:18px;border-radius:16px;padding:16px 16px 12px;background:#fff;border:1px solid #e2e8f0;box-shadow:0 1px 3px rgba(15,23,42,.05);}
        .chart-legend{display:flex;gap:14px;font-size:11px;color:#64748b;margin-bottom:8px;}
        .chart-legend .sw{width:8px;height:8px;border-radius:2px;display:inline-block;margin-right:4px;}

        /* ---- bottom tab bar ---- */
        .tabbar{position:fixed;left:50%;transform:translateX(-50%);bottom:0;width:100%;max-width:720px;background:#fff;border-top:1px solid #e2e8f0;display:flex;padding:8px 10px calc(8px + env(safe-area-inset-bottom));z-index:100;}
        .tab{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;background:none;border:none;font-family:inherit;cursor:pointer;color:#94a3b8;padding:6px 2px;}
        .tab.on{color:#0f4c81;}
        .tab .ticon{font-size:18px;line-height:1;}
        .tab span{font-size:9.5px;font-weight:700;white-space:nowrap;}
        .fab-tab{width:42px;height:42px;border-radius:14px;margin-top:-18px;background:linear-gradient(135deg,#0f4c81,#1e6ab0);display:flex;align-items:center;justify-content:center;color:#fff;box-shadow:0 8px 16px -6px rgba(15,76,129,.5);font-size:20px;font-weight:500;line-height:1;}
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

      {showCardsModal && (
        <div className="modal-overlay" onClick={()=>{setShowCardsModal(false); setEditingCardId(null);}}>
          <div className="modal" style={{maxWidth:420}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:11,letterSpacing:2,color:"#0f4c81",marginBottom:14,fontWeight:700}}>TARJETAS DE CREDITO</div>
            {cards.map(c => (
              <div key={c.id} className="rec-row">
                <span style={{width:14,height:14,borderRadius:"50%",background:c.color||"#0f4c81",flexShrink:0}}></span>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:600}}>{c.nombre}</div>
                  <div style={{fontSize:11,color:"#94a3b8"}}>Cierra el {c.cierreDay||"20"} · Paga el {c.dueDay||"17"}</div>
                </div>
                <button className="btn btn-g btn-sm" style={{padding:"6px 8px"}} onClick={()=>startEditCard(c)}>E</button>
                <button className="btn btn-d btn-sm" style={{padding:"6px 8px"}} onClick={()=>setConfirmDeleteCard(c)}>D</button>
              </div>
            ))}

            <form onSubmit={submitCardForm} style={{marginTop:16,paddingTop:16,borderTop:"1px solid #e2e8f0"}}>
              <div style={{fontSize:11,letterSpacing:1,color:"#94a3b8",marginBottom:10,fontWeight:700}}>{editingCardId?"EDITAR TARJETA":"AGREGAR TARJETA"}</div>
              <input className="inp" style={{marginBottom:8}} placeholder="Nombre (ej. Chase Freedom)" value={cardForm.nombre} onChange={e=>setCardForm(f=>({...f,nombre:e.target.value}))} required />
              <div style={{display:"flex",gap:8,marginBottom:8,alignItems:"center"}}>
                <input type="color" value={cardForm.color} onChange={e=>setCardForm(f=>({...f,color:e.target.value}))} style={{width:40,height:38,border:"1.5px solid #e2e8f0",borderRadius:8,padding:2,cursor:"pointer"}} />
                <input className="inp" type="number" min="1" max="31" placeholder="Dia de cierre" value={cardForm.cierreDay} onChange={e=>setCardForm(f=>({...f,cierreDay:e.target.value}))} />
                <input className="inp" type="number" min="1" max="31" placeholder="Dia de pago" value={cardForm.dueDay} onChange={e=>setCardForm(f=>({...f,dueDay:e.target.value}))} />
              </div>
              <div style={{display:"flex",gap:8}}>
                <button className="btn btn-p" style={{flex:1}} type="submit">{editingCardId?"Guardar cambios":"+ Agregar tarjeta"}</button>
                {editingCardId && <button className="btn btn-g" type="button" onClick={startAddCard}>Cancelar</button>}
              </div>
            </form>

            <button className="btn btn-g" style={{width:"100%",marginTop:16}} onClick={()=>{setShowCardsModal(false); setEditingCardId(null);}}>Cerrar</button>
          </div>
        </div>
      )}

      {confirmDeleteCard && (
        <div className="modal-overlay" onClick={()=>setConfirmDeleteCard(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:11,letterSpacing:2,color:"#dc2626",marginBottom:12,fontWeight:700}}>ELIMINAR TARJETA</div>
            <div style={{fontSize:16,marginBottom:4,fontWeight:600}}>{confirmDeleteCard.nombre}</div>
            <div style={{fontSize:13,color:"#64748b",marginBottom:20}}>Sus gastos ya registrados no se borran, solo desaparece de la lista de tarjetas.</div>
            <div style={{display:"flex",gap:8}}>
              <button className="btn btn-d" style={{flex:1}} onClick={doDeleteCard}>Eliminar</button>
              <button className="btn btn-g" onClick={()=>setConfirmDeleteCard(null)}>Cancelar</button>
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
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <div style={{fontSize:16,fontWeight:700,color:editId?"#0f4c81":"#0f172a"}}>{editId?"Editar gasto":"Nuevo gasto"}</div>
              <button className="btn btn-g btn-sm" onClick={cancelEdit}>X</button>
            </div>

            {!editId && (
              <div className="acct-toggle" style={{flexWrap:"wrap"}}>
                {cards.map(c => (
                  <button key={c.id} type="button" className={`acct-btn ${formAccount===c.id?"on":""}`}
                    style={formAccount===c.id ? {borderColor:c.color||"#0f4c81", background:"#eff6ff", color:c.color||"#0f4c81"} : undefined}
                    onClick={()=>setFormAccount(c.id)}>
                    <span className="acct-dot" style={{background:c.color||"#0f4c81"}}></span>{c.nombre}
                  </button>
                ))}
                <button type="button" className={`acct-btn debito ${formAccount==="debit"?"on":""}`} onClick={()=>setFormAccount("debit")}>
                  <span className="acct-dot" style={{background:"#0f172a"}}></span>Debito
                </button>
              </div>
            )}

            <div className="receipt">
              <div className="receipt-top">
                <div className="receipt-ico">{form.category ? (CAT_EMOJI[form.category]||"📦") : "🧾"}</div>
                <div>
                  <div className="receipt-desc">{form.desc || "Descripcion"}</div>
                  <div className="receipt-cat">{form.category || "Sin categoria"}</div>
                </div>
                <div className="receipt-amt"><div className="serif">{fmt(form.amount)}</div></div>
              </div>
              {showOwed && form.owed.some(p=>p.value) && (
                <div className="receipt-split">
                  <span>{form.owed.filter(p=>p.value).map(p=>p.name||"Alguien").join(", ")} debe</span>
                  <b>{fmt(owedTotalFromForm())}</b>
                </div>
              )}
            </div>

            <form onSubmit={submitForm}>
              <div className="row2" style={{marginBottom:12}}>
                <div className="field" style={{marginBottom:0}}>
                  <label>Descripcion</label>
                  <input ref={descRef} className="inp" placeholder="ej. Chick fil a" value={form.desc}
                    onChange={e=>{
                      const val = e.target.value;
                      setForm(f=>{
                        const suggested = categoryByName[val.trim().toLowerCase()];
                        return {...f, desc: val, category: (suggested && !f.category) ? suggested : f.category};
                      });
                    }} required />
                </div>
                <div className="field" style={{marginBottom:0}}>
                  <label>Monto</label>
                  <input className="inp" type="number" placeholder="0.00" value={form.amount}
                    min="0.01" step="0.01" onChange={e=>setForm(f=>({...f,amount:e.target.value}))} required />
                </div>
              </div>

              <div className="field">
                <label>Fecha</label>
                <input className="inp" type="date" value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))} />
              </div>

              <div className="field">
                <label>Categoria</label>
                <div className="catgrid">
                  {CATEGORIES.map(c=>(
                    <button key={c} type="button" className={`catchip ${form.category===c?"on":""}`} onClick={()=>setForm(f=>({...f,category:c}))}>
                      <span className="e">{CAT_EMOJI[c]}</span><span>{c}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="field">
                <input className="inp" placeholder="Nota (opcional)" value={form.note}
                  onChange={e=>setForm(f=>({...f,note:e.target.value}))} />
              </div>

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
                    {knownPeople.length > 0 && (
                      <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
                        {knownPeople.map(name=>(
                          <span key={name} style={{display:"inline-flex",alignItems:"center",gap:2,background:"#fff",border:"1.5px solid #e2e8f0",borderRadius:20,paddingLeft:10}}>
                            <button type="button" onClick={()=>pickKnownPerson(name)}
                              style={{background:"none",border:"none",cursor:"pointer",fontSize:11,fontWeight:600,color:"#374151",padding:"5px 0"}}>{name}</button>
                            <button type="button" onClick={()=>dismissKnownPerson(name)} title="Quitar sugerencia"
                              style={{background:"#f1f5f9",border:"none",borderRadius:"50%",width:18,height:18,margin:"0 5px",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:11,color:"#94a3b8",padding:0,flexShrink:0}}>×</button>
                          </span>
                        ))}
                      </div>
                    )}
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
                      <button type="button" className="btn btn-g btn-sm" onClick={addPerson} style={{fontSize:11}}>+ agregar otro</button>
                    )}
                  </div>
                )}
              </div>

              <button type="submit" className="save-btn">{editId?"Guardar cambios":"Agregar gasto"}</button>
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
              <button type="submit" className="save-btn">{editRecId?"Guardar cambios":"Agregar gasto fijo"}</button>
            </form>
          </div>
        </div>
      )}

      <div style={{background:"#fff",borderBottom:"1px solid #e2e8f0",padding:"0 20px"}}>
        <div style={{maxWidth:720,margin:"0 auto",display:"flex",alignItems:"center",justifyContent:"space-between",height:58}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:34,height:34,background:"linear-gradient(135deg,#0f4c81,#1e6ab0)",borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 2px 8px rgba(15,76,129,.3)"}}>
              <span style={{color:"#fff",fontSize:16,fontWeight:700}}>B</span>
            </div>
            <div>
              <div style={{fontFamily:"'Playfair Display',serif",fontSize:18,fontWeight:700,letterSpacing:-.3,lineHeight:1}}>Bolsillo</div>
              <div style={{fontSize:9,color:"#94a3b8",letterSpacing:1.5,fontWeight:600}}>{cards.length} TARJETA{cards.length!==1?"S":""} · DEBITO</div>
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
            <button className="btn btn-g btn-sm" onClick={logout} title="Cerrar sesión">Salir</button>
          </div>
        </div>
      </div>

      <div style={{maxWidth:720,margin:"0 auto",padding:"20px 16px 96px"}}>

        {tab==="list" && <>
          <div className="card-stack">
            <div className={`stack-card ${activeCard==="debit"?"front":"back"}`}
              style={{background:"linear-gradient(135deg,#1e293b,#0f172a)"}}
              onClick={()=>setActiveCard("debit")}>
              <div className="card-row1">
                <div><div className="card-brand">DEBITO · EFECTIVO</div><div className="card-chip"></div></div>
                <div className="card-dots">•••</div>
              </div>
              <div className="card-row2">
                <div>
                  <div className="card-label">SIN CICLO</div>
                  <div className="card-value">Se paga al momento</div>
                </div>
                <div className="card-total">
                  <div className="card-label">TOTAL DEBITO</div>
                  <div className="serif">{fmt(debitTotal)}</div>
                </div>
              </div>
            </div>
            <div className={`stack-card ${activeCard!=="debit"?"front":"back"}`}
              style={{background: activeCardObj?.color
                ? `linear-gradient(135deg,${cycle.isUrgent?"#dc2626,#b91c1c":`${activeCardObj.color},${activeCardObj.color}`})`
                : `linear-gradient(135deg,${cycle.isUrgent?"#dc2626,#b91c1c":"#0f4c81,#1e6ab0"})`}}
              onClick={()=>setActiveCard(lastCreditCardRef.current || cards[0]?.id || "discover")}>
              <div className="card-row1">
                <div><div className="card-brand">{(activeCardObj?.nombre || "TARJETA").toUpperCase()}</div><div className="card-chip"></div></div>
                <div className="card-dots">•••</div>
              </div>
              <div className="card-row2">
                <div>
                  <div className="card-label">CICLO CIERRA</div>
                  <div className="card-value">{cycle.end}</div>
                  {cycle.daysUntilDue <= 10 && (
                    <div className="due-pill">Vence {cycle.due} · {cycle.daysUntilDue<=0?"VENCIDO":cycle.daysUntilDue===1?"Manana":`${cycle.daysUntilDue}d`}</div>
                  )}
                </div>
                <div className="card-total">
                  <div className="card-label">TOTAL CICLO</div>
                  <div className="serif">{fmt(cycleTotal)}</div>
                </div>
              </div>
            </div>
          </div>
          <div className="stack-hint">Toca la tarjeta de atras para cambiar a <b>{activeCard!=="debit"?"Debito":(activeCardObj?.nombre||"tu tarjeta")}</b></div>

          <div style={{display:"flex",gap:8,overflowX:"auto",padding:"2px 2px 12px"}}>
            {cards.map(c => (
              <button key={c.id} className="tog" style={{flexShrink:0, background: activeCard===c.id ? (c.color||"#0f4c81") : "#f1f5f9", color: activeCard===c.id ? "#fff" : "#64748b"}}
                onClick={()=>setActiveCard(c.id)}>
                {c.nombre}
              </button>
            ))}
            <button className="tog" style={{flexShrink:0}} onClick={()=>setShowCardsModal(true)}>⚙️ Tarjetas</button>
          </div>

          <div className="quick">
            <button className="qbtn" onClick={()=>startAdd(activeCard)}><span className="qicon">➕</span><span>Agregar</span></button>
            <button className="qbtn" onClick={()=>setTab("medeben")}><span className="qicon">🤝</span><span>Me deben</span></button>
            <button className="qbtn" onClick={()=>shareSelected(meDeben)}><span className="qicon">📤</span><span>Compartir</span></button>
            <button className="qbtn" onClick={loadAll}><span className="qicon">🔄</span><span>Sync</span></button>
          </div>

          {activeCard!=="debit" && (
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,margin:"16px 0"}}>
              <div className="stat blue" style={{padding:"10px 12px"}}>
                <div className="stat-label">POR INGRESAR</div>
                <div className="stat-value" style={{fontSize:15}}>{fmt(cyclePending)}</div>
              </div>
              <div className="stat amber" style={{padding:"10px 12px"}}>
                <div className="stat-label">ME DEBEN</div>
                <div className="stat-value" style={{fontSize:15}}>{fmt(totalOwed)}</div>
              </div>
              <div className="stat green" style={{padding:"10px 12px"}}>
                <div className="stat-label">NETO</div>
                <div className="stat-value" style={{fontSize:15}}>{fmt(netCost)}</div>
              </div>
            </div>
          )}

          {activeCard!=="debit" ? (
            <>
              <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:12,flexWrap:"wrap"}}>
                <div style={{display:"flex",background:"#e2e8f0",borderRadius:20,padding:"3px",gap:2}}>
                  {[["all","Todos"],["pending","Pendientes"],["added","Ingresados"]].map(([v,l])=>(
                    <button key={v} className={`tog ${filter===v?"on":""}`} style={{padding:"6px 12px",fontSize:11}} onClick={()=>setFilter(v)}>{l}</button>
                  ))}
                </div>
                {availableMonths.length > 1 && (
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
                <span style={{marginLeft:"auto",fontSize:11,color:"#94a3b8",fontWeight:500}}>{filtered.length} · {fmt(filteredTotal)}</span>
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

              <div style={{display:"flex",gap:12,marginBottom:6,fontSize:11,color:"#94a3b8",fontWeight:500}}>
                <div style={{display:"flex",alignItems:"center",gap:5}}>
                  <div className="chk blue on" style={{width:16,height:16}}><span style={{fontSize:9,color:"#fff",fontWeight:800}}>v</span></div>
                  Ingresado
                </div>
                <div style={{display:"flex",alignItems:"center",gap:5}}>
                  <div className="chk green on" style={{width:16,height:16}}><span style={{fontSize:9,color:"#fff",fontWeight:800}}>v</span></div>
                  Pagado
                </div>
              </div>

              {loading ? (
                <div className="empty-state">Cargando...</div>
              ) : <>
                {filtered.length===0 && <div className="empty-state">Sin gastos aqui.</div>}
                {filteredGroups.map(group => (
                  <div key={group.date}>
                    <div className="day-head"><span>{dayHeaderLabel(group.date)}</span><span>{fmt(group.total)}</span></div>
                    {group.items.map(ex => ExpenseRow(ex, {showAdded:true}))}
                  </div>
                ))}
                {cardExpenses.some(e=>!e.added) && (
                  <button className="btn btn-g" style={{width:"100%",marginTop:14,borderStyle:"dashed",fontSize:12,padding:"13px"}}
                    onClick={markAllAdded}>
                    Marcar todos como ingresados ({fmt(cardExpenses.filter(e=>!e.added).reduce((s,e)=>s+e.amount,0))})
                  </button>
                )}
              </>}
            </>
          ) : (
            loading ? (
              <div className="empty-state">Cargando...</div>
            ) : <>
              {debitExpenses.length===0 && <div className="empty-state">Sin gastos de debito aun.</div>}
              {debitGroups.map(group => (
                <div key={group.date}>
                  <div className="day-head"><span>{dayHeaderLabel(group.date)}</span><span>{fmt(group.total)}</span></div>
                  {group.items.map(ex => ExpenseRow(ex, {showAdded:false}))}
                </div>
              ))}
              <div style={{marginTop:14,padding:"10px 12px",borderRadius:12,background:"#f1f5f9",fontSize:11,color:"#64748b",lineHeight:1.5,border:"1px dashed #e2e8f0"}}>
                Debito no cuenta para el ciclo de Discover ni para Resumen — pero si suma en "Me deben".
              </div>
            </>
          )}
        </>}

        {tab==="medeben" && (
          <div>
            <div className="medeben-banner">
              <div>
                <div className="mb-label">TOTAL POR COBRAR</div>
                <div className="serif mb-total">{fmt(meDebenTotal)}</div>
                <div className="mb-sub">{meDeben.length} gastos</div>
              </div>
              {meDeben.length>0 && (
                <button className="btn" style={{background:"rgba(255,255,255,.2)",color:"#fff",border:"1.5px solid rgba(255,255,255,.4)",fontSize:12,padding:"10px 16px"}}
                  onClick={()=>setConfirmBulkPaid(true)}>
                  Marcar todos pagados
                </button>
              )}
            </div>

            {meDeben.length>0 && (
              <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginBottom:8}}>
                {!selectMode && (
                  <button className="btn btn-g btn-sm" onClick={()=>shareSelected(meDeben)}>Compartir todos</button>
                )}
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

            {meDeben.length===0 ? (
              <div className="empty-state">Nadie te debe nada.</div>
            ) : (
              meDebenGroups.map(group => (
                <div key={group.date}>
                  <div className="day-head">
                    <span>{dayHeaderLabel(group.date)}</span>
                    <span style={{color:"#b45309"}}>{fmt(group.items.reduce((s,e)=>s+owedForExp(e),0))}</span>
                  </div>
                  {group.items.map(ex => ExpenseRow(ex, {showAdded:false, selectable:true, showSource:true}))}
                </div>
              ))
            )}
          </div>
        )}

        {tab==="recurring" && (
          <div>
            <div style={{fontSize:12,color:"#64748b",marginBottom:16,lineHeight:1.5}}>
              Toca el <strong>+</strong> para agregar el cargo al listado de pendientes con la fecha de hoy.
            </div>
            {recurring.length===0 && !loading && (
              <div className="empty-state" style={{padding:"40px 0"}}>Sin gastos fijos aun.</div>
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
            {months.length===0 && <div className="empty-state">Sin gastos para resumir.</div>}

            {chartData.length>1 && (
              <div className="chart-card">
                <div className="chart-legend">
                  <span><span className="sw" style={{background:"#0f4c81"}}></span>Gastos</span>
                  <span><span className="sw" style={{background:"#b45309"}}></span>Me deben</span>
                </div>
                <svg viewBox="0 0 320 150" width="100%" height="150">
                  <line x1="30" y1="10" x2="30" y2="118" stroke="#e2e8f0" strokeWidth="1"/>
                  <line x1="30" y1="118" x2="312" y2="118" stroke="#e2e8f0" strokeWidth="1"/>
                  <text x="4" y="14" fontSize="8" fill="#94a3b8">{fmt(chartMax).replace(/\.00$/,"")}</text>
                  <text x="12" y="121" fontSize="8" fill="#94a3b8">$0</text>
                  {chartData.map((d,i) => {
                    const groupW = 282/chartData.length;
                    const gx = 30 + i*groupW;
                    const barW = Math.min(14, groupW/2 - 4);
                    const h1 = chartMax>0 ? (d.total/chartMax)*100 : 0;
                    const h2 = chartMax>0 ? (d.owed/chartMax)*100 : 0;
                    const isCurrent = d.month === getMonth(today());
                    return (
                      <g key={d.month}>
                        <rect x={gx+groupW/2-barW-2} y={118-h1} width={barW} height={h1} rx="2" fill="#0f4c81"/>
                        <rect x={gx+groupW/2+2} y={118-h2} width={barW} height={h2} rx="2" fill="#b45309"/>
                        <text x={gx+groupW/2} y="130" fontSize="8" fill={isCurrent?"#0f172a":"#94a3b8"} fontWeight={isCurrent?700:400} textAnchor="middle">
                          {monthLabel(d.month).slice(0,3)}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>
            )}

            {months.map((month, monthIdx) => {
              const monthExps = cardExpenses.filter(e=>getMonth(e.date)===month);
              const total = monthExps.reduce((s,e)=>s+e.amount,0);
              const pending = monthExps.filter(e=>!e.added).reduce((s,e)=>s+e.amount,0);
              const owedTotal = monthExps.reduce((s,e)=>s+owedForExp(e),0);
              const net = total - owedTotal;
              const prevMonth = months[monthIdx + 1];
              const prevTotal = prevMonth ? cardExpenses.filter(e=>getMonth(e.date)===prevMonth).reduce((s,e)=>s+e.amount,0) : 0;
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

      <div className="tabbar">
        <button className={`tab ${tab==="list"?"on":""}`} onClick={()=>setTab("list")}>
          <span className="ticon">🏠</span><span>Inicio</span>
        </button>
        <button className={`tab ${tab==="medeben"?"on":""}`} onClick={()=>setTab("medeben")}>
          <span className="ticon">🤝</span><span>{meDeben.length>0?`Me deben (${meDeben.length})`:"Me deben"}</span>
        </button>
        <button className="qbtn" style={{width:"auto",flex:1}} onClick={()=>startAdd(activeCard)}>
          <span className="fab-tab">+</span>
        </button>
        <button className={`tab ${tab==="recurring"?"on":""}`} onClick={()=>setTab("recurring")}>
          <span className="ticon">📅</span><span>Fijos</span>
        </button>
        <button className={`tab ${tab==="summary"?"on":""}`} onClick={()=>setTab("summary")}>
          <span className="ticon">📊</span><span>Resumen</span>
        </button>
      </div>

      {toast && <div className={`toast ${toast.type==="warn"?"twarn":"tok"}`}>{toast.msg}</div>}
    </div>
  );
}

async function authApi(action, extra={}) {
  const res = await fetch("/api/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...extra }),
  });
  const data = await res.json().catch(()=>({}));
  if (!res.ok) throw new Error(data.error || `${action} failed`);
  return data;
}

const LG_STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');
  .lg-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f1f5f9;font-family:'DM Sans','Helvetica Neue',sans-serif;padding:20px;}
  .lg-wrap *{box-sizing:border-box;}
  .lg-card{background:#fff;border-radius:20px;padding:32px 26px;width:100%;max-width:360px;box-shadow:0 1px 4px rgba(0,0,0,.06);text-align:center;}
  .lg-title{font-size:22px;font-weight:700;color:#0f172a;margin-bottom:22px;}
  .lg-btn{cursor:pointer;border:none;font-family:inherit;font-size:14px;border-radius:12px;padding:13px 16px;font-weight:600;width:100%;margin-bottom:10px;transition:all .15s;}
  .lg-btn:disabled{opacity:.5;cursor:default;}
  .lg-btn-p{background:#0f4c81;color:#fff;}
  .lg-btn-p:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 4px 12px rgba(15,76,129,.25);}
  .lg-btn-g{background:#fff;color:#64748b;border:1.5px solid #e2e8f0;}
  .lg-input{background:#fff;border:1.5px solid #e2e8f0;color:#0f172a;padding:12px 14px;border-radius:10px;font-family:inherit;font-size:14px;width:100%;margin-bottom:10px;outline:none;}
  .lg-input:focus{border-color:#0f4c81;}
  .lg-link{background:none;border:none;color:#94a3b8;font-family:inherit;font-size:12.5px;cursor:pointer;margin-top:6px;text-decoration:underline;}
  .lg-error{color:#dc2626;font-size:12.5px;margin:-2px 0 10px;}
`;

function LoginGate({ onLogin }) {
  const [mode, setMode] = useState("login"); // "login" | "password" | "setup"
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [passkeySupported, setPasskeySupported] = useState(true);
  const [pwUser, setPwUser] = useState("");
  const [pwPass, setPwPass] = useState("");
  const [setupName, setSetupName] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [setupPass, setSetupPass] = useState("");

  useEffect(() => {
    if (typeof window === "undefined" || !window.PublicKeyCredential) { setPasskeySupported(false); return; }
    if (PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) {
      PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
        .then(setPasskeySupported).catch(()=>setPasskeySupported(false));
    }
  }, []);

  async function handlePasskeyLogin(intent = "dashboard") {
    setBusy(true); setError("");
    try {
      const { startAuthentication } = await import("@simplewebauthn/browser");
      const { options, challengeToken } = await authApi("passkey-login-options");
      const assertionResponse = await startAuthentication({ optionsJSON: options });
      const { token, userLabel } = await authApi("passkey-login-verify", { challengeToken, assertionResponse });
      onLogin(token, userLabel, intent);
    } catch (err) {
      setError(err.name === "NotAllowedError" ? "Cancelado o no reconocido" : (err.message || "No se pudo entrar"));
    } finally { setBusy(false); }
  }

  async function handlePasswordLogin(e) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const { token, userLabel } = await authApi("password-login", { userLabel: pwUser.trim(), password: pwPass });
      onLogin(token, userLabel);
    } catch (err) { setError(err.message === "invalid_credentials" ? "Nombre o contraseña incorrectos" : (err.message || "No se pudo entrar")); }
    finally { setBusy(false); }
  }

  async function handleSetupPasskey() {
    setBusy(true); setError("");
    try {
      const { startRegistration } = await import("@simplewebauthn/browser");
      const { options, challengeToken } = await authApi("passkey-register-options", { setupCode, userLabel: setupName.trim() });
      const attestationResponse = await startRegistration({ optionsJSON: options });
      const { token, userLabel } = await authApi("passkey-register-verify", { challengeToken, attestationResponse });
      onLogin(token, userLabel);
    } catch (err) {
      setError(err.name === "NotAllowedError" ? "Cancelado" : (err.message === "invalid_setup_code" ? "Código incorrecto" : (err.message || "No se pudo registrar")));
    } finally { setBusy(false); }
  }

  async function handleSetupPassword(e) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const { token, userLabel } = await authApi("password-set", { setupCode, userLabel: setupName.trim(), password: setupPass });
      onLogin(token, userLabel);
    } catch (err) {
      setError(err.message === "invalid_setup_code" ? "Código incorrecto" : (err.message || "No se pudo guardar"));
    } finally { setBusy(false); }
  }

  return (
    <div className="lg-wrap">
      <style>{LG_STYLES}</style>
      <div className="lg-card">
        <div className="lg-title">Bolsillo 🔒</div>
        {mode === "login" && (
          <>
            {passkeySupported && (
              <button className="lg-btn lg-btn-p" disabled={busy} onClick={() => handlePasskeyLogin("dashboard")}>
                {busy ? "..." : "🔐 Entrar con Face ID / Touch ID"}
              </button>
            )}
            {passkeySupported && (
              <button className="lg-btn lg-btn-g" disabled={busy} onClick={() => handlePasskeyLogin("quickadd")}>
                {busy ? "..." : "➕ Agregar gasto rápido"}
              </button>
            )}
            <button className="lg-btn lg-btn-g" disabled={busy} onClick={() => { setMode("password"); setError(""); }}>
              Usar contraseña
            </button>
            {error && <p className="lg-error">{error}</p>}
            <button className="lg-link" onClick={() => { setMode("setup"); setError(""); }}>Configurar este dispositivo</button>
          </>
        )}
        {mode === "password" && (
          <form onSubmit={handlePasswordLogin}>
            <input className="lg-input" placeholder="Tu nombre" value={pwUser} onChange={e=>setPwUser(e.target.value)} required />
            <input className="lg-input" type="password" placeholder="Contraseña" value={pwPass} onChange={e=>setPwPass(e.target.value)} required />
            {error && <p className="lg-error">{error}</p>}
            <button className="lg-btn lg-btn-p" type="submit" disabled={busy}>{busy ? "..." : "Entrar"}</button>
            <button className="lg-link" type="button" onClick={()=>{ setMode("login"); setError(""); }}>Volver</button>
          </form>
        )}
        {mode === "setup" && (
          <div>
            <input className="lg-input" placeholder="Tu nombre" value={setupName} onChange={e=>setSetupName(e.target.value)} />
            <input className="lg-input" placeholder="Código de configuración" value={setupCode} onChange={e=>setSetupCode(e.target.value)} />
            {passkeySupported && (
              <button className="lg-btn lg-btn-p" disabled={busy || !setupName.trim() || !setupCode} onClick={handleSetupPasskey}>
                {busy ? "..." : "🔐 Registrar Face ID / Touch ID"}
              </button>
            )}
            <form onSubmit={handleSetupPassword}>
              <input className="lg-input" type="password" placeholder="Contraseña (respaldo, min. 6)" value={setupPass} onChange={e=>setSetupPass(e.target.value)} />
              <button className="lg-btn lg-btn-g" type="submit" disabled={busy || !setupName.trim() || !setupCode || setupPass.length<6}>
                {busy ? "..." : "Guardar contraseña"}
              </button>
            </form>
            {error && <p className="lg-error">{error}</p>}
            <button className="lg-link" onClick={() => { setMode("login"); setError(""); }}>Volver</button>
          </div>
        )}
      </div>
    </div>
  );
}

// A quicker path than the full dashboard: log one expense and get out.
// Reuses the same api helpers as the main app, just without loadAll's fetch
// of every existing row first.
function QuickAdd({ onDone }) {
  const [cards, setCards] = useState([]);
  const [account, setAccount] = useState("");
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today());
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    cardsList().then(rows => {
      setCards(rows);
      if (rows.length) setAccount(a => a || rows[0].id);
    }).catch(() => {});
  }, []);

  function reset() {
    setDesc(""); setAmount(""); setCategory(""); setDate(today()); setSaved(false); setError("");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      await apiFor(account).append({ desc, amount, date, category, owed: [] });
      setSaved(true);
    } catch {
      setError("No se pudo guardar. Intenta de nuevo.");
    } finally { setBusy(false); }
  }

  return (
    <div className="lg-wrap">
      <style>{LG_STYLES}</style>
      <div className="lg-card">
        <div className="lg-title">➕ Gasto rápido</div>
        {saved ? (
          <>
            <p style={{color:"#059669",fontWeight:600,marginBottom:16}}>✅ Guardado</p>
            <button className="lg-btn lg-btn-p" onClick={reset}>Agregar otro</button>
            <button className="lg-btn lg-btn-g" onClick={onDone}>Ir al dashboard</button>
            <button className="lg-link" onClick={logout}>Salir</button>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            {cards.map(c => (
              <button key={c.id} type="button" className={`lg-btn ${account===c.id?"lg-btn-p":"lg-btn-g"}`} style={{marginBottom:4}} onClick={()=>setAccount(c.id)}>💳 {c.nombre}</button>
            ))}
            <button type="button" className={`lg-btn ${account==="debit"?"lg-btn-p":"lg-btn-g"}`} onClick={()=>setAccount("debit")}>🏦 Debito</button>
            <input className="lg-input" placeholder="Descripción" value={desc} onChange={e=>setDesc(e.target.value)} required />
            <input className="lg-input" type="number" step="0.01" inputMode="decimal" placeholder="Monto" value={amount} onChange={e=>setAmount(e.target.value)} required />
            <input className="lg-input" type="date" value={date} onChange={e=>setDate(e.target.value)} required />
            <select className="lg-input" value={category} onChange={e=>setCategory(e.target.value)}>
              <option value="">Categoría (opcional)</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{catDisplay(c)}</option>)}
            </select>
            {error && <p className="lg-error">{error}</p>}
            <button className="lg-btn lg-btn-p" type="submit" disabled={busy}>{busy ? "..." : "Guardar"}</button>
            <button className="lg-link" type="button" onClick={onDone}>Ir al dashboard</button>
          </form>
        )}
      </div>
    </div>
  );
}

// Bumping this is a one-line change if 2 minutes ever feels too tight.
const IDLE_TIMEOUT_MS = 2 * 60 * 1000;

export default function AppRoot() {
  const [token, setToken] = useState(() => getSessionToken());
  const [intent, setIntent] = useState("dashboard"); // "dashboard" | "quickadd"

  useEffect(() => {
    onUnauthorized(() => setToken(null));
  }, []);

  // Auto-logout after IDLE_TIMEOUT_MS of no taps/clicks/keys/scrolls. Also
  // checks immediately when the tab regains focus, since a backgrounded
  // mobile tab can have its timers paused while the screen was locked.
  useEffect(() => {
    if (!token) return;
    let lastActive = Date.now();
    const markActive = () => { lastActive = Date.now(); };
    const events = ["click", "touchstart", "keydown", "scroll"];
    events.forEach(e => window.addEventListener(e, markActive, { passive: true }));
    const checkIdle = () => { if (Date.now() - lastActive > IDLE_TIMEOUT_MS) logout(); };
    const interval = setInterval(checkIdle, 15000);
    const onVisibility = () => { if (document.visibilityState === "visible") checkIdle(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      events.forEach(e => window.removeEventListener(e, markActive));
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [token]);

  function handleLogin(newToken, userLabel, loginIntent = "dashboard") {
    setSessionToken(newToken);
    setToken(newToken);
    setIntent(loginIntent);
  }

  if (!token) return <LoginGate onLogin={handleLogin} />;
  if (intent === "quickadd") return <QuickAdd key={token} onDone={() => setIntent("dashboard")} />;
  return <App key={token} />;
}
