// Arma la copia de ejemplo de la app (para publicarla como artifact y recibir comentarios).
// Uso: npm run build && node scripts/demo/build.mjs   -> scripts/demo/out/index.html
// La página lleva el bundle real de dist/ y un servidor falso en el navegador (mock.js): no toca el Sheet.
import fs from "node:fs";

const root = new URL("../../", import.meta.url);
const dist = new URL("dist/assets/", root).pathname;
const main = fs.readdirSync(dist).map(f => ({ f, s: fs.statSync(dist + f).size })).sort((a, b) => b.s - a.s)[0].f;
const bundle = fs.readFileSync(dist + main, "utf8").replace(/<\/script/gi, "<\\/script");
const mock = fs.readFileSync(new URL("./mock.js", import.meta.url), "utf8");
const html = `<title>Bolsillo</title>
<style>
:root{--ground:#f1f5f9;--demo-bg:#fffbeb;--demo-fg:#92400e;--demo-line:#fde68a;color-scheme:light}
body{margin:0;background:var(--ground);color:#0f172a}
.demo{font:600 12px/1.4 'DM Sans',system-ui,sans-serif;background:var(--demo-bg);color:var(--demo-fg);border-bottom:1px solid var(--demo-line);padding:8px max(16px,env(safe-area-inset-left,0px)) 8px max(16px,env(safe-area-inset-right,0px));text-align:center}
</style>
<div class="demo">Versión de prueba con datos de ejemplo. Lo que cambies aquí no se guarda. Si sales y te pide entrar, escribe cualquier usuario y contraseña.</div>
<div id="root"></div>
<script>${mock}</script>
<script type="module">${bundle}</script>
`;
const out = new URL("./out/", import.meta.url);
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(new URL("./index.html", out), html);
console.log("bundle:", main, "bytes:", html.length);
