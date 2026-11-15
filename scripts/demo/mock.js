// Servidor de ejemplo: responde a /api/* con datos inventados, en memoria. Nada sale del navegador.
(function () {
  try { localStorage.setItem("bolsillo_session", "demo"); } catch (e) {}
  try { if (!localStorage.getItem("bolsillo_default_card")) localStorage.setItem("bolsillo_default_card", "chase-a1xa"); } catch (e) {}

  var pad = function (n) { return String(n).padStart(2, "0"); };
  var ymd = function (d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
  var ago = function (n) { var d = new Date(); d.setDate(d.getDate() - n); return ymd(d); };
  var seq = 1000;

  var cards = [
    { id: "discover", nombre: "Discover", color: "#ea580c", sheetTab: "Credit Card", cierreDay: "20", dueDay: "17" },
    { id: "chase-a1xa", nombre: "Chase", color: "#1d4ed8", sheetTab: "Tarjeta Chase", cierreDay: "17", dueDay: "20" }
  ];

  // [dias atras, descripcion, monto, categoria, registro, deben, agregado, pagado]
  var chase = [
    [0, "Publix", 96.40, "Super", "Omar", "Shelsy: $48.20", "NO", "NO"],
    [1, "Shell", 42.00, "Gas", "Shelsy", "Omar: $21.00", "NO", "NO"],
    [4, "Starbucks Coffee", 12.95, "Comida", "Shelsy", "", "NO", "NO"],
    [4, "Island Ice", 11.18, "Comida", "Omar", "", "NO", "NO"],
    [6, "Cinemark", 34.50, "Ocio", "Omar", "Shelsy: $17.25", "NO", "NO"],
    [9, "Walgreens", 23.14, "Salud", "Shelsy", "", "SI", "NO"],
    [11, "Amazon", 58.99, "Compras", "", "", "SI", "NO"],
    [13, "Pollo Tropical", 27.80, "Comida", "Omar", "", "SI", "NO"],
    [15, "Publix", 112.37, "Super", "Shelsy", "", "SI", "NO"],
    [18, "Uber", 18.60, "Otro", "Omar", "", "SI", "NO"],
    [21, "Texaco", 39.25, "Gas", "", "", "SI", "NO"],
    [24, "Target", 64.12, "Compras", "Shelsy", "", "SI", "NO"],
    [27, "Café Don Pablo", 15.40, "Comida", "Omar", "Mamá: $15.40", "SI", "NO"],
    [30, "Publix", 101.88, "Super", "", "", "SI", "NO"]
  ];
  var discover = [
    [2, "Netflix", 15.49, "Gastos fijos", "Omar", "", "NO", "NO"],
    [3, "Costco", 143.26, "Super", "Shelsy", "", "NO", "NO"],
    [7, "Spotify", 11.99, "Gastos fijos", "", "", "SI", "NO"],
    [8, "Chick-fil-A", 21.35, "Comida", "Omar", "", "SI", "NO"],
    [10, "CVS", 17.90, "Salud", "Shelsy", "", "SI", "NO"],
    [14, "Home Depot", 78.40, "Compras", "", "", "SI", "NO"],
    [17, "Shell", 44.10, "Gas", "Omar", "", "SI", "NO"],
    [20, "Publix", 88.65, "Super", "Shelsy", "", "SI", "NO"],
    [23, "Restaurante El Mesón", 96.00, "Comida", "Omar", "Shelsy: $48.00, Mamá: $24.00", "SI", "NO"],
    [26, "Disney+", 13.99, "Gastos fijos", "Shelsy", "", "SI", "NO"],
    [33, "Delta Airlines", 286.40, "Viaje", "Omar", "", "SI", "NO"]
  ];
  var toRows = function (list) {
    return list.map(function (r) {
      return { id: String(++seq), date: ago(r[0]), desc: r[1], amount: r[2], category: r[3], note: "", owed: r[5], added: r[6], paid: r[7], registradoPor: r[4] };
    });
  };
  var sheets = { "chase-a1xa": toRows(chase), discover: toRows(discover) };

  // Pagos de ejemplo hechos a las tarjetas (dentro del ciclo de cada una).
  var pagos = [
    { id: "pay-1", cardId: "discover", date: ago(1), amount: 200, note: "Pago parcial", by: "Omar" },
    { id: "pay-2", cardId: "chase-a1xa", date: ago(2), amount: 100, note: "", by: "Shelsy" }
  ];
  var recurring = [
    { id: "r1", name: "Netflix", amount: 15.49, day: "12" },
    { id: "r2", name: "Spotify", amount: 11.99, day: "3" },
    { id: "r3", name: "Gimnasio", amount: 39, day: "1" }
  ];
  var rules = [
    { id: "rule1", cardId: "chase-a1xa", categoria: "Comida", tasa: "3", fechaInicio: "", fechaFin: "", tope: "", requiereActivacion: false, periodo: "", grupo: "" },
    { id: "rule2", cardId: "chase-a1xa", categoria: "Viaje", tasa: "5", fechaInicio: "", fechaFin: "", tope: "", requiereActivacion: false, periodo: "", grupo: "" },
    { id: "rule3", cardId: "discover", categoria: "Gas", tasa: "5", fechaInicio: ago(20), fechaFin: ago(-70), tope: "1500", requiereActivacion: true, periodo: "trimestre", grupo: "" }
  ];

  var anchor = ago(((new Date().getDay() + 2) % 7));
  var budget = {
    lines: [
      ["ppto-1", "esencial", "Renta", 14400, [], 1], ["ppto-2", "esencial", "Phone", 1200, [], 2],
      ["ppto-3", "esencial", "Groceries", 6600, ["Super"], 3], ["ppto-4", "esencial", "Gasolina", 2400, ["Gas"], 4],
      ["ppto-5", "esencial", "Seguro médico", 1800, ["Salud"], 5], ["ppto-6", "esencial", "Servicios del hogar", 2400, [], 6],
      ["ppto-7", "no_esencial", "Comida afuera", 6000, ["Comida"], 7], ["ppto-8", "no_esencial", "Entretenimiento", 6000, ["Ocio", "Compras", "Otro"], 8],
      ["ppto-9", "no_esencial", "Suscripciones", 1200, ["Gastos fijos"], 9], ["ppto-10", "no_esencial", "Gym", 1500, [], 10],
      ["ppto-11", "ahorro", "Ahorro (HYSA)", 36000, [], 11], ["ppto-12", "ahorro", "Vacaciones", 3600, ["Viaje"], 12]
    ].map(function (l) { return { rowNum: l[5] + 1, id: l[0], grupo: l[1], nombre: l[2], anual: l[3], categorias: l[4], nota: "", orden: l[5], createdAt: "", fijo: ["ppto-1", "ppto-2", "ppto-5", "ppto-9", "ppto-10"].indexOf(l[0]) >= 0 }; }),
    config: { sueldoNetoAnual: 96000, anclaPago: anchor, titulo: "Presupuesto de ejemplo", fondoMeses: 3 },
    ingresos: [
      { id: "ing-1", nombre: "Omar", bruto: 78000, neto: 58000, orden: 1 },
      { id: "ing-2", nombre: "Shelsy", bruto: 60000, neto: 38000, orden: 2 }
    ]
  };

  var plaid = {
    configured: true,
    items: [{ itemId: "item-chase", institution: "Chase", createdAt: ago(60), error: "" }],
    accounts: [{ accountId: "acc-chase-1", itemId: "item-chase", name: "Sapphire Preferred", mask: "5748", subtype: "credit card", cardId: "chase-a1xa", institution: "Chase" }],
    inbox: [
      { txId: "tx1", accountId: "card:chase-a1xa", date: ago(0), amount: 18.45, name: "Dunkin", category: "Comida", status: "review", pending: true, prevAmount: null, ajuste: "", transfer: false, applepay: true, usuario: "Shelsy", cardSource: "defecto" },
      { txId: "tx2", accountId: "card:chase-a1xa", date: ago(0), amount: 52.30, name: "Walmart", category: "Compras", status: "review", pending: true, prevAmount: null, ajuste: "", transfer: false, applepay: true, usuario: "Omar", cardSource: "wallet" },
      { txId: "tx3", accountId: "acc-chase-1", date: ago(1), amount: 31.07, name: "Publix", category: "Super", status: "review", pending: false, prevAmount: null, ajuste: "", transfer: false, applepay: false, usuario: "", cardSource: "" }
    ]
  };

  var admin = {
    legacyKey: { owner: "Omar", hint: "7f3a" },
    users: [
      { userLabel: "Omar", rol: "admin", estado: "activo", creado: ago(70), ultimoAcceso: ago(0), devices: 2, password: true, appleKey: null },
      { userLabel: "Shelsy", rol: "usuario", estado: "activo", creado: ago(14), ultimoAcceso: ago(0), devices: 1, password: true, appleKey: { hint: "c91e", creada: ago(12) } }
    ],
    invites: []
  };
  var settings = { tarjetaPrincipal: "chase-a1xa" };

  var json = function (obj, status) {
    return new Response(JSON.stringify(obj), { status: status || 200, headers: { "Content-Type": "application/json" } });
  };
  var sheetFor = function (key) { return sheets[key] || (sheets[key] = []); };
  var findRow = function (list, id) { return list.filter(function (r) { return r.id === String(id); })[0]; };
  var applyFields = function (row, b) {
    ["desc", "amount", "date", "category", "owed"].forEach(function (k) { if (b[k] !== undefined) row[k] = b[k]; });
    if (b.added !== undefined) row.added = String(b.added) === "true" ? "SI" : "NO";
    if (b.paid !== undefined) row.paid = String(b.paid) === "true" ? "SI" : "NO";
  };

  function handleSheet(action, b, q) {
    if (action === "cards-list") return { cards: cards };
    if (action === "card-read") return { expenses: sheetFor(q.cardId).slice() };
    if (action === "pagos-list") return { pagos: pagos.slice() };
    if (action === "pagos-add") { pagos.unshift({ id: b.id, cardId: b.cardId, date: b.date, amount: b.amount, note: b.note || "", by: b.by || "" }); return { ok: true }; }
    if (action === "pagos-delete") { pagos = pagos.filter(function (x) { return x.id !== b.id; }); return { ok: true }; }
    if (action === "recurring-read") return { items: recurring.slice() };
    if (action === "rules-list") return { rules: rules.slice() };
    if (action === "settings-get") return { settings: settings };
    if (action === "settings-set") { settings.tarjetaPrincipal = b.tarjetaPrincipal; return { ok: true }; }
    if (action === "budget-list") return { lines: budget.lines, config: budget.config, ingresos: budget.ingresos };
    if (action === "budget-add") {
      var line = { rowNum: 0, id: "ppto-n" + (++seq), grupo: b.grupo, nombre: b.nombre, anual: Number(b.anual) || 0, categorias: b.categorias || [], nota: b.nota || "", orden: budget.lines.length + 1, createdAt: "", fijo: !!b.fijo };
      budget.lines.push(line); return line;
    }
    if (action === "budget-edit") {
      var l = budget.lines.filter(function (x) { return x.id === b.id; })[0];
      if (l) ["grupo", "nombre", "anual", "categorias", "nota", "orden", "fijo"].forEach(function (k) { if (b[k] !== undefined) l[k] = k === "anual" ? Number(b[k]) : b[k]; });
      return { ok: true };
    }
    if (action === "budget-delete") { budget.lines = budget.lines.filter(function (x) { return x.id !== b.id; }); return { ok: true }; }
    if (action === "budget-reorder") {
      var byId = {}; budget.lines.forEach(function (x) { byId[x.id] = x; });
      var next = [];
      (b.items || []).forEach(function (it, i) { var x = byId[it.id]; if (x) { x.grupo = it.grupo; x.orden = i + 1; next.push(x); } });
      budget.lines = next.concat(budget.lines.filter(function (x) { return next.indexOf(x) < 0; }));
      return { ok: true };
    }
    if (action === "budget-config") { Object.keys(b).forEach(function (k) { if (k !== "action") budget.config[k] = b[k]; }); return { ok: true, config: budget.config }; }
    if (action === "budget-ingresos") {
      budget.ingresos = (b.ingresos || []).map(function (p, i) { return { id: p.id || "ing-n" + (++seq), nombre: p.nombre, bruto: p.bruto, neto: Number(p.neto) || 0, orden: i + 1 }; });
      budget.config.sueldoNetoAnual = budget.ingresos.reduce(function (s, p) { return s + p.neto; }, 0);
      if (b.fondoMeses !== undefined) budget.config.fondoMeses = b.fondoMeses;
      return { ok: true, ingresos: budget.ingresos, config: budget.config };
    }
    if (action === "budget-view") return { ok: true };
    if (action === "cards-add") { var c = { id: "card-n" + (++seq), nombre: b.nombre, color: b.color, sheetTab: "", cierreDay: b.cierreDay || "", dueDay: b.dueDay || "" }; cards.push(c); return c; }
    if (action === "cards-edit") { var cc = cards.filter(function (x) { return x.id === b.id; })[0]; if (cc) Object.keys(b).forEach(function (k) { if (k !== "action" && k !== "id") cc[k] = b[k]; }); return { ok: true }; }
    if (action === "cards-delete") { cards = cards.filter(function (x) { return x.id !== b.id; }); return { ok: true }; }
    if (action === "rules-add") { var r = Object.assign({}, b, { id: "rule-n" + (++seq) }); delete r.action; rules.push(r); return r; }
    if (action === "rules-edit") { var rr = rules.filter(function (x) { return x.id === b.id; })[0]; if (rr) Object.keys(b).forEach(function (k) { if (k !== "action" && k !== "id") rr[k] = b[k]; }); return { ok: true }; }
    if (action === "rules-delete") { rules = rules.filter(function (x) { return x.id !== b.id; }); return { ok: true }; }
    if (action === "recurring-append") { var it = { id: "rec-n" + (++seq), name: b.name, amount: b.amount, day: b.day }; recurring.push(it); return it; }
    if (action === "recurring-edit") { var ri = recurring.filter(function (x) { return x.id === String(b.id); })[0]; if (ri) { ri.name = b.name; ri.amount = b.amount; ri.day = b.day; } return { ok: true }; }
    if (action === "recurring-delete") { recurring = recurring.filter(function (x) { return x.id !== String(b.id); }); return { ok: true }; }
    // gastos: card-append/edit/update/delete (con cardId)
    var m = /^card-(append|edit|update|delete)$/.exec(action);
    if (m) {
      var list = sheetFor(b.cardId);
      if (m[1] === "append") {
        var row = { id: String(++seq), date: b.date, desc: b.desc, amount: b.amount, category: b.category || "", note: "", owed: b.owed || "", added: "NO", paid: "NO", registradoPor: b.registradoPor || "" };
        list.push(row); return { ok: true, id: row.id };
      }
      var target = findRow(list, b.id);
      if (m[1] === "delete") { var i = list.indexOf(target); if (i >= 0) list.splice(i, 1); return { ok: true }; }
      if (target) applyFields(target, b);
      return { ok: true };
    }
    return { ok: true };
  }

  function handlePlaid(action, b) {
    if (action === "state") return JSON.parse(JSON.stringify(plaid));
    if (action === "sync") return { added: 0, failed: 0 };
    if (action === "resolve") { plaid.inbox = plaid.inbox.filter(function (r) { return r.txId !== b.txId; }); return { ok: true }; }
    if (action === "map-account") { plaid.accounts.forEach(function (a) { if (a.accountId === b.accountId) a.cardId = b.cardId; }); return { ok: true }; }
    if (action === "bank-status") return { unavailable: true };
    if (action === "bank-transactions") return { transactions: [] };
    return { ok: true };
  }

  var realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    var u;
    try { u = new URL(url, location.href); } catch (e) { return realFetch(input, init); }
    if (u.pathname.indexOf("/api/") !== 0 && u.pathname !== "/api") {
      if (u.origin === location.origin && u.pathname === "/") return Promise.resolve(new Response("", { status: 200 }));
      return realFetch(input, init);
    }
    var body = {};
    try { body = init && init.body ? JSON.parse(init.body) : {}; } catch (e) {}
    var q = {}; u.searchParams.forEach(function (v, k) { q[k] = v; });
    var action = (init && init.method === "POST") ? body.action : q.action;
    var result;
    try {
      if (u.pathname === "/api/sheet") result = handleSheet(action, body, q);
      else if (u.pathname === "/api/plaid") result = handlePlaid(action, body);
      else if (u.pathname === "/api/admin") result = (!action || action === "overview") ? JSON.parse(JSON.stringify(admin)) : { ok: true };
      else if (u.pathname === "/api/auth") {
        if (action === "me") result = { userLabel: "Omar", rol: "admin" };
        else if (action === "password-login" || action === "password-set") result = { token: "demo", userLabel: body.userLabel || "Omar" };
        else if (action === "users") result = { users: ["Omar", "Shelsy"] };
        else return Promise.resolve(json({ error: "demo" }, 400));
      }
      else result = { ok: true };
    } catch (e) { return Promise.resolve(json({ error: String(e && e.message || e) }, 500)); }
    return new Promise(function (r) { setTimeout(function () { r(json(result)); }, 120); });
  };
})();
