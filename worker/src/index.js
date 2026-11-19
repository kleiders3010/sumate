// Sumate: the web app (static files) and its sign-up sheets, one Worker.
// One Durable Object per sheet keeps the sheet (title, details, rows) and who signed up where.
// A sheet is deleted 90 days after its last change, or when its organizer deletes it.
//
// Two servers (Kleider, 2026-11-18: "all parts of the app should work even if one the pieces break down"): every
// sheet is also kept on the game host (games.jurisgames.com/sumate, kinetic/server.mjs runs this same file on
// Node). Either server takes sign-ups and edits. After each change the server sends its whole copy of the sheet to
// the other one (POST /api/sync/<id>, with a key both share), which merges it into its own and answers with the
// result, so both end up with the same sheet. Merging never loses a sign-up: sign-ups are added up by their id, a
// removed one is remembered by its id, the sheet's text is the one edited last, a deleted sheet stays deleted. When
// the other server can't be reached the copy is sent again later (the alarm), and a server asked for a sheet it
// doesn't have asks the other one first.

const KEEP_MS = 90 * 24 * 3600 * 1000;
const MAX_ROWS = 200;
const MAX_ENTRIES = 3000;
const MAX_GONE = 3000;
const MAX_BODY = 64 * 1024;
const MAX_SYNC = 1024 * 1024; // a whole sheet with its sign-ups
// the other server is down: try again after these (at most 5 minutes apart, so the copies agree soon after it is back)
const RETRY_MS = [15e3, 30e3, 60e3, 2 * 60e3, 5 * 60e3];

const cors = {
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*", // the copy of the site on GitHub Pages, and the app on either server
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE",
  "Access-Control-Allow-Headers": "Content-Type, X-Sheet-Key, X-Sign-Tokens",
  "Access-Control-Max-Age": "86400",
};
const json = (data, status = 200) => Response.json(data, { status, headers: cors });
const str = (v, n) => String(v ?? "").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").trim().slice(0, n);
const line = (v, n) => str(v, n).replace(/\s+/g, " ");
const isId = (v, a, b) => typeof v === "string" && new RegExp(`^[a-z0-9]{${a},${b}}$`).test(v);

export function randomToken(n = 24) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return [...a].map((b) => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");
}

/** Keeps only what a sheet uses, bounded. Rows keep their id (so sign-ups stay on them) or get a new one. */
export function cleanSheet(s) {
  if (!s || typeof s !== "object") return null;
  const title = line(s.title, 120);
  if (!title) return null;
  const rows = [];
  const seen = new Set();
  for (const r of (Array.isArray(s.rows) ? s.rows : []).slice(0, MAX_ROWS)) {
    const text = line(r?.text, 160);
    if (!text) continue;
    let id = isId(r?.id, 6, 12) && !seen.has(r.id) ? r.id : randomToken(8);
    seen.add(id);
    if (r?.heading) { rows.push({ id, text, heading: true }); continue; }
    const need = Math.floor(Number(r?.need));
    rows.push({ id, text, need: need >= 1 && need <= 999 ? need : 0 }); // 0 = any number
  }
  return {
    title,
    details: str(s.details, 2000).replace(/\n{3,}/g, "\n\n"),
    rows,
    showNames: s.showNames !== false,
    open: s.open !== false,
  };
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** A whole sheet as one server sends it to the other, checked and bounded like everything else that comes in. */
export function cleanCopy(d, id) {
  if (!d || typeof d !== "object" || d.id !== id || !isId(d.key, 24, 24)) return null;
  const gone = [...new Set((Array.isArray(d.gone) ? d.gone : []).filter((g) => isId(g, 8, 8)))].slice(-MAX_GONE);
  if (d.deleted) return { id, key: d.key, deleted: true, changed: num(d.changed), gone: [] };
  const sheet = cleanSheet(d.sheet);
  if (!sheet) return null;
  const entries = [];
  const seen = new Set();
  for (const e of (Array.isArray(d.entries) ? d.entries : []).slice(0, MAX_ENTRIES)) {
    if (!isId(e?.id, 8, 8) || seen.has(e.id) || !isId(e?.row, 6, 12) || !isId(e?.token, 16, 32)) continue;
    const name = line(e.name, 60);
    if (!name) continue;
    seen.add(e.id);
    entries.push({ id: e.id, row: e.row, name, note: line(e.note, 200), token: e.token, at: num(e.at) });
  }
  return { id, key: d.key, sheet, sheetAt: num(d.sheetAt), entries, gone, changed: num(d.changed) };
}

/** Two copies of one sheet made into one. The same two copies give the same result, whichever comes first. */
export function mergeCopies(a, b) {
  if (!a) return b;
  if (!b) return a;
  const changed = Math.max(a.changed || 0, b.changed || 0);
  if (a.deleted || b.deleted) return { id: a.id, key: a.key, deleted: true, changed, gone: [] };
  const first = (b.sheetAt || 0) > (a.sheetAt || 0) || ((b.sheetAt || 0) === (a.sheetAt || 0) && JSON.stringify(b.sheet) > JSON.stringify(a.sheet)) ? b : a;
  const gone = [...new Set([...(a.gone || []), ...(b.gone || [])])].sort().slice(-MAX_GONE);
  const goneSet = new Set(gone);
  const rows = new Set(first.sheet.rows.filter((r) => !r.heading).map((r) => r.id));
  const byId = new Map();
  for (const e of [...a.entries, ...b.entries]) if (!byId.has(e.id) && !goneSet.has(e.id) && rows.has(e.row)) byId.set(e.id, e);
  const entries = [...byId.values()].sort((x, y) => x.at - y.at || (x.id < y.id ? -1 : 1)).slice(0, MAX_ENTRIES);
  return { id: a.id, key: a.key, sheet: first.sheet, sheetAt: first.sheetAt || 0, entries, gone, changed };
}

// what two copies must agree on (not the bookkeeping of who sent what when)
const content = (d) => (d ? JSON.stringify([d.deleted || false, d.key, d.sheet, d.sheetAt, d.entries, [...(d.gone || [])].sort()]) : "");

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (url.pathname === "/health" || url.pathname === "/api/health") return json({ ok: true });
    if (url.pathname === "/api/sheets" && req.method === "POST") {
      const body = await readJson(req);
      const sheet = cleanSheet(body);
      if (!sheet) return json({ error: "bad sheet" }, 400);
      for (let i = 0; i < 4; i++) {
        const id = randomToken(10);
        const r = await env.SHEETS.get(env.SHEETS.idFromName(id)).fetch("https://sheet/create", {
          method: "POST",
          body: JSON.stringify({ id, sheet }),
        });
        if (r.status !== 409) return r;
      }
      return json({ error: "busy" }, 503);
    }
    const m = url.pathname.match(/^\/api\/(sheets|sync)\/([a-z0-9]{10})(\/.*)?$/);
    if (m) return env.SHEETS.get(env.SHEETS.idFromName(m[2])).fetch(req);
    return new Response("not found", { status: 404, headers: cors });
  },
};

async function readJson(req, max = MAX_BODY) {
  const text = await req.text();
  if (text.length > max) return null;
  try { return JSON.parse(text); } catch { return null; }
}

export class Sheet {
  constructor(state, env = {}) {
    this.state = state;
    this.env = env;
    // { id, key, sheet, sheetAt, entries: [{id, row, name, note, token, at}], gone: [entry ids], changed,
    //   v (counts this server's changes), sent (the v the other server has), tries } or { id, key, deleted, ... }
    this.d = undefined;
  }

  get peer() {
    return this.env.PEER && this.env.SYNC_KEY ? String(this.env.PEER).replace(/\/$/, "") : "";
  }

  async load() {
    if (this.d === undefined) {
      this.loading ||= (async () => {
        const d = (await this.state.storage.get("d")) ?? null;
        if (this.d !== undefined) return;
        this.d = d;
        if (d && d.v === undefined) { // a sheet from before the second server: send it over
          Object.assign(d, { v: 1, sent: 0, sheetAt: d.changed || 0, gone: [] });
          await this.state.storage.put("d", d);
          await this.plan();
        }
      })();
      await this.loading;
    }
    return this.d;
  }

  /** A change made here: kept, and sent to the other server right after. */
  async save(touched = true) {
    if (touched) this.d.changed = Date.now();
    this.d.v = (this.d.v || 0) + 1;
    this.d.tries = 0;
    await this.state.storage.put("d", this.d);
    await this.plan();
  }

  /** The alarm: now if the other server hasn't got the latest copy, later if it's down, else when the sheet expires. */
  async plan() {
    const d = this.d;
    const due = this.peer && d.sent !== d.v ? Date.now() + (d.tries ? RETRY_MS[Math.min(d.tries, RETRY_MS.length) - 1] : 0) : d.changed + KEEP_MS;
    await this.state.storage.setAlarm(Math.min(due, d.changed + KEEP_MS));
  }

  async alarm() {
    await this.load();
    if (!this.d) return;
    if (Date.now() >= this.d.changed + KEEP_MS) {
      await this.state.storage.deleteAll();
      this.d = null;
      return;
    }
    if (this.peer && this.d.sent !== this.d.v) await this.send();
    await this.plan();
  }

  /** Sends this copy to the other server; it merges and answers with the result, which is taken in here. */
  async send() {
    const d = this.d;
    const v = d.v;
    try {
      const r = await fetch(`${this.peer}/api/sync/${d.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Sync-Key": this.env.SYNC_KEY },
        body: JSON.stringify(this.copy()),
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) throw new Error("sync " + r.status);
      const back = cleanCopy(await r.json(), d.id);
      if (!back) throw new Error("sync answer");
      if (this.d !== d || d.v !== v) return; // changed again meanwhile: the next send carries it
      const merged = mergeCopies(d, back);
      if (content(merged) !== content(d)) Object.assign(d, merged, { v: d.v + 1 });
      d.changed = Math.max(d.changed, back.changed);
      d.sent = d.v;
      d.tries = 0;
    } catch {
      d.tries = (d.tries || 0) + 1;
    }
    await this.state.storage.put("d", d);
  }

  copy() {
    const { v, sent, tries, ...c } = this.d;
    return c;
  }

  /** This server doesn't have the sheet: the other one may (it was made there, or before this one had a copy). */
  async ask(id) {
    if (!this.peer) return "none";
    try {
      const r = await fetch(`${this.peer}/api/sync/${id}`, { headers: { "X-Sync-Key": this.env.SYNC_KEY }, signal: AbortSignal.timeout(8000) });
      if (r.status === 404) return "none";
      if (!r.ok) return "unknown";
      const d = cleanCopy(await r.json(), id);
      if (!d) return "unknown";
      if (!(await this.load())) { // (nothing arrived meanwhile)
        this.d = { ...d, v: 1, sent: 1, tries: 0 };
        await this.state.storage.put("d", this.d);
        await this.plan();
      }
      return "got";
    } catch {
      return "unknown";
    }
  }

  isOwner(req) {
    const k = req.headers.get("X-Sheet-Key") || "";
    return !!this.d && !this.d.deleted && k.length === this.d.key.length && k === this.d.key;
  }

  isPeer(req) {
    const k = req.headers.get("X-Sync-Key") || "";
    return !!this.env.SYNC_KEY && k.length === this.env.SYNC_KEY.length && k === this.env.SYNC_KEY;
  }

  /** What a visitor sees: names only if the organizer shows them (the organizer always sees them). */
  view(req) {
    const owner = this.isOwner(req);
    const mine = new Set((req.headers.get("X-Sign-Tokens") || "").split(",").filter(Boolean));
    const d = this.d;
    return {
      id: d.id,
      owner,
      sheet: d.sheet,
      changed: d.changed,
      entries: d.entries.map((e) => {
        const isMine = mine.has(e.token);
        const show = owner || isMine || d.sheet.showNames;
        return { id: e.id, row: e.row, name: show ? e.name : "", note: show ? e.note : "", mine: isMine, at: owner ? e.at : undefined };
      }),
    };
  }

  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/create") {
      if (await this.load()) return json({ error: "taken" }, 409);
      const { id, sheet } = await req.json();
      this.d = { id, key: randomToken(24), sheet, sheetAt: Date.now(), entries: [], gone: [], sent: 0 };
      await this.save();
      return json({ id, key: this.d.key });
    }
    const id = url.pathname.split("/")[3];

    // the other server
    if (url.pathname.startsWith("/api/sync/")) {
      if (!this.isPeer(req)) return json({ error: "not yours" }, 403);
      await this.load();
      if (req.method === "GET") return this.d ? json(this.copy()) : json({ error: "gone" }, 404);
      if (req.method !== "POST") return json({ error: "not found" }, 404);
      const got = cleanCopy(await readJson(req, MAX_SYNC), id);
      if (!got) return json({ error: "bad copy" }, 400);
      const merged = mergeCopies(this.d, got);
      if (!this.d || content(merged) !== content(this.d)) {
        const v = (this.d?.v || 0) + 1;
        this.d = { ...merged, v, sent: v, tries: 0 }; // the sender gets this answer: nothing to send back
        await this.state.storage.put("d", this.d);
      } else this.d.changed = Math.max(this.d.changed, got.changed);
      await this.plan();
      return json(this.copy());
    }

    if (!(await this.load())) {
      const a = await this.ask(id);
      if (a === "unknown") return json({ error: "unknown" }, 503); // maybe it's on the other server: the app asks there
      if (a === "none") return json({ error: "gone" }, 404);
    }
    const d = this.d;
    if (d.deleted) return json({ error: "gone" }, 404);
    const rest = url.pathname.replace(/^\/api\/sheets\/[a-z0-9]{10}/, "") || "/";

    if (rest === "/" && req.method === "GET") return json(this.view(req));

    if (rest === "/" && req.method === "PUT") {
      if (!this.isOwner(req)) return json({ error: "not yours" }, 403);
      const sheet = cleanSheet(await readJson(req));
      if (!sheet) return json({ error: "bad sheet" }, 400);
      const ids = new Set(sheet.rows.filter((r) => !r.heading).map((r) => r.id));
      d.sheet = sheet;
      d.sheetAt = Math.max(Date.now(), (d.sheetAt || 0) + 1);
      d.entries = d.entries.filter((e) => ids.has(e.row));
      await this.save();
      return json(this.view(req));
    }

    if (rest === "/" && req.method === "DELETE") {
      if (!this.isOwner(req)) return json({ error: "not yours" }, 403);
      // kept as "deleted" (a few bytes) until it expires, so the other server's copy can't bring it back
      this.d = { id: d.id, key: d.key, deleted: true, changed: d.changed, gone: [], v: d.v, sent: d.sent };
      await this.save();
      return json({ ok: true });
    }

    if (rest === "/signups" && req.method === "POST") {
      const b = await readJson(req);
      // the app names the sign-up itself, so the same sign-up sent again (to the other server, after no answer) is one
      if (isId(b?.id, 8, 8)) {
        const again = d.entries.find((e) => e.id === b.id);
        if (again && again.token === b.token) return json({ token: again.token, view: this.view(withToken(req, again.token)) });
        if (again || d.gone.includes(b.id)) b.id = null;
      }
      const row = d.sheet.rows.find((r) => r.id === b?.row && !r.heading);
      const name = line(b?.name, 60);
      if (!row || !name) return json({ error: "bad sign-up" }, 400);
      const owner = this.isOwner(req);
      if (!d.sheet.open && !owner) return json({ error: "closed" }, 409);
      if (row.need && d.entries.filter((e) => e.row === row.id).length >= row.need) return json({ error: "full" }, 409);
      if (d.entries.length >= MAX_ENTRIES) return json({ error: "full" }, 409);
      const token = isId(b?.token, 16, 32) ? b.token : randomToken(20);
      d.entries.push({ id: isId(b?.id, 8, 8) ? b.id : randomToken(8), row: row.id, name, note: line(b?.note, 200), token, at: Date.now() });
      await this.save();
      return json({ token, view: this.view(withToken(req, token)) });
    }

    const del = rest.match(/^\/signups\/([a-z0-9]{8})$/);
    if (del && req.method === "DELETE") {
      const e = d.entries.find((x) => x.id === del[1]);
      if (!e) return json(this.view(req));
      const mine = (req.headers.get("X-Sign-Tokens") || "").split(",").includes(e.token);
      if (!mine && !this.isOwner(req)) return json({ error: "not yours" }, 403);
      d.entries = d.entries.filter((x) => x !== e);
      d.gone = [...d.gone, e.id].slice(-MAX_GONE);
      await this.save();
      return json(this.view(req));
    }

    return json({ error: "not found" }, 404);
  }
}

function withToken(req, token) {
  const h = new Headers(req.headers);
  const have = (h.get("X-Sign-Tokens") || "").split(",").filter(Boolean);
  h.set("X-Sign-Tokens", [...have, token].join(","));
  return new Request(req.url, { headers: h });
}
