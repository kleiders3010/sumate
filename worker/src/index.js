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

import { shut, LOCKS, MAX_QTY, qtyOf, mostFor, canSelfIn } from "../../web/cal.js"; // (on the game host: ./cal.mjs, see kinetic/pack.mjs)

const KEEP_MS = 90 * 24 * 3600 * 1000;
const MAX_ROWS = 200;
const MAX_ENTRIES = 3000;
const MAX_GONE = 3000;
const MAX_BODY = 64 * 1024;
const MAX_SYNC = 1024 * 1024; // a whole sheet with its sign-ups
// the organizer's own questions on signing up (like SignUpGenius' custom questions): a short answer or one of a few
// choices, each required or not; the answers go to the organizer (and the person who gave them), never to everyone
const MAX_ASKS = 5;
const MAX_OPTS = 8;
const ANS_LEN = 200;
// a line may say when (like SignUpGenius' dates and times): a day, a start and an end time, as the organizer wrote them,
// in the organizer's time zone (kept with the sheet so a calendar gets the right moment anywhere)
const isDay = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v + "T00:00:00Z"))
  && new Date(v + "T00:00:00Z").toISOString().startsWith(v);
const isTime = (v) => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const isMoment = (v) => Number.isInteger(v) && v > 1e12 && v < 1e14; // a moment (ms), for opening and closing
function isZone(v) {
  if (typeof v !== "string" || !/^[A-Za-z0-9_+\-/]{1,64}$/.test(v)) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: v }); return true; } catch { return false; }
}
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
// A name as others see it (audit R17): no control characters, no marks that flip the text's direction or hide in
// it (so "Ana" can't be made to look like someone else), spaces folded. The joiner inside an emoji (a family, a
// rainbow flag) stays. Same rule in Ronda, Juntos and Sumate.
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u115f\u1160\u180e\u200b\u200c\u200e\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\u3164\ufeff\uffa0\ufff9-\ufffb]/g;
const LONE_JOINER = /(?<![\p{Extended_Pictographic}\p{Emoji_Modifier}\ufe0f])\u200d|\u200d(?!\p{Extended_Pictographic})/gu;
export const cleanName = (v, n) => String(v ?? "").replace(/\s+/g, " ").replace(INVISIBLE, "").replace(LONE_JOINER, "").replace(/ {2,}/g, " ").trim().slice(0, n);
const line = (v, n) => cleanName(str(v, n + 20), n);
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
    const row = { id, text, need: need >= 1 && need <= 999 ? need : 0 }; // 0 = any number
    if (isDay(r.date)) row.date = r.date;
    if (isTime(r.start)) row.start = r.start;
    if (row.start && isTime(r.end) && r.end !== r.start) row.end = r.end; // earlier than the start = the next day
    rows.push(row);
  }
  const asks = [];
  const askIds = new Set();
  for (const q of (Array.isArray(s.asks) ? s.asks : []).slice(0, 4 * MAX_ASKS)) {
    const text = line(q?.text, 120);
    if (!text) continue;
    if (asks.length >= MAX_ASKS) break;
    const id = isId(q?.id, 6, 12) && !askIds.has(q.id) ? q.id : randomToken(8);
    askIds.add(id);
    const opts = [...new Set((Array.isArray(q.opts) ? q.opts : []).map((o) => line(o, 60)).filter(Boolean))].slice(0, MAX_OPTS);
    asks.push({ id, text, req: !!q.req, opts }); // no choices = a short answer
  }
  const opens = isMoment(s.opens) ? s.opens : 0;
  const closes = isMoment(s.closes) && s.closes > opens ? s.closes : 0;
  return {
    title,
    details: str(s.details, 2000).replace(/\n{3,}/g, "\n\n"),
    rows,
    showNames: s.showNames !== false,
    open: s.open !== false,
    asks,
    place: line(s.place, 120),
    tz: isZone(s.tz) ? s.tz : "",
    ...(opens ? { opens } : {}),
    ...(closes ? { closes } : {}),
    ...(LOCKS.includes(s.lock) ? { lock: s.lock } : {}), // minutes before each line with a day starts
    final: !!s.final, // once sign-ups are shut, people can't remove themselves either (the organizer still can)
    // a waiting list for full lines (like SignUpGenius' waitlists): who signs up after a line is full waits in order,
    // and when someone leaves, the first one waiting is in by itself (nobody has to do anything)
    wait: !!s.wait,
    qty: !!s.qty, // people may take more than one spot of a line at once ("2 dozen cookies")
    ...(perN(s.per) ? { per: perN(s.per) } : {}), // the most one person may take on the whole sheet
    ...(perN(s.perRow) ? { perRow: perN(s.perRow) } : {}), // ... and on one line
    selfIn: !!s.selfIn, // people can check themselves in when they arrive (from the line's day)
  };
}
const perN = (v) => (Number.isInteger(v) && v >= 1 && v <= MAX_QTY ? v : 0);

/** A sign-up's answers to the sheet's questions: only questions it has, a choice only from its choices. */
export function cleanAnswers(a, asks) {
  const out = {};
  for (const q of asks || []) {
    let v = line(a?.[q.id], ANS_LEN);
    if (q.opts.length && !q.opts.includes(v)) v = "";
    if (v) out[q.id] = v;
  }
  return out;
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
    const ans = cleanAnswers(e.ans, sheet.asks);
    entries.push({ id: e.id, row: e.row, name, note: line(e.note, 200), token: e.token, at: num(e.at), ...(Object.keys(ans).length ? { ans } : {}),
      ...(qtyOf(e) > 1 ? { qty: Math.min(MAX_QTY, qtyOf(e)) } : {}), ...hereOf(e), ...(e.walk ? { walk: 1 } : {}),
      ...(num(e.editAt) > 0 ? { editAt: num(e.editAt) } : {}) });
  }
  const door = isId(d.door, 24, 24) ? d.door : "";
  return { id, key: d.key, sheet, sheetAt: num(d.sheetAt), entries, gone, changed: num(d.changed), door, doorAt: num(d.doorAt) };
}

/** A sign-up's check-in: when it was marked (0 = not here) and when that last changed (the later change wins). */
const hereOf = (e) => (num(e.hereAt) > 0 ? { here: Math.max(0, num(e.here)), hereAt: num(e.hereAt) } : {});

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
  for (const e of [...a.entries, ...b.entries]) {
    if (goneSet.has(e.id)) continue;
    const had = byId.get(e.id);
    if (!had) { byId.set(e.id, e); continue; }
    // the same sign-up on both: its later change (moved, edited) wins, and on its own the later check-in change (marked
    // or unmarked), the same whichever comes first
    const body = laterEdit(had, e);
    const hc = (e.hereAt || 0) > (had.hereAt || 0) || ((e.hereAt || 0) === (had.hereAt || 0) && (e.here || 0) > (had.here || 0)) ? e : had;
    const { here, hereAt, ...rest } = body;
    byId.set(e.id, { ...rest, ...hereOf(hc) });
  }
  const entries = [...byId.values()].filter((e) => rows.has(e.row)).sort((x, y) => x.at - y.at || (x.id < y.id ? -1 : 1)).slice(0, MAX_ENTRIES);
  // the check-in link: the one made (or turned off) last
  const dk = (b.doorAt || 0) > (a.doorAt || 0) || ((b.doorAt || 0) === (a.doorAt || 0) && (b.door || "") > (a.door || "")) ? b : a;
  return { id: a.id, key: a.key, sheet: first.sheet, sheetAt: first.sheetAt || 0, entries, gone, changed, door: dk.door || "", doorAt: dk.doorAt || 0 };
}

/** Of two copies of one sign-up, the one changed last (the same whichever comes first). */
function laterEdit(x, y) {
  const ex = x.editAt || 0, ey = y.editAt || 0;
  if (ex !== ey) return ey > ex ? y : x;
  return JSON.stringify(y) > JSON.stringify(x) ? y : x;
}

// what two copies must agree on (not the bookkeeping of who sent what when)
const content = (d) => (d ? JSON.stringify([d.deleted || false, d.key, d.sheet, d.sheetAt, d.entries, [...(d.gone || [])].sort(), d.door || "", d.doorAt || 0]) : "");

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
    if (env.TEST_LOCAL_CSP === "1" && env.ASSETS) return testPage(req, env);
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

  /** A helper with the check-in link (or the organizer): may mark who came and add someone who just turned up. */
  isDoor(req) {
    const k = req.headers.get("X-Door-Key") || "";
    return this.isOwner(req) || (!!this.d?.door && k.length === this.d.door.length && k === this.d.door);
  }

  isPeer(req) {
    const k = req.headers.get("X-Sync-Key") || "";
    return !!this.env.SYNC_KEY && k.length === this.env.SYNC_KEY.length && k === this.env.SYNC_KEY;
  }

  /** What a visitor sees: names only if the organizer shows them (the organizer always sees them). */
  view(req) {
    const owner = this.isOwner(req);
    const door = this.isDoor(req);
    const mine = new Set((req.headers.get("X-Sign-Tokens") || "").split(",").filter(Boolean));
    const d = this.d;
    const waits = waitingOf(d);
    return {
      id: d.id,
      owner,
      ...(door ? { door: true } : {}), // checking people in: names shown (to mark them), answers not
      ...(owner && d.door ? { doorKey: d.door } : {}), // the organizer can share (or replace) the check-in link
      sheet: d.sheet,
      changed: d.changed,
      now: Date.now(), // the app opens and closes by the server's clock, not the device's
      entries: d.entries.map((e) => {
        const isMine = mine.has(e.token);
        const show = door || isMine || d.sheet.showNames;
        // the answers to the organizer's questions: only the organizer and the person who gave them see them
        const ans = owner || isMine ? cleanAnswers(e.ans, d.sheet.asks) : undefined;
        return { id: e.id, row: e.row, name: show ? e.name : "", note: show ? e.note : "", mine: isMine, at: owner ? e.at : undefined, ans,
          ...(qtyOf(e) > 1 ? { qty: qtyOf(e) } : {}),
          ...(waits.has(e.id) ? { wait: waits.get(e.id) } : {}),
          // pinned: who came is seen by the organizer, the check-in helpers and the person themselves, not everyone
          ...((door || isMine) && e.here ? { here: e.here } : {}) };
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
      const staff = this.isDoor(req); // the organizer or a check-in helper: someone who just turned up is added
      const why = shut(d.sheet, row);
      if (why && !staff) return json({ error: why }, 409);
      // how many spots: one, or (when the sheet lets people) up to what the line needs
      let qty = d.sheet.qty ? Math.max(1, Math.min(MAX_QTY, Math.floor(Number(b?.qty)) || 1)) : 1;
      if (row.need) qty = Math.min(qty, row.need);
      const taken = d.entries.filter((e) => e.row === row.id).reduce((n, e) => n + qtyOf(e), 0);
      if (row.need && !d.sheet.wait && !(staff && b?.here) && taken + qty > row.need) return json({ error: taken >= row.need ? "full" : "few" }, 409);
      const token = isId(b?.token, 16, 32) ? b.token : randomToken(20);
      // pinned: the most one person may take (SignUpGenius' quantity limits); the organizer adding someone is not held to it
      if (!staff && mostFor(d.sheet, row, d.entries.filter((e) => e.token === token)) < qty) return json({ error: "limit" }, 409);
      if (d.entries.length >= MAX_ENTRIES) return json({ error: "full" }, 409);
      const asks = d.sheet.asks || [];
      const ans = cleanAnswers(b?.ans, asks);
      // pinned: a required question must be answered, except when the organizer adds someone
      if (!staff && asks.some((q) => q.req && !ans[q.id])) return json({ error: "answer" }, 400);
      const now = Date.now();
      d.entries.push({ id: isId(b?.id, 8, 8) ? b.id : randomToken(8), row: row.id, name, note: line(b?.note, 200), token, at: now,
        ...(Object.keys(ans).length ? { ans } : {}), ...(qty > 1 ? { qty } : {}), ...(staff && b?.here ? { here: now, hereAt: now, walk: 1 } : {}) });
      await this.save();
      return json({ token, view: this.view(withToken(req, token)) });
    }

    const hm = rest.match(/^\/signups\/([a-z0-9]{8})\/here$/);
    if (hm && req.method === "POST") {
      const e = d.entries.find((x) => x.id === hm[1]);
      if (!e) return json({ error: "gone" }, 404);
      const mine = (req.headers.get("X-Sign-Tokens") || "").split(",").includes(e.token);
      const row = d.sheet.rows.find((r) => r.id === e.row);
      // pinned: the organizer and check-in helpers mark anyone; a person only themselves, when the sheet lets them
      if (!this.isDoor(req) && !(mine && canSelfIn(d.sheet, row))) return json({ error: mine ? "notday" : "not yours" }, 403);
      if (waitingOf(d).has(e.id)) return json({ error: "waiting" }, 409); // on the waiting list: not in yet
      const b = await readJson(req);
      const on = b?.on !== false;
      if (!!e.here !== on) {
        const now = Math.max(Date.now(), (e.hereAt || 0) + 1);
        e.here = on ? now : 0;
        e.hereAt = now;
        await this.save();
      }
      return json(this.view(req));
    }

    if (rest === "/door" && (req.method === "POST" || req.method === "DELETE")) {
      if (!this.isOwner(req)) return json({ error: "not yours" }, 403);
      // a new check-in link (the old one stops working), or none
      d.door = req.method === "POST" ? randomToken(24) : "";
      d.doorAt = Math.max(Date.now(), (d.doorAt || 0) + 1);
      await this.save();
      return json(this.view(req));
    }

    // Change a sign-up (like SignUpGenius' Edit / Swap next to your sign-up, and the organizer's Move): the person
    // changes their name, note, answers or how many, or moves to another line with room; the organizer moves anyone,
    // and onto a full line by trading places with someone there. Name, note and answers go along.
    const ch = rest.match(/^\/signups\/([a-z0-9]{8})$/);
    if (ch && req.method === "POST") {
      const e = d.entries.find((x) => x.id === ch[1]);
      if (!e) return json({ error: "nosign" }, 404);
      const tokens = (req.headers.get("X-Sign-Tokens") || "").split(",");
      const owner = this.isOwner(req);
      if (!owner && !tokens.includes(e.token)) return json({ error: "not yours" }, 403);
      const b = await readJson(req);
      const from = d.sheet.rows.find((r) => r.id === e.row);
      const to = b?.row === undefined ? from : d.sheet.rows.find((r) => r.id === b.row && !r.heading);
      if (!to) return json({ error: "bad sign-up" }, 400);
      const moved = to.id !== e.row;
      const name = b?.name === undefined ? e.name : line(b.name, 60);
      if (!name) return json({ error: "bad sign-up" }, 400);
      const note = b?.note === undefined ? e.note : line(b.note, 200);
      const asks = d.sheet.asks || [];
      const ans = b?.ans === undefined ? cleanAnswers(e.ans, asks) : cleanAnswers(b.ans, asks);
      let qty = b?.qty === undefined ? qtyOf(e) : d.sheet.qty ? Math.max(1, Math.min(MAX_QTY, Math.floor(Number(b.qty)) || 1)) : 1;
      if (to.need) qty = Math.min(qty, to.need);
      const now = Date.now();
      const stamp = (x) => Math.max(now, (x.editAt || 0) + 1);
      const other = isId(b?.with, 8, 8) ? d.entries.find((x) => x.id === b.with && x !== e) : null;
      if (b?.with !== undefined && b.with !== null) {
        // pinned: trading places is the organizer's (two people's sign-ups change), with someone on another line
        if (!owner) return json({ error: "not yours" }, 403);
        if (!other || other.row !== to.id || !moved) return json({ error: "nosign" }, 404);
        const waits = waitingOf(d);
        if (waits.has(e.id) !== waits.has(other.id)) return json({ error: "waiting" }, 409);
        // each line after the trade: no more over what it needs than it already was
        const total = (row) => d.entries.filter((x) => x.row === row.id).reduce((n, x) => n + qtyOf(x), 0);
        const fits = (row, out, inn) => !row?.need || total(row) - out + inn <= Math.max(row.need, total(row));
        if (!fits(to, qtyOf(other), qty) || !fits(from, qtyOf(e), qtyOf(other))) return json({ error: "few" }, 409);
        const [ea, oa] = [e.at, other.at];
        Object.assign(other, { row: e.row, at: ea, editAt: stamp(other) }, other.here ? { here: 0, hereAt: Math.max(now, (other.hereAt || 0) + 1) } : {});
        delete other.walk;
        Object.assign(e, { row: to.id, at: oa, name, note, editAt: stamp(e) }, qty > 1 ? { qty } : {}, e.here ? { here: 0, hereAt: Math.max(now, (e.hereAt || 0) + 1) } : {});
        if (qty <= 1) delete e.qty;
        if (Object.keys(ans).length) e.ans = ans; else delete e.ans;
        delete e.walk;
        await this.save();
        return json(this.view(req));
      }
      if (!owner) {
        // pinned: a final sheet keeps its list once sign-ups are shut; a person moves only to a line still taking sign-ups
        if (d.sheet.final && shut(d.sheet, from)) return json({ error: "final" }, 409);
        if (moved || qty > qtyOf(e)) { const why = shut(d.sheet, to); if (why) return json({ error: why }, 409); }
        // pinned: the most one person may take counts their other sign-ups, not this one
        if ((moved || qty > qtyOf(e)) && mostFor(d.sheet, to, d.entries.filter((x) => x !== e && tokens.includes(x.token))) < qty) return json({ error: "limit" }, 409);
        if (asks.some((q) => q.req && !ans[q.id])) return json({ error: "answer" }, 400);
      }
      // pinned: moving (or taking more) needs room there: nobody is pushed onto a waiting list, nor jumps one
      if (to.need && (moved || qty > qtyOf(e))) {
        const taken = d.entries.filter((x) => x.row === to.id && x !== e).reduce((n, x) => n + qtyOf(x), 0);
        if (taken + qty > to.need && !(!moved && waitingOf(d).has(e.id))) return json({ error: taken >= to.need ? "full" : "few" }, 409);
      }
      if (name === e.name && note === e.note && JSON.stringify(ans) === JSON.stringify(cleanAnswers(e.ans, asks)) && qty === qtyOf(e) && !moved) return json(this.view(req));
      Object.assign(e, { name, note, editAt: stamp(e) });
      if (qty > 1) e.qty = qty; else delete e.qty;
      if (Object.keys(ans).length) e.ans = ans; else delete e.ans;
      if (moved) {
        e.row = to.id;
        e.at = now; // in the new line's order from now
        delete e.walk;
        if (e.here || e.hereAt) { e.here = 0; e.hereAt = Math.max(now, (e.hereAt || 0) + 1); } // checked in for the old line, not this one
      }
      await this.save();
      return json(this.view(req));
    }

    const del = rest.match(/^\/signups\/([a-z0-9]{8})$/);
    if (del && req.method === "DELETE") {
      const e = d.entries.find((x) => x.id === del[1]);
      if (!e) return json(this.view(req));
      const mine = (req.headers.get("X-Sign-Tokens") || "").split(",").includes(e.token);
      if (!mine && !this.isOwner(req)) return json({ error: "not yours" }, 403);
      const row = d.sheet.rows.find((r) => r.id === e.row);
      // pinned: a final sheet keeps its list once sign-ups are shut; the organizer can still remove anyone
      if (d.sheet.final && !this.isOwner(req) && shut(d.sheet, row)) return json({ error: "final" }, 409);
      d.entries = d.entries.filter((x) => x !== e);
      d.gone = [...d.gone, e.id].slice(-MAX_GONE);
      await this.save();
      return json(this.view(req));
    }

    return json({ error: "not found" }, 404);
  }
}

/** Who is waiting, and where in line (1 = next): on a line with a number, in the order they signed up, the first ones
 * whose spots fit are in and everyone from the first that doesn't fit on waits (so nobody skips the line). Worked out from the sign-ups each time, so leaving, a bigger number, or the two servers' copies
 * coming together all move people in by themselves, the same way on both servers. */
export function waitingOf(d) {
  const out = new Map();
  const byRow = new Map();
  for (const e of [...d.entries].sort((x, y) => (x.at || 0) - (y.at || 0) || (x.id < y.id ? -1 : 1))) {
    if (!byRow.has(e.row)) byRow.set(e.row, []);
    byRow.get(e.row).push(e);
  }
  for (const r of d.sheet.rows) {
    if (r.heading || !r.need) continue;
    let used = 0, n = 0;
    for (const e of byRow.get(r.id) || []) {
      if (!n && used + qtyOf(e) <= r.need) used += qtyOf(e);
      else if (e.walk) continue; // pinned: someone added at the check-in on a full line is extra: never waiting, nobody pushed out
      else out.set(e.id, ++n);
    }
  }
  return out;
}

function withToken(req, token) {
  const h = new Headers(req.headers);
  const have = (h.get("X-Sign-Tokens") || "").split(",").filter(Boolean);
  h.set("X-Sign-Tokens", [...have, token].join(","));
  return new Request(req.url, { headers: h });
}

const LOCAL_CSP = " http://127.0.0.1:* ws://127.0.0.1:* http://localhost:* ws://localhost:*";
// tests only (wrangler.test.toml: every request passes the Worker): the pages as shipped, plus this computer in their
// CSP so test servers on other local ports can be reached (safety round 2, J15). Never set when deployed.
async function testPage(req, env) {
  const r = await env.ASSETS.fetch(req);
  if (!(r.headers.get("content-type") || "").includes("text/html")) return r;
  const html = (await r.text()).replace(/(connect-src [^;"]*)/, (m) => m + LOCAL_CSP);
  const h = new Headers(r.headers);
  h.delete("content-length");
  return new Response(html, { status: r.status, headers: h });
}
