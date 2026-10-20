import { sheetsFetch, ensureSheetExists, getSheetGid } from "./sheetsClient.js";
import { listLines, getConfig } from "./budgetStore.js";

// Builds the "Vista Presupuesto" tab: the budget laid out like the reference
// sheet (three tables side by side: Esenciales, No esenciales, Ahorro e
// inversión, with Bisemanal / Mensual / Anual columns, totals and a doughnut).
//
// Amounts are FORMULAS that read the "Presupuesto" tab, so editing a budget
// line in the app updates the view by itself. Only the layout (which lines sit
// in which table) is written here, so it's rebuilt when lines are added,
// deleted or moved to another group. The tab is a view: edit in the app.

const VIEW = "Vista Presupuesto";
const Q = `'${VIEW}'`;
const COLS = 14;
const ROWS = 90;
const BLOCKS = [
  // Bands use the sheet's theme accents in the order the doughnut paints its slices
  // (ACCENT1, 2, 3), so each table matches its slice. Google doesn't allow setting
  // slice colors directly, which is why the tables follow the chart and not the reverse.
  { grupo: "esencial", title: "Esenciales", col: 0, theme: "ACCENT1", ink: "#ffffff" },
  { grupo: "no_esencial", title: "No esenciales", col: 5, theme: "ACCENT2", ink: "#ffffff" },
  { grupo: "ahorro", title: "Ahorro e inversión", col: 10, theme: "ACCENT3", ink: "#0f172a" },
];
const letter = i => String.fromCharCode(65 + i);
const rgb = hex => ({ red: parseInt(hex.slice(1, 3), 16) / 255, green: parseInt(hex.slice(3, 5), 16) / 255, blue: parseInt(hex.slice(5, 7), 16) / 255 });
const P = "Presupuesto";
const lookup = (col, id) => `IFERROR(INDEX(${P}!$${col}:$${col},MATCH("${id}",${P}!$A:$A,0)),`;

export async function rebuildBudgetView() {
  const lines = await listLines();
  const cfg = await getConfig();
  await ensureSheetExists(VIEW);
  const gid = await getSheetGid(VIEW);

  // ---- values (formulas) ----
  const grid = Array.from({ length: ROWS }, () => Array(COLS).fill(""));
  const put = (r, c, v) => { grid[r - 1][c] = v; };
  put(1, 0, cfg.titulo || "Presupuesto");
  put(2, 0, "Vista de solo lectura. Los cambios se hacen en la app Bolsillo (sección Presupuesto) y se reflejan aquí.");

  // salary summary (rows 4-8)
  put(4, 0, "Resumen del sueldo");
  ["", "Bisemanal", "Mensual", "Anual"].forEach((h, i) => put(5, i, h));
  put(6, 0, "Sueldo neto");
  put(6, 3, `=IFERROR(INDEX(PresupuestoConfig!$B:$B,MATCH("sueldoNetoAnual",PresupuestoConfig!$A:$A,0)),0)`);
  put(7, 0, "Planificado");
  put(7, 3, `=SUM(${P}!$D$2:$D)`);
  put(8, 0, "Sin asignar");
  put(8, 3, "=D6-D7");
  for (const r of [6, 7, 8]) { put(r, 1, `=D${r}/26`); put(r, 2, `=D${r}/12`); }

  // proportions (rows 10-15) — source of the doughnut
  put(10, 0, "Proporción de gastos");
  ["Grupo", "Mensual", "Anual", "%"].forEach((h, i) => put(11, i, h));
  BLOCKS.forEach((b, i) => {
    const r = 12 + i;
    put(r, 0, b.title);
    put(r, 2, `=SUMIF(${P}!$B:$B,"${b.grupo}",${P}!$D:$D)`);
    put(r, 1, `=C${r}/12`);
    put(r, 3, `=IFERROR(C${r}/C$15,0)`);
  });
  put(15, 0, "Total");
  put(15, 2, "=SUM(C12:C14)"); put(15, 1, "=C15/12"); put(15, 3, "=SUM(D12:D14)");

  // the three tables (from row 18)
  const TOP = 18;
  const layout = BLOCKS.map(b => {
    const rows = lines.filter(l => l.grupo === b.grupo);
    const first = TOP + 2, last = first + rows.length - 1, total = first + rows.length;
    const c = b.col;
    put(TOP, c, b.title);
    ["", "Bisemanal", "Mensual", "Anual"].forEach((h, i) => put(TOP + 1, c + i, h));
    rows.forEach((l, i) => {
      const r = first + i;
      put(r, c, `=${lookup("C", l.id)}"")`);
      put(r, c + 3, `=${lookup("D", l.id)}0)`);
      put(r, c + 1, `=${letter(c + 3)}${r}/26`);
      put(r, c + 2, `=${letter(c + 3)}${r}/12`);
    });
    put(total, c, "Total");
    for (let i = 1; i <= 3; i++) put(total, c + i, rows.length ? `=SUM(${letter(c + i)}${first}:${letter(c + i)}${last})` : "=0");
    return { ...b, rows, first, last, total };
  });

  await sheetsFetch(`/values/${encodeURIComponent(`${Q}!A1:Z${ROWS + 20}`)}:clear`, { method: "POST", body: "{}" });
  await sheetsFetch(`/values:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({ valueInputOption: "USER_ENTERED", data: [{ range: `${Q}!A1`, values: grid }] }),
  });

  // ---- formatting ----
  const meta = await sheetsFetch(`?fields=sheets(properties.sheetId,charts.chartId,protectedRanges.protectedRangeId)`);
  const mine = (meta.sheets || []).find(s => s.properties.sheetId === gid) || {};
  const R = (r1, c1, r2, c2) => ({ sheetId: gid, startRowIndex: r1 - 1, endRowIndex: r2, startColumnIndex: c1, endColumnIndex: c2 + 1 }); // 1-based rows, 0-based cols, inclusive
  const fmt = (range, userEnteredFormat, fields) => ({ repeatCell: { range, cell: { userEnteredFormat }, fields: `userEnteredFormat(${fields})` } });
  const border = (range, style = "SOLID", color = "#cbd5e1") => ({ style, color: rgb(color) });
  const reqs = [];

  (mine.charts || []).forEach(c => reqs.push({ deleteEmbeddedObject: { objectId: c.chartId } }));
  (mine.protectedRanges || []).forEach(p => reqs.push({ deleteProtectedRange: { protectedRangeId: p.protectedRangeId } }));
  reqs.push({ unmergeCells: { range: R(1, 0, ROWS, COLS - 1) } });
  reqs.push({ repeatCell: { range: R(1, 0, ROWS, COLS - 1), cell: {}, fields: "userEnteredFormat" } });
  reqs.push({ updateSheetProperties: { properties: { sheetId: gid, gridProperties: { hideGridlines: true, rowCount: Math.max(ROWS + 20, 100), columnCount: 26 } }, fields: "gridProperties(hideGridlines,rowCount,columnCount)" } });

  const widths = [230, 96, 96, 100, 24, 230, 96, 96, 100, 24, 230, 96, 96, 100];
  widths.forEach((w, i) => reqs.push({ updateDimensionProperties: { range: { sheetId: gid, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 }, properties: { pixelSize: w }, fields: "pixelSize" } }));
  reqs.push({ updateDimensionProperties: { range: { sheetId: gid, dimension: "ROWS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 36 }, fields: "pixelSize" } });

  const base = { textFormat: { fontFamily: "Roboto", fontSize: 10 }, verticalAlignment: "MIDDLE" };
  reqs.push(fmt(R(1, 0, ROWS, COLS - 1), base, "textFormat,verticalAlignment"));
  reqs.push(fmt(R(1, 0, 1, 0), { textFormat: { fontFamily: "Roboto", fontSize: 18, bold: true, foregroundColor: rgb("#0f172a") } }, "textFormat"));
  reqs.push(fmt(R(2, 0, 2, 0), { textFormat: { fontFamily: "Roboto", fontSize: 9, italic: true, foregroundColor: rgb("#64748b") } }, "textFormat"));

  // one styled table: band row, headings row, body rows (+ optional total row)
  const table = ({ band, c1, headRow, bodyFirst, bodyLast, totalRow, bandColor, bandTheme, ink, numFrom = 1, banded = true }) => {
    const c2 = c1 + 3;
    reqs.push({ mergeCells: { range: R(band, c1, band, c2), mergeType: "MERGE_ALL" } });
    reqs.push(fmt(R(band, c1, band, c2), { ...(bandTheme ? { backgroundColorStyle: { themeColor: bandTheme } } : { backgroundColor: rgb(bandColor) }), textFormat: { fontFamily: "Roboto", fontSize: 12, bold: true, foregroundColor: rgb(ink) }, horizontalAlignment: "LEFT", padding: { left: 8 } }, `${bandTheme ? "backgroundColorStyle" : "backgroundColor"},textFormat,horizontalAlignment,padding`));
    reqs.push({ updateDimensionProperties: { range: { sheetId: gid, dimension: "ROWS", startIndex: band - 1, endIndex: band }, properties: { pixelSize: 28 }, fields: "pixelSize" } });
    reqs.push(fmt(R(headRow, c1, headRow, c2), { backgroundColor: rgb("#f8fafc"), textFormat: { fontFamily: "Roboto", fontSize: 9, bold: true, foregroundColor: rgb("#64748b") }, horizontalAlignment: "RIGHT" }, "backgroundColor,textFormat,horizontalAlignment"));
    reqs.push(fmt(R(headRow, c1, headRow, c1), { horizontalAlignment: "LEFT" }, "horizontalAlignment"));
    const last = totalRow || bodyLast;
    if (bodyLast >= bodyFirst) {
      reqs.push(fmt(R(bodyFirst, c1 + numFrom, bodyLast, c2), { numberFormat: { type: "CURRENCY", pattern: "$#,##0.00" }, horizontalAlignment: "RIGHT" }, "numberFormat,horizontalAlignment"));
      if (banded) for (let r = bodyFirst + 1; r <= bodyLast; r += 2) reqs.push(fmt(R(r, c1, r, c2), { backgroundColor: rgb("#f8fafc") }, "backgroundColor"));
      reqs.push(fmt(R(bodyFirst, c1, bodyLast, c1), { padding: { left: 8 } }, "padding"));
    }
    if (totalRow) {
      reqs.push(fmt(R(totalRow, c1 + numFrom, totalRow, c2), { numberFormat: { type: "CURRENCY", pattern: "$#,##0.00" }, horizontalAlignment: "RIGHT" }, "numberFormat,horizontalAlignment"));
      reqs.push(fmt(R(totalRow, c1, totalRow, c2), { backgroundColor: rgb("#f1f5f9"), textFormat: { fontFamily: "Roboto", fontSize: 10, bold: true, foregroundColor: rgb("#0f172a") } }, "backgroundColor,textFormat"));
      reqs.push(fmt(R(totalRow, c1, totalRow, c1), { padding: { left: 8 } }, "padding"));
    }
    const whole = R(band, c1, last, c2);
    reqs.push({ updateBorders: { range: whole, top: border(), bottom: border(), left: border(), right: border(), innerHorizontal: { style: "SOLID", color: rgb("#e2e8f0") } } });
    if (totalRow) reqs.push({ updateBorders: { range: R(totalRow, c1, totalRow, c2), top: { style: "SOLID_MEDIUM", color: rgb("#94a3b8") } } });
  };

  table({ band: 4, c1: 0, headRow: 5, bodyFirst: 6, bodyLast: 7, bandColor: "#e2e8f0", ink: "#0f172a" });
  // "Sin asignar" is the closing line of the summary
  reqs.push(fmt(R(8, 1, 8, 3), { numberFormat: { type: "CURRENCY", pattern: "$#,##0.00" }, horizontalAlignment: "RIGHT" }, "numberFormat,horizontalAlignment"));
  reqs.push(fmt(R(8, 0, 8, 3), { backgroundColor: rgb("#f1f5f9"), textFormat: { fontFamily: "Roboto", fontSize: 10, bold: true, foregroundColor: rgb("#0f172a") } }, "backgroundColor,textFormat"));
  reqs.push(fmt(R(8, 0, 8, 0), { padding: { left: 8 } }, "padding"));
  reqs.push({ updateBorders: { range: R(8, 0, 8, 3), top: { style: "SOLID_MEDIUM", color: rgb("#94a3b8" ) }, bottom: border(), left: border(), right: border() } });

  table({ band: 10, c1: 0, headRow: 11, bodyFirst: 12, bodyLast: 14, totalRow: 15, bandColor: "#e2e8f0", ink: "#0f172a" });
  reqs.push(fmt(R(12, 3, 15, 3), { numberFormat: { type: "PERCENT", pattern: "0.0%" } }, "numberFormat"));

  layout.forEach(b => table({ band: TOP, c1: b.col, headRow: TOP + 1, bodyFirst: b.first, bodyLast: b.last, totalRow: b.total, bandTheme: b.theme, ink: b.ink }));

  // the proportion table doubles as the legend: each group name carries its slice's color
  BLOCKS.forEach((b, i) => reqs.push(fmt(R(12 + i, 0, 12 + i, 0), { backgroundColorStyle: { themeColor: b.theme }, textFormat: { fontFamily: "Roboto", fontSize: 10, bold: true, foregroundColor: rgb(b.ink) } }, "backgroundColorStyle,textFormat")));

  // doughnut next to the summary
  reqs.push({
    addChart: {
      chart: {
        spec: {
          title: "Proporción de Gastos",
          titleTextFormat: { fontFamily: "Roboto", bold: true, fontSize: 12 },
          pieChart: {
            legendPosition: "RIGHT_LEGEND",
            domain: { sourceRange: { sources: [R(12, 0, 14, 0)] } },
            series: { sourceRange: { sources: [R(12, 2, 14, 2)] } },
            pieHole: 0.5,
          },
        },
        position: { overlayPosition: { anchorCell: { sheetId: gid, rowIndex: 2, columnIndex: 5 }, offsetXPixels: 0, offsetYPixels: 0, widthPixels: 540, heightPixels: 296 } },
      },
    },
  });

  // typing on the view warns first (it's a view; the app is where numbers change)
  reqs.push({ addProtectedRange: { protectedRange: { range: { sheetId: gid }, description: "Vista del presupuesto: edita en la app Bolsillo", warningOnly: true } } });

  await sheetsFetch(`:batchUpdate`, { method: "POST", body: JSON.stringify({ requests: reqs }) });
  return { gid, lines: lines.length, tables: layout.map(b => ({ grupo: b.grupo, rows: b.rows.length, total: b.total })) };
}

// Called after budget writes; never lets a view problem fail the real action.
export async function refreshBudgetView() {
  try { return await rebuildBudgetView(); }
  catch (err) { console.warn("budget view refresh failed:", err.message); return null; }
}
