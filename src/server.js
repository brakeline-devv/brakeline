// Website + dashboard + local API on http://localhost:5900. Binds to 127.0.0.1 only: the dashboard is for the human.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import * as guard from "./guard.js";
import { loadRules, saveRules } from "./rules.js";
import * as sim from "./sim.js";

const ROOT = fileURLToPath(new URL("../web/", import.meta.url));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".mp4": "video/mp4", ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json" };
const json = (res, code, o) => { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(o)); };
const body = (req) => new Promise((r) => { let b = ""; req.on("data", (c) => { b += c; if (b.length > 1e5) req.destroy(); }); req.on("end", () => { try { r(JSON.parse(b || "{}")); } catch { r({}); } }); });

async function api(req, res, path) {
  // browsers attach Origin to cross-site POSTs: refuse them so another website can't flip your kill switch
  const origin = req.headers.origin;
  if (req.method !== "GET" && origin && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return json(res, 403, { error: "forbidden origin" });
  const mode = (process.env.BRAKELINE_MODE || "sim").toLowerCase();
  try {
    if (path === "/api/state" && req.method === "GET") {
      const now = Date.now();
      return json(res, 200, {
        mode, status: mode === "sim" ? guard.status() : guard.relayStatus(),
        account: mode === "sim" ? guard.simAccount() : null,
        pending: guard.pending().filter((p) => !p.decision && p.expires > now),
        journal: guard.journal(60).reverse(),
      });
    }
    if (path === "/api/rules" && req.method === "POST") return json(res, 200, saveRules(await body(req)));
    if (path === "/api/kill" && req.method === "POST") { const { on } = await body(req); return json(res, 200, saveRules({ killSwitch: !!on })); }
    if (path === "/api/decide" && req.method === "POST") { const { id, decision } = await body(req); return json(res, 200, guard.decide(id, decision)); }
    if (path === "/api/reset" && req.method === "POST") { if (mode !== "sim") throw new Error("reset is only for the simulation"); sim.reset(); await sim.seedPrices(); (await import("node:fs")).writeFileSync(guard.JOURNAL_FILE, "[]"); return json(res, 200, { ok: true }); }
    return json(res, 404, { error: "not found" });
  } catch (e) { return json(res, 400, { error: e.message }); }
}

export function startServer(port = Number(process.env.PORT || 5900)) {
  sim.seedPrices().catch(() => {});
  createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.startsWith("/api/")) return api(req, res, p);
    if (p === "/app" || p === "/app/") p = "/app.html";
    if (p.endsWith("/")) p += "index.html";
    const file = normalize(join(ROOT, p));
    if (!file.startsWith(normalize(ROOT))) { res.writeHead(403).end(); return; }
    try {
      const { size } = await stat(file);
      const type = TYPES[extname(file)] || "application/octet-stream";
      const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || "");
      const data = await readFile(file);
      if (range) { // browsers need byte ranges to seek and loop the video
        const a = range[1] ? +range[1] : 0, b = range[2] ? +range[2] : size - 1;
        res.writeHead(206, { "Content-Type": type, "Content-Range": `bytes ${a}-${b}/${size}`, "Accept-Ranges": "bytes", "Content-Length": b - a + 1 });
        res.end(data.subarray(a, b + 1));
      } else {
        res.writeHead(200, { "Content-Type": type, "Content-Length": size, "Accept-Ranges": "bytes", "Cache-Control": "no-cache" });
        res.end(data);
      }
    } catch { res.writeHead(404).end("not found"); }
  }).listen(port, "127.0.0.1", () => console.log(`Brakeline → site http://localhost:${port}  ·  dashboard http://localhost:${port}/app`));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) startServer();
