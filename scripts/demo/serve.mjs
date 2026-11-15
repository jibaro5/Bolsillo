// Sirve la copia de ejemplo en http://localhost:8765 envuelta como la envuelve un artifact (solo para probarla).
import http from "node:http";
import fs from "node:fs";

const file = new URL("./out/index.html", import.meta.url);
http.createServer((req, res) => {
  const html = fs.readFileSync(file, "utf8");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(`<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>${html}</body></html>`);
}).listen(8765, () => console.log("listo en 8765"));
