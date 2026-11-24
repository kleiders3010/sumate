// Item 46: how much crowd the game host's copy of Sumate carries (the rented host: one core, 2 GiB, every game in it).
// Runs kinetic/server.mjs locally (never the live host, no copies to Cloudflare), makes SHEETS sheets, keeps VIEWERS
// open tabs on each asking for news every 8 s (the page's fastest pace, web/app.js pacer) for SECONDS, and every tab
// signs up once at a random moment. Prints the server's memory and CPU and how long requests take.
//   SHEETS=20 VIEWERS=50 SECONDS=40 node worker/load_test.mjs
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import http from "node:http";

const here = dirname(fileURLToPath(import.meta.url));
const KIN = join(here, "..", "kinetic");
const SHEETS = Number(process.env.SHEETS) || 20;
const VIEWERS = Number(process.env.VIEWERS) || 50;
const SECONDS = Number(process.env.SECONDS) || 40;
const PORT = Number(process.env.PORT) || 8852;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const data = mkdtempSync(join(tmpdir(), "sumate-load-"));
const probe = join(data, "probe.mjs");
writeFileSync(probe, `let c0 = process.cpuUsage(); setInterval(() => { const c = process.cpuUsage(c0);
  process.stderr.write("probe " + process.memoryUsage().rss + " " + (c.user + c.system) + "\\n"); }, 500).unref();`);
const srv = spawn("node", [...(process.env.PROFILE ? ["--cpu-prof", "--cpu-prof-dir=" + process.env.PROFILE] : []), "--import", pathToFileURL(probe).href, "server.mjs"], { cwd: KIN, windowsHide: true,
  stdio: [process.env.PROFILE ? "pipe" : "ignore", "ignore", "pipe"],
  env: { ...process.env, PORT: String(PORT), BIND: "127.0.0.1", DATA_DIR: join(data, "d"), PEER: "", SYNC_KEY: "" } });
let rss = 0, peak = 0, cpu = 0;
srv.stderr.on("data", (d) => {
  for (const l of String(d).split("\n")) {
    const m = l.match(/^probe (\d+) (\d+)/);
    if (m) { rss = Number(m[1]); peak = Math.max(peak, rss); cpu = Number(m[2]); }
  }
});
const agent = new http.Agent({ keepAlive: true, maxSockets: 256 });
let addr = 0;
const call = (path, method = "GET", body, ip) => new Promise((res) => {
  const t = Date.now();
  const b = body === undefined ? undefined : JSON.stringify(body);
  const req = http.request({ host: "127.0.0.1", port: PORT, path: "/api" + path, method, agent,
    headers: { "content-type": "application/json", "x-forwarded-for": ip, ...(b ? { "content-length": Buffer.byteLength(b) } : {}) } }, (r) => {
    let s = "";
    r.on("data", (c) => (s += c));
    r.on("end", () => res({ status: r.statusCode, ms: Date.now() - t, json: (() => { try { return JSON.parse(s); } catch { return null; } })() }));
  });
  req.on("error", () => res({ status: 0, ms: Date.now() - t }));
  if (b) req.write(b);
  req.end();
});
for (let i = 0; i < 80; i++) {
  try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) break; } catch {}
  await wait(100);
}
await wait(600);
const idle = rss;
const MB = (b) => (b / 1048576).toFixed(0) + " MB";
// 25 tabs an address (a class, an office)
const ipOf = (n) => `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${Math.floor(n / 25) & 255}`;

const sheets = [];
for (let s = 0; s < SHEETS; s++) {
  const rows = Array.from({ length: 10 }, (_, i) => ({ text: "Slot " + i, max: 0 }));
  const r = await call("/sheets", "POST", { title: "Load " + s, rows }, ipOf(100000 + s));
  if (r.status !== 200) { console.log("could not make a sheet:", r.status, JSON.stringify(r.json)); process.exit(1); }
  const v = await call(`/sheets/${r.json.id}`, "GET", undefined, ipOf(100000 + s));
  sheets.push({ id: r.json.id, rows: v.json.sheet.rows.map((x) => x.id) });
}
const afterMake = rss;
const reads = [], writes = [], codes = {};
const note = (r, list) => { list.push(r.status === 200 ? r.ms : Infinity); codes[r.status] = (codes[r.status] || 0) + 1; };
const cpu0 = cpu, t0 = Date.now(), end = t0 + SECONDS * 1000;
const tabs = [];
for (const sh of sheets) for (let v = 0; v < VIEWERS; v++) {
  const ip = ipOf(addr++);
  const signAt = t0 + Math.random() * SECONDS * 750;
  tabs.push((async () => {
    await wait(Math.random() * 8000);
    let signed = false;
    while (Date.now() < end) {
      if (!signed && Date.now() >= signAt) {
        signed = true;
        note(await call(`/sheets/${sh.id}/signups`, "POST", { row: sh.rows[v % sh.rows.length], name: "Tab " + v, token: ("t" + addr + "x" + v).padEnd(24, "q") }, ip), writes);
      }
      note(await call(`/sheets/${sh.id}`, "GET", undefined, ip), reads);
      await wait(Math.min(8000, Math.max(0, signAt - Date.now())) || 8000);
    }
  })());
}
await Promise.all(tabs);
const ms = Date.now() - t0;
const usedCpu = (cpu - cpu0) / 1000;
const stat = (l) => { const a = [...l].sort((x, y) => x - y); const p = (q) => a[Math.min(a.length - 1, Math.floor(q * a.length))]; return { n: a.length, p50: p(0.5), p95: p(0.95), max: a[a.length - 1], failed: a.filter((x) => x === Infinity).length }; };
console.log(JSON.stringify({
  sheets: SHEETS, tabsPerSheet: VIEWERS, seconds: SECONDS,
  memIdle: MB(idle), memAfterSheets: MB(afterMake), memPeak: MB(peak),
  serverCpu: usedCpu.toFixed(0) + " ms of " + ms + " ms (" + (100 * usedCpu / ms).toFixed(0) + "% of one core)",
  requestsPerSecond: ((reads.length + writes.length) / (ms / 1000)).toFixed(0),
  readsMs: stat(reads), signupsMs: stat(writes), statuses: codes,
}));
agent.destroy();
// PROFILE=<folder>: the server stops on its own so node writes the CPU profile there
if (process.env.PROFILE) { srv.stdin.write("stop\n"); await new Promise((r) => srv.once("exit", r)); } else srv.kill();
await wait(300);
rmSync(data, { recursive: true, force: true });
