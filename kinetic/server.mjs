// Sumate's second sheet server, for the game host on Kinetic (GeneralGames, next to Chess Tactics, Juntos and Ronda).
//
// Kleider, 2026-11-18: "I don't want the app relaying forever onto the same service, all parts of the app should work
// even if one the pieces break down". The sheets (worker/src/index.js) live on Cloudflare as Durable Objects; this
// runs the very same Worker and Sheet code on Node, with a small stand-in for the Durable Object parts it uses (its
// storage and its alarm). Every sheet is kept on both: after each change one server sends its copy to the other
// (worker/src/index.js says how they merge), so the app can use either one.
//
// Settings: PORT, BIND, DATA_DIR (the sheets, one file each), PEER (the other server, default
// https://signup.jurisgames.com), SYNC_KEY (shared with the other server; when not set it is read from
// DATA_DIR/sync-key, which tools/kinetic.mjs in ChessTactics puts there from C:/AI/Secrets at deploy time).
//
// Game host contract (ChessTactics/docs/HOSTING.md "Adding a future game"): listen on PORT; keep files in
// DATA_DIR; stop on "stop" read from the input; GET /api/health as JSON. The host strips the public path
// (/sumate), so this sees /api/sheets/..., and passes the visitor's address in x-forwarded-for.
import http from "node:http";
import { webcrypto, createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync, renameSync } from "node:fs";
import { join } from "node:path";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const worker = await import(process.env.SUMATE_SHEET || "./sheet.mjs");
const { Sheet } = worker;

const PORT = Number(process.env.PORT) || 8790;
const BIND = process.env.BIND || "127.0.0.1"; // behind the game host's door only (safety round 2, J18)
const DATA = process.env.DATA_DIR || join(process.cwd(), "data");
const MAX_HELD = 2000; // sheets held in memory at once (the rest stay on disk)
const IDLE_MS = 10 * 60 * 1000;
const MAX_BODY = worker.sizes().MAX_SYNC + 1024; // the biggest copy the other server sends (one budget for every hop, round 3 S2)
// anything else is an app request: the sheet code takes at most its own MAX_BODY, so no more is read (second-pass S2-13d)
const MAX_APP_BODY = worker.sizes().MAX_BODY + 1024;
const NEW_PER_MINUTE = 30; // sheets one address may make in a minute
const WRITES_PER_MINUTE = 300; // changes one address may make in a minute
const READS_PER_MINUTE = 600; // reads of a sheet one address may make in a minute (round 3, S3; the Worker's READS; S2-4)
mkdirSync(DATA, { recursive: true });
// how busy this server is goes only to whoever has the ops key (data/ops-key; the deploy's "is anyone online?"),
// everyone else hears "ok" (audit R17)
let opsKey = process.env.OPS_KEY || "";
if (!opsKey) try { opsKey = readFileSync(join(DATA, "ops-key"), "utf8").trim(); } catch (_) {}
const isOps = (req) => {
  const k = String(req.headers["x-ops-key"] || "");
  if (!opsKey || k.length !== opsKey.length) return false;
  let d = 0;
  for (let i = 0; i < k.length; i++) d |= k.charCodeAt(i) ^ opsKey.charCodeAt(i);
  return d === 0;
};


// What the sweep needs to know of each room file on disk: read once at start, then kept up to date on every write,
// so the sweep never re-reads the folder (APP-RULES safety 14: work proportional to what changed).
const MAX_FILES = 50000; // the data folder shares a disk with the other games: no new rooms past this
const disk = new Map(); // file -> { name, alarm, ... }
const summary = (m) => ({ name: m.__name || "", alarm: Number(m.__alarm) || 0, pending: !!(m.d && m.d.sent !== m.d.v) });
for (const f of readdirSync(DATA)) {
  if (!f.endsWith(".json")) continue;
  try { disk.set(join(DATA, f), summary(JSON.parse(readFileSync(join(DATA, f), "utf8")))); } catch (_) {}
}

let key = process.env.SYNC_KEY || "";
if (!key) try { key = readFileSync(join(DATA, "sync-key"), "utf8").trim(); } catch (_) {}

// ---- the Durable Object stand-in ----

const fileOf = (name) => join(DATA, createHash("sha256").update(name).digest("hex").slice(0, 32) + ".json");
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

class Storage {
  constructor(name, onAlarm) {
    this.name = name;
    this.file = fileOf(name);
    this.onAlarm = onAlarm;
    try {
      this.map = new Map(Object.entries(JSON.parse(readFileSync(this.file, "utf8"))));
      this.map.delete("__name");
    } catch (_) {
      this.map = new Map();
    }
  }
  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 200);
  }
  /** Writes the file now. A failed write is said (a line in the log, and an error to whoever asked when `loud`), never
   * answered as saved (round 3, S10): the app then uses the other server. */
  flush(loud = false) {
    clearTimeout(this.timer);
    try {
      if (!this.map.size) {
        disk.delete(this.file);
        try { unlinkSync(this.file); } catch (e) { if (e.code !== "ENOENT") throw e; }
        return;
      }
      const all = { __name: this.name, ...Object.fromEntries(this.map) };
      writeFileSync(this.file + ".tmp", JSON.stringify(all));
      renameSync(this.file + ".tmp", this.file);
      disk.set(this.file, summary(all));
    } catch (e) {
      console.error("sumate: writing a sheet failed:", e && e.message);
      if (loud) throw new Error("not saved");
    }
  }
  async get(k) {
    return clone(this.map.get(k));
  }
  // the sheet code removes small keys (the retry count "t", the network counts "nets"): before this it had no delete, so
  // they stayed (found with second-pass S2-7a)
  async delete(k) {
    if (this.map.delete(k)) this.save();
  }
  async put(k, v) {
    // the file cap holds for every way a sheet arrives here: made here, copied from the other server, or fetched from it
    if (!disk.has(this.file) && disk.size >= MAX_FILES) throw new Error("full");
    this.map.set(k, clone(v));
    if (k === "d") this.flush(true);
    else this.save();
  }
  async deleteAll() {
    this.map.clear();
    clearTimeout(this.alarmTimer);
    this.save();
  }
  async setAlarm(t) {
    this.map.set("__alarm", Number(t));
    this.save();
    clearTimeout(this.alarmTimer);
    const wait = Number(t) - Date.now();
    if (wait < 60 * 1000) this.alarmTimer = setTimeout(this.onAlarm, Math.max(0, wait));
  }
  async deleteAlarm() {
    this.map.delete("__alarm");
    clearTimeout(this.alarmTimer);
    this.save();
  }
  async getAlarm() {
    return this.map.get("__alarm") ?? null;
  }
}

const held = new Map(); // name -> { sheet, storage, used }

function sheetOf(name) {
  let h = held.get(name);
  if (!h) {
    if (held.size >= MAX_HELD) sweep(true);
    h = { name, used: Date.now() };
    h.storage = new Storage(name, () => fire(h));
    h.sheet = new Sheet({ storage: h.storage }, ENV);
    held.set(name, h);
  }
  h.used = Date.now();
  return h;
}
async function fire(h) {
  if (h.firing) return;
  h.firing = true;
  h.storage.map.delete("__alarm");
  try {
    await h.sheet.alarm();
  } catch (e) {
    console.error("sumate alarm error:", e && e.message);
  } finally {
    h.firing = false;
  }
}

// what the Worker expects of Cloudflare's Durable Object namespace, and its settings
const ENV = {
  PEER: process.env.PEER ?? "https://signup.jurisgames.com",
  LIMITS: "host", // this server counts new sheets, changes and reads itself (over(), before the sheet code runs)
  SYNC_KEY: key,
  SHEETS: {
    idFromName: (name) => name,
    get: (name) => ({ fetch: (url, init) => sheetOf(name).sheet.fetch(url instanceof Request ? url : new Request(url, init)) }),
  },
};

// due alarms run; sheets not used for a while are put away (their file stays, with its alarm)
async function sweep(force) {
  const now = Date.now();
  for (const [name, h] of held) {
    const due = h.storage.map.get("__alarm");
    if (due && due <= now) await fire(h);
    if (force || now - h.used > IDLE_MS) {
      h.storage.flush();
      clearTimeout(h.storage.alarmTimer);
      held.delete(name);
    }
  }
  if (force) return;
  for (const s of [...disk.values()]) {
    if (!s.name || held.has(s.name)) continue;
    try {
      if (s.alarm && s.alarm <= now) await fire(sheetOf(s.name));
    } catch (_) {}
  }
}
setInterval(sweep, 15 * 1000).unref();
// sheets waiting to be sent to the other server are sent soon after a restart
setTimeout(sweep, 2000).unref();

// the other server just sent something, so it is up again: send it every sheet it is still waiting for now,
// instead of at their next try (up to 5 minutes away)
let kicked = 0;
async function kick() {
  if (Date.now() - kicked < 10000) return;
  kicked = Date.now();
  const pending = (m) => !!(m && m.d) && m.d.sent !== m.d.v;
  for (const h of held.values()) if (pending({ d: h.storage.map.get("d") })) fire(h);
  for (const s of [...disk.values()]) if (s.name && !held.has(s.name) && s.pending) fire(sheetOf(s.name));
}

const started = Date.now();
const counts = new Map(); // "new|write" + address -> this minute
setInterval(() => counts.clear(), 60 * 1000).unref();
const over = (kind, ip, max) => {
  const n = (counts.get(kind + ip) || 0) + 1;
  counts.set(kind + ip, n);
  return n > max;
};

// ---- http ----

const server = http.createServer(async (req, res) => {
  // the path as it is served (a URL folds "\", "/./" and "/../"), so it is counted the way it is served: counting the
  // raw text let /api/./sheets walk past every limit (second-pass S2-6); one that changes on parsing is refused
  const raw = (req.url || "/").split("?")[0];
  let path;
  try { path = new URL(raw, "http://sumate").pathname; } catch { path = ""; }
  if (path !== raw) {
    res.writeHead(404, { "content-type": "application/json", "Access-Control-Allow-Origin": "*" });
    return res.end(JSON.stringify({ error: "not found" }));
  }
  const cors = { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" };
  if (path === "/api/health" || path === "/health") {
    res.writeHead(200, { "content-type": "application/json", ...cors });
    if (!isOps(req)) return res.end(JSON.stringify({ ok: true }));
    return res.end(JSON.stringify({ ok: true, sheets: held.size, peer: !!(ENV.PEER && ENV.SYNC_KEY), upMinutes: Math.round((Date.now() - started) / 60000) }));
  }
  // the visitor's address as the host's door states it; one home line is one address (IPv6 by its /64, as on the
  // Worker: round 3, S10)
  const addr = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "?").split(",")[0].trim();
  const ip = worker.netOf(addr);
  const writing = req.method !== "GET" && req.method !== "OPTIONS" && !path.startsWith("/api/sync/");
  const reading = req.method === "GET" && path.startsWith("/api/sheets/");
  if (path === "/api/sheets" && req.method === "POST" && disk.size >= MAX_FILES) {
    // full here is not the visitor's doing: an error, so the app makes the sheet on the other server
    res.writeHead(503, { "content-type": "application/json", ...cors });
    return res.end(JSON.stringify({ error: "offline" }));
  }
  if ((path === "/api/sheets" && req.method === "POST" && over("new", ip, NEW_PER_MINUTE)) || (writing && over("write", ip, WRITES_PER_MINUTE))
    || (reading && over("read", ip, READS_PER_MINUTE))) {
    res.writeHead(429, { "content-type": "application/json", ...cors });
    return res.end(JSON.stringify({ error: "slow" }));
  }
  const chunks = [];
  let size = 0;
  const cap = path.startsWith("/api/sync/") ? MAX_BODY : MAX_APP_BODY;
  for await (const c of req) {
    size += c.length;
    if (size > cap) {
      res.writeHead(413, cors);
      return res.end();
    }
    chunks.push(c);
  }
  try {
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
    headers.set("cf-connecting-ip", addr); // what the sheet code counts by: the address the door stated, not one a visitor sends
    const body = chunks.length && req.method !== "GET" && req.method !== "HEAD" ? Buffer.concat(chunks) : undefined;
    const r = await worker.default.fetch(new Request("http://sumate" + path + (req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""), { method: req.method, headers, body }), ENV);
    const out = {};
    r.headers.forEach((v, k) => (out[k] = v));
    if (path.startsWith("/api/sync/") && r.status === 200) kick();
    res.writeHead(r.status, out);
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    console.error("sumate error:", e && e.message);
    res.writeHead(503, { "content-type": "application/json", ...cors }); // not saved here: the app tries the other server
    res.end(JSON.stringify({ error: "offline" }));
  }
});

server.listen(PORT, BIND, () => console.log(`Sumate sheet server on ${BIND}:${PORT}` + (ENV.PEER && ENV.SYNC_KEY ? " (copies to the other server)" : " (no other server)")));

process.stdin.on("data", (d) => {
  const cmd = String(d).trim();
  if (cmd === "stop") {
    console.log("stopping");
    for (const h of held.values()) h.storage.flush();
    setTimeout(() => process.exit(0), 300);
  } else if (cmd === "status") console.log(`sheets held ${held.size}, up ${Math.round((Date.now() - started) / 60000)} min`);
});
process.stdin.resume();
