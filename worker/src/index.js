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
// One size budget from door to disk (safety round 3, S2), all in bytes: a sheet takes no change that makes it bigger
// than MAX_BYTES; two such copies merged (each server took changes while the copies were apart) still fit MAX_SYNC,
// the copy the other server accepts (kinetic/server.mjs reads the same number), and that fits Cloudflare's 2 MB per
// stored value.
const MAX_BYTES = 500 * 1024;
const MAX_SYNC = 1536 * 1024;
// at most this as Cloudflare stores it (2 bytes a UTF-16 unit at worst), so two full copies merged stay under 2 MB
const MAX_STORED = 900 * 1024;
// (a module of a Worker may export only functions and classes)
export const sizes = () => ({ MAX_BYTES, MAX_SYNC, MAX_STORED, MAX_BODY });
// sign-ups one network may add to one sheet in an hour (the organizer is not counted; check-in helpers are, S2-7b)
// 500: a whole school or event on one network signs up in an hour (second-pass S2-4: 100 stopped a school sheet)
const PER_NET_HOUR = 500;
const AHEAD_MS = 5 * 60e3; // a time from the other server more than this ahead of this one's clock is taken as now + this
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
// the other server is down: try again after these. Quick at first, so the copies agree soon after a short outage; then
// slower, down to 4 tries a day, so a copy the other server won't take can't spend the day's budget (second-pass S2-1:
// it was every 5 minutes for 90 days). A new change on either side sends again at once whatever the count.
const RETRY_MS = [15e3, 30e3, 60e3, 2 * 60e3, 5 * 60e3, 15 * 60e3, 60 * 60e3, 6 * 3600e3];

const cors = {
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*", // the copy of the site on GitHub Pages, and the app on either server
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE",
  // every header the app sends, or the browser refuses it on the cross-site way to the other server (round 3, S8)
  "Access-Control-Allow-Headers": "Content-Type, X-Sheet-Key, X-Door-Key, X-Sign-Tokens, X-Sign-Old",
  "Access-Control-Max-Age": "86400",
};
const json = (data, status = 200) => Response.json(data, { status, headers: cors });
const bytes = (s) => new TextEncoder().encode(s).length;
/** Two secrets compared in a time that doesn't depend on where they differ (round 3, S13d). */
export function same(a, b) {
  a = String(a || ""); b = String(b || "");
  if (!a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const str = (v, n) => String(v ?? "").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").trim().slice(0, n);
// A name as others see it (audit R17): no control characters, no marks that flip the text's direction or hide in
// it (so "Ana" can't be made to look like someone else), spaces folded. The joiner inside an emoji (a family, a
// rainbow flag) stays. Same rule in Ronda, Juntos and Sumate.
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u00ad\u034f\u061c\u115f\u1160\u180e\u200b\u200c\u200e\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\u2066-\u206f\u2800\u3164\ufeff\uffa0\ufff9-\ufffb]|\udb40[\udc00-\udc7f]/g;
const LONE_JOINER = /(?<![\p{Extended_Pictographic}\p{Emoji_Modifier}\ufe0f])\u200d|\u200d(?!\p{Extended_Pictographic})/gu;
export const cleanName = (v, n) => String(v ?? "").replace(/\s+/g, " ").replace(INVISIBLE, "").replace(LONE_JOINER, "").replace(/ {2,}/g, " ").trim().slice(0, n);
const line = (v, n) => cleanName(str(v, n + 20), n);
// Text of several lines that others see (the details): each line through the name cleaner, the line breaks kept, and
// U+2028, U+2029 and U+0085 taken as line breaks too (some calendar programs do; second-pass S2-12)
export const cleanText = (v, n) => String(v ?? "").slice(0, n + 500).split(/\r\n|[\n\r\u2028\u2029\u0085]/).map((l) => cleanName(l, n)).join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, n);
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
    details: cleanText(s.details, 2000),
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
    // only the answer's own keys: a question with the id "constructor" never reads Object's (round 3, S13a)
    let v = a && typeof a === "object" && Object.hasOwn(a, q.id) ? line(a[q.id], ANS_LEN) : "";
    if (q.opts.length && !q.opts.includes(v)) v = "";
    if (v) out[q.id] = v;
  }
  return out;
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// A removed sign-up is remembered as "id~when" (when in base 36; a bare id is from before and counts as oldest), so
// both servers trim the list by age, the same way (round 3, S13b: trimmed by alphabet, an old removal came back).
const GONE = /^[a-z0-9]{8}(~[0-9a-z]{1,12})?$/;
export const goneId = (g) => g.slice(0, 8);
const goneAt = (g) => (g.length > 9 ? parseInt(g.slice(9), 36) || 0 : 0);
export const goneMark = (id, t = Date.now()) => id + "~" + t.toString(36);
const goneHas = (d, id) => (d.gone || []).some((g) => goneId(g) === id);
/** One list of removed sign-ups from any number of lists: one per id (its latest), oldest first, the newest kept. */
export function goneOf(...lists) {
  const by = new Map();
  for (const g of lists.flat()) {
    if (typeof g !== "string" || !GONE.test(g)) continue;
    const id = goneId(g), had = by.get(id);
    if (!had || goneAt(g) > goneAt(had)) by.set(id, g);
  }
  return [...by.values()].sort((x, y) => goneAt(x) - goneAt(y) || (x < y ? -1 : 1)).slice(-MAX_GONE);
}

/** A whole sheet as one server sends it to the other, checked and bounded like everything else that comes in. Times
 * are taken as at most a few minutes ahead of this server's clock (round 3, S11: a copy dated years ahead kept a
 * sheet for ever and reordered a waiting list). */
export function cleanCopy(d, id) {
  if (!d || typeof d !== "object" || d.id !== id || !isId(d.key, 24, 24)) return null;
  const cap = Date.now() + AHEAD_MS;
  const tm = (v) => Math.min(Math.max(0, num(v)), cap);
  const gone = goneOf(Array.isArray(d.gone) ? d.gone : []).map((g) => (goneAt(g) > cap ? goneMark(goneId(g), cap) : g));
  const keyAt = tm(d.keyAt);
  if (d.deleted) return { id, key: d.key, ...(keyAt ? { keyAt } : {}), deleted: true, changed: tm(d.changed), gone: [] };
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
    entries.push({ id: e.id, row: e.row, name, note: line(e.note, 200), token: e.token, at: tm(e.at), ...(Object.keys(ans).length ? { ans } : {}),
      ...(qtyOf(e) > 1 ? { qty: Math.min(MAX_QTY, qtyOf(e)) } : {}), ...hereOf(e, tm), ...(e.walk ? { walk: 1 } : {}), ...(e.byDoor ? { byDoor: 1 } : {}),
      ...(tm(e.editAt) > 0 ? { editAt: tm(e.editAt) } : {}) });
  }
  const door = isId(d.door, 24, 24) ? d.door : "";
  return { id, key: d.key, ...(keyAt ? { keyAt } : {}), sheet, sheetAt: tm(d.sheetAt), entries, gone, changed: tm(d.changed), door, doorAt: tm(d.doorAt) };
}

/** A sign-up's check-in: when it was marked (0 = not here) and when that last changed (the later change wins). */
const hereOf = (e, tm = num) => (tm(e.hereAt) > 0 ? { here: Math.max(0, tm(e.here)), hereAt: tm(e.hereAt) } : {});

// A sign-up id the other copy holds for someone else (another device's code) gets a new id of its own, made from the
// id and the code, so both servers make the same one (round 3, S6). Not a secret, only different.
function otherId(id, token) {
  let h = 2166136261;
  for (const c of id + "|" + token) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  let out = "";
  for (let i = 0; i < 8; i++) { out += "abcdefghijkmnpqrstuvwxyz23456789"[h % 32]; h = Math.imul(h ^ (i + 7), 2654435761) >>> 0; }
  return out;
}

/** Two copies of one sheet made into one. The same two copies give the same result, whichever comes first. */
export function mergeCopies(a, b) {
  if (!a) return b;
  if (!b) return a;
  const changed = Math.max(a.changed || 0, b.changed || 0);
  // the organizer link: the one made last (round 3, S7: it can be replaced)
  const kk = (b.keyAt || 0) > (a.keyAt || 0) || ((b.keyAt || 0) === (a.keyAt || 0) && b.key > a.key) ? b : a;
  const keys = { key: kk.key, ...(kk.keyAt ? { keyAt: kk.keyAt } : {}) };
  if (a.deleted || b.deleted) return { id: a.id, ...keys, deleted: true, changed, gone: [] };
  const first = (b.sheetAt || 0) > (a.sheetAt || 0) || ((b.sheetAt || 0) === (a.sheetAt || 0) && JSON.stringify(b.sheet) > JSON.stringify(a.sheet)) ? b : a;
  const gone = goneOf(a.gone || [], b.gone || []);
  const goneSet = new Set(gone.map(goneId));
  const rows = new Set(first.sheet.rows.filter((r) => !r.heading).map((r) => r.id));
  const byId = new Map();
  const add = (e, depth = 0) => {
    if (goneSet.has(e.id)) return;
    const had = byId.get(e.id);
    if (!had) return void byId.set(e.id, e);
    if (had.token !== e.token) {
      // two devices' sign-ups under one id: two sign-ups. The earlier keeps the id (by time, then code: the same on
      // both servers), the other moves to an id made from both, which the other server makes the same way
      if (depth > 2) return;
      const [keep, move] = (e.at || 0) < (had.at || 0) || ((e.at || 0) === (had.at || 0) && e.token < had.token) ? [e, had] : [had, e];
      byId.set(e.id, keep);
      return add({ ...move, id: otherId(move.id, move.token) }, depth + 1);
    }
    // the same sign-up on both: its later change (moved, edited) wins, and on its own the later check-in change (marked
    // or unmarked), the same whichever comes first
    const body = laterEdit(had, e);
    const hc = (e.hereAt || 0) > (had.hereAt || 0) || ((e.hereAt || 0) === (had.hereAt || 0) && (e.here || 0) > (had.here || 0)) ? e : had;
    const { here, hereAt, ...rest } = body;
    byId.set(e.id, { ...rest, ...hereOf(hc) });
  };
  for (const e of [...a.entries, ...b.entries]) add(e);
  const asks = first.sheet.asks || [];
  const entries = [...byId.values()].filter((e) => rows.has(e.row)).sort((x, y) => x.at - y.at || (x.id < y.id ? -1 : 1)).slice(0, MAX_ENTRIES)
    .map((e) => { // answers only to questions the sheet still has (round 3, S13c)
      if (!e.ans) return e;
      const ans = cleanAnswers(e.ans, asks);
      const { ans: _, ...rest } = e;
      return Object.keys(ans).length ? { ...rest, ans } : rest;
    });
  // the check-in link: the one made (or turned off) last
  const dk = (b.doorAt || 0) > (a.doorAt || 0) || ((b.doorAt || 0) === (a.doorAt || 0) && (b.door || "") > (a.door || "")) ? b : a;
  return { id: a.id, ...keys, sheet: first.sheet, sheetAt: first.sheetAt || 0, entries, gone, changed, door: dk.door || "", doorAt: dk.doorAt || 0 };
}

/** Of two copies of one sign-up, the one changed last (the same whichever comes first). */
function laterEdit(x, y) {
  const ex = x.editAt || 0, ey = y.editAt || 0;
  if (ex !== ey) return ey > ex ? y : x;
  return JSON.stringify(y) > JSON.stringify(x) ? y : x;
}

// what two copies must agree on (not the bookkeeping of who sent what when)
const content = (d) => (d ? JSON.stringify([d.deleted || false, d.key, d.keyAt || 0, d.sheet, d.sheetAt, d.entries, [...(d.gone || [])].sort(), d.door || "", d.doorAt || 0]) : "");

// The copies between the two servers are signed, not sent with the key (round 3, S11): an HMAC of what is asked
// (method, sheet, time, the body's hash) with the shared key, taken only within a few minutes of this server's clock.
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
async function syncSig(key, method, id, time, body) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const h = hex(await crypto.subtle.digest("SHA-256", typeof body === "string" ? new TextEncoder().encode(body) : body || new Uint8Array()));
  return hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`sumate-sync|${method}|${id}|${time}|${h}`)));
}
// The game host's door counts requests per visitor, by the address Cloudflare states. For a Worker's call to a host
// in its own zone Cloudflare states the X-Real-IP the Worker sets (developers.cloudflare.com/fundamentals/reference/
// http-headers, CF-Connecting-IP); left alone, every sheet's copies could count as one visitor and use up one
// allowance together (round 3, S4). So each sheet's copies count as their own visitor: an address from the
// documentation range (2001:db8::/32, never a real one) made from the sheet's id. The copy is still proved by its
// signature; this only spreads the door's count.
const peerAddr = (id) => {
  let h = 0;
  for (const c of id) h = (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0;
  return { "X-Real-IP": `2001:db8:5a3e:${(h >>> 16).toString(16)}:${(h & 0xffff).toString(16)}::1` };
};
export async function syncHeaders(key, method, id, body = "") {
  const time = String(Date.now());
  return { "X-Sync-Time": time, "X-Sync-Sig": await syncSig(key, method, id, time, body) };
}
async function syncOk(req, env, id, body) {
  const time = req.headers.get("X-Sync-Time") || "";
  if (!env.SYNC_KEY || !/^\d{13}$/.test(time)) return false;
  const ok = same(req.headers.get("X-Sync-Sig"), await syncSig(env.SYNC_KEY, req.method, id, time, body));
  // the two clocks, said out loud (second-pass S2-11): a refusal between our servers always leaves a line with its
  // reason, and a signed copy from a clock more than a minute off is logged even when it is taken
  const gap = Date.now() - Number(time);
  if (ok && Math.abs(gap) > 60e3) console.error(`sumate: the other server's clock is ${Math.round(gap / 1000)} s ${gap > 0 ? "behind" : "ahead"}${Math.abs(gap) > AHEAD_MS ? ": copies refused" : ""}`);
  if (!ok) console.error("sumate: a copy with a wrong signature was refused");
  return ok && Math.abs(gap) <= AHEAD_MS;
}

// per address (one hash of it, IPv6 by its /64): 30 new sheets, 300 changes and 120 reads a minute (wrangler.toml
// NEWS, WRITES, READS; the game host's copy counts the same, kinetic/server.mjs). A read counts because each one
// wakes a sheet that costs Cloudflare's daily allowance (round 3, S3). The other server's copies are proved by their
// signature, before any sheet is woken, and counted apart.
async function limited(req, env, url) {
  const sync = url.pathname.startsWith("/api/sync/");
  if (sync) return false;
  // the game host counts the same limits itself before it calls this code (kinetic/server.mjs sets LIMITS "host")
  if (env.LIMITS === "host") return false;
  const net = await netKey(req.headers.get("CF-Connecting-IP"));
  // fails closed (safety round 5, S10): a missing binding or a limiter that errors counts as over the limit
  const over = async (lim) => {
    if (!lim) return true;
    try {
      return !(await lim.limit({ key: net })).success;
    } catch (_) {
      return true;
    }
  };
  if (req.method === "GET") return url.pathname.startsWith("/api/sheets/") && over(env.READS);
  return (await over(env.WRITES)) || (url.pathname === "/api/sheets" && req.method === "POST" && (await over(env.NEWS)));
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (url.pathname === "/health" || url.pathname === "/api/health") return json({ ok: true });
    // the app's own refusal says so in JSON, so the app tells it from a platform's own error page (which it answers
    // by trying the other server)
    if (await limited(req, env, url)) return json({ error: "slow" }, 429);
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
    if (m && m[1] === "sync") {
      if (m[3] || (req.method !== "GET" && req.method !== "POST")) return json({ error: "not found" }, 404);
      const body = req.method === "POST" ? await readCapped(req, MAX_SYNC) : new Uint8Array();
      if (body === null) return json({ error: "too big" }, 413);
      if (!(await syncOk(req, env, m[2], body))) return json({ error: "not yours" }, 403);
      // to the sheet by a path only this code makes (no request from outside reaches /peer)
      return env.SHEETS.get(env.SHEETS.idFromName(m[2])).fetch(new Request("https://sheet/peer/" + m[2], { method: req.method, body: req.method === "POST" ? body : undefined }));
    }
    if (m) {
      // the sheet counts sign-ups per network (S2): it gets the network from here, never from the visitor
      const h = new Headers(req.headers);
      h.set("X-Net", await netKey(req.headers.get("CF-Connecting-IP")));
      return env.SHEETS.get(env.SHEETS.idFromName(m[2])).fetch(new Request(req, { headers: h }));
    }
    if (env.TEST_LOCAL_CSP === "1" && env.ASSETS) return testPage(req, env);
    return new Response("not found", { status: 404, headers: cors });
  },
};

/** A request's body, refused unread when it says it is too big and cut off when it turns out to be (round 3, S12). */
async function readCapped(req, max) {
  if (Number(req.headers.get("content-length")) > max) return null;
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) { try { await reader.cancel(); } catch {} return null; }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
async function readJson(req, max = MAX_BODY) {
  const body = await readCapped(req, max);
  if (!body) return null;
  try { return JSON.parse(new TextDecoder().decode(body)); } catch { return null; }
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
        const tries = (await this.state.storage.get("t")) || 0; // failed sends, kept apart from the sheet (S2-1)
        if (this.d !== undefined) return;
        this.d = d;
        if (d && tries > (d.tries || 0)) d.tries = tries;
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
    if (this.d.deleted) { this.nets?.clear(); try { await this.state.storage.delete("nets"); } catch {} } // nothing of a deleted sheet stays
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
      const body = JSON.stringify(this.copy());
      const r = await fetch(`${this.peer}/api/sync/${d.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...peerAddr(d.id), ...(await syncHeaders(this.env.SYNC_KEY, "POST", d.id, body)) },
        body,
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) throw new Error("sync " + r.status);
      const back = cleanCopy(await r.json(), d.id);
      if (!back) throw new Error("sync answer");
      if (this.d !== d || d.v !== v) return; // changed again meanwhile: the next send carries it
      const merged = mergeCopies(d, back);
      if (merged.deleted) {
        // replaced, never laid over: a deleted sheet keeps no title, line or name here either (second-pass S2-3)
        const nv = d.v + 1;
        this.d = { ...merged, changed: Math.max(merged.changed, back.changed), v: nv, sent: nv, tries: 0 };
        this.nets?.clear();
      try { await this.state.storage.put("d", this.d); await this.state.storage.delete("nets"); } catch (e) { console.error("sumate: keeping a copy failed:", e && e.message); }
        return;
      }
      if (content(merged) !== content(d)) Object.assign(d, merged, { v: d.v + 1 });
      d.changed = Math.max(d.changed, back.changed);
      d.sent = d.v;
      d.tries = 0;
    } catch (e) {
      // a failed try writes only its count, never the whole sheet again (S2-1), and says why once in a while (S2-11)
      d.tries = (d.tries || 0) + 1;
      if (d.tries === 1 || d.tries % 8 === 0) console.error(`sumate: the other server didn't take a copy (try ${d.tries}): ${e && e.message}`);
      try { await this.state.storage.put("t", d.tries); } catch {}
      return;
    }
    try { await this.state.storage.put("d", d); await this.state.storage.delete("t"); } catch (e) { console.error("sumate: keeping a copy failed:", e && e.message); }
  }

  copy() {
    const { v, sent, tries, ...c } = this.d;
    return c;
  }

  /** This server doesn't have the sheet: the other one may (it was made there, or before this one had a copy). */
  async ask(id) {
    if (!this.peer) return "none";
    try {
      const r = await fetch(`${this.peer}/api/sync/${id}`, { headers: { ...peerAddr(id), ...(await syncHeaders(this.env.SYNC_KEY, "GET", id)) }, signal: AbortSignal.timeout(8000) });
      // only Sumate's own answer means "no such sheet"; a 404 from something on the way (the game host's door, a
      // changed path) is "don't know", or the app would forget a sheet that exists (second-pass S2-9)
      if (r.status === 404) return (await r.json().catch(() => null))?.error === "gone" ? "none" : "unknown";
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
    return !!this.d && !this.d.deleted && same(req.headers.get("X-Sheet-Key"), this.d.key);
  }

  /** A helper with the check-in link (or the organizer): may mark who came and add someone who just turned up. */
  isDoor(req) {
    return this.isOwner(req) || (!!this.d?.door && same(req.headers.get("X-Door-Key"), this.d.door));
  }

  /** The sheet as it would be stored with `entries` (or as it is): within the size budget? (round 3, S2) */
  fits(entries = this.d.entries, sheet = this.d.sheet) {
    const j = JSON.stringify({ ...this.copy(), entries, sheet });
    // and in the form Cloudflare keeps it (second-pass S2-13c): a string with one letter past U+00FF is kept at two
    // bytes a letter, so plain text with an emoji in it takes twice its JSON size; 2 bytes a UTF-16 unit is the most
    return bytes(j) <= MAX_BYTES && j.length * 2 <= MAX_STORED;
  }

  /** One network's sign-ups on this sheet this hour. Counted in memory; a network that reaches the limit is written
   * down with the sheet ("nets": the network's irreversible code, never the address) until its hour is up, so putting
   * the sheet to sleep doesn't start its count again (second-pass S2-7a). */
  async overNet(req) {
    const net = req.headers.get("X-Net") || "";
    if (!net) return false;
    const now = Date.now();
    if (!this.nets) {
      this.nets = new Map();
      try { for (const [k, v] of Object.entries((await this.state.storage.get("nets")) || {})) if (now - v.since <= 3600e3) this.nets.set(k, v); } catch {}
    }
    let n = this.nets.get(net);
    if (!n || now - n.since > 3600e3) n = { since: now, count: 0 };
    n.count++;
    this.nets.set(net, n);
    if (this.nets.size > 5000) for (const [k, v] of this.nets) if (now - v.since > 3600e3) this.nets.delete(k);
    if (n.count === PER_NET_HOUR + 1) {
      const keep = {};
      for (const [k, v] of this.nets) if (v.count > PER_NET_HOUR && now - v.since <= 3600e3) keep[k] = v;
      try { await this.state.storage.put("nets", keep); } catch {}
    }
    return n.count > PER_NET_HOUR;
  }

  /** What a visitor sees: names only if the organizer shows them (the organizer always sees them). */
  view(req) {
    const owner = this.isOwner(req);
    const door = this.isDoor(req);
    const mine = new Set(tokensOf(req));
    const old = req.headers.get("X-Sign-Old") || "";
    const d = this.d;
    const waits = waitingOf(d);
    return {
      id: d.id,
      owner,
      // sign-ups made with the device's code from before codes were per sheet (round 3, S5): while there are some, the
      // app keeps sending that old code on this sheet; at 0 it stops
      ...(old ? { old: d.entries.filter((e) => e.token === old).length } : {}),
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
          ...((door || isMine) && e.here ? { here: e.here } : {}),
          // added through the check-in link (S2-7b): the organizer's undo of a recent flood covers these too
          ...(owner && e.byDoor ? { byDoor: 1 } : {}) };
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

    // the other server (its signature was checked by the Worker before this sheet was woken; only that code makes /peer)
    if (url.pathname.startsWith("/peer/")) {
      await this.load();
      if (req.method === "GET") return this.d ? json(this.copy()) : json({ error: "gone" }, 404);
      if (req.method !== "POST") return json({ error: "not found" }, 404);
      const got = cleanCopy(await readJson(req, MAX_SYNC), url.pathname.split("/")[2]);
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
      // a question taken off takes its answers with it (round 3, S13c)
      const entries = d.entries.filter((e) => ids.has(e.row)).map((e) => {
        if (!e.ans) return e;
        const ans = cleanAnswers(e.ans, sheet.asks);
        const { ans: _, ...rest } = e;
        return Object.keys(ans).length ? { ...rest, ans } : rest;
      });
      if (!this.fits(entries, sheet)) return json({ error: "big" }, 409);
      d.sheet = sheet;
      d.sheetAt = Math.max(Date.now(), (d.sheetAt || 0) + 1);
      d.entries = entries;
      await this.save();
      return json(this.view(req));
    }

    if (rest === "/" && req.method === "DELETE") {
      if (!this.isOwner(req)) return json({ error: "not yours" }, 403);
      // kept as "deleted" (a few bytes) until it expires, so the other server's copy can't bring it back
      this.d = { id: d.id, key: d.key, ...(d.keyAt ? { keyAt: d.keyAt } : {}), deleted: true, changed: d.changed, gone: [], v: d.v, sent: d.sent };
      await this.save();
      return json({ ok: true });
    }

    if (rest === "/signups" && req.method === "POST") {
      const b = await readJson(req);
      // the app names the sign-up itself, so the same sign-up sent again (to the other server, after no answer) is one
      if (isId(b?.id, 8, 8)) {
        const again = d.entries.find((e) => e.id === b.id);
        if (again && again.token === b.token) return json({ token: again.token, view: this.view(withToken(req, again.token)) });
        if (again || goneHas(d, b.id)) b.id = null;
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
      if (!staff && asks.some((q) => q.req && !(Object.hasOwn(ans, q.id) && ans[q.id]))) return json({ error: "answer" }, 400);
      const now = Date.now();
      const entry = { id: isId(b?.id, 8, 8) ? b.id : randomToken(8), row: row.id, name, note: line(b?.note, 200), token, at: now,
        ...(Object.keys(ans).length ? { ans } : {}), ...(qty > 1 ? { qty } : {}), ...(staff && b?.here ? { here: now, hereAt: now, walk: 1 } : {}), ...(staff && !owner ? { byDoor: 1 } : {}) };
      // pinned: one sheet's size budget, so both servers can always copy it (round 3, S2)
      if (!this.fits([...d.entries, entry])) return json({ error: "big" }, 409);
      // pinned: at most PER_NET_HOUR sign-ups from one network on one sheet in an hour, except the organizer's (second-pass
      // S2-7b: the check-in link is shared with helpers, so what it adds has a budget like everyone's)
      if (!owner && (await this.overNet(req))) return json({ error: "busy" }, 429);
      d.entries.push(entry);
      await this.save();
      return json({ token, view: this.view(withToken(req, token)) });
    }

    const hm = rest.match(/^\/signups\/([a-z0-9]{8})\/here$/);
    if (hm && req.method === "POST") {
      const e = d.entries.find((x) => x.id === hm[1]);
      if (!e) return json({ error: "gone" }, 404);
      const mine = tokensOf(req).includes(e.token);
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
      const tokens = tokensOf(req);
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
        if (asks.some((q) => q.req && !(Object.hasOwn(ans, q.id) && ans[q.id]))) return json({ error: "answer" }, 400);
      }
      // pinned: moving (or taking more) needs room there: nobody is pushed onto a waiting list, nor jumps one
      if (to.need && (moved || qty > qtyOf(e))) {
        const taken = d.entries.filter((x) => x.row === to.id && x !== e).reduce((n, x) => n + qtyOf(x), 0);
        if (taken + qty > to.need && !(!moved && waitingOf(d).has(e.id))) return json({ error: taken >= to.need ? "full" : "few" }, 409);
      }
      if (name === e.name && note === e.note && JSON.stringify(ans) === JSON.stringify(cleanAnswers(e.ans, asks)) && qty === qtyOf(e) && !moved) return json(this.view(req));
      if (!this.fits(d.entries.map((x) => (x === e ? { ...e, name, note, ans, qty } : x)))) return json({ error: "big" }, 409);
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
      const mine = tokensOf(req).includes(e.token);
      if (!mine && !this.isOwner(req)) return json({ error: "not yours" }, 403);
      const row = d.sheet.rows.find((r) => r.id === e.row);
      // pinned: a final sheet keeps its list once sign-ups are shut; the organizer can still remove anyone
      if (d.sheet.final && !this.isOwner(req) && shut(d.sheet, row)) return json({ error: "final" }, 409);
      d.entries = d.entries.filter((x) => x !== e);
      d.gone = goneOf(d.gone, [goneMark(e.id)]);
      await this.save();
      return json(this.view(req));
    }

    // the organizer removes many at once (round 3, S2: someone filled a sheet with made-up sign-ups)
    if (rest === "/signups/remove" && req.method === "POST") {
      if (!this.isOwner(req)) return json({ error: "not yours" }, 403);
      const b = await readJson(req);
      const ids = new Set((Array.isArray(b?.ids) ? b.ids : []).filter((x) => isId(x, 8, 8)).slice(0, MAX_ENTRIES));
      const out = d.entries.filter((x) => ids.has(x.id));
      if (out.length) {
        const now = Date.now();
        d.entries = d.entries.filter((x) => !ids.has(x.id));
        d.gone = goneOf(d.gone, out.map((x) => goneMark(x.id, now)));
        await this.save();
      }
      return json(this.view(req));
    }

    // a new organizer link: the old one stops working on both servers (round 3, S7: one pasted in the wrong place)
    if (rest === "/key" && req.method === "POST") {
      if (!this.isOwner(req)) return json({ error: "not yours" }, 403);
      // the organizer's device makes the new key and keeps it before asking (second-pass S2-5): if this answer is lost,
      // the device still has the key the sheet now takes, and asks with it
      const asked = (await readJson(req, MAX_BODY).catch(() => null))?.key;
      d.key = isId(asked, 24, 24) ? asked : randomToken(24);
      d.keyAt = Math.max(Date.now(), (d.keyAt || 0) + 1);
      await this.save();
      const h = new Headers(req.headers);
      h.set("X-Sheet-Key", d.key);
      return json({ key: d.key, view: this.view(new Request(req.url, { headers: h })) });
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

/** The device codes a request shows: this sheet's (X-Sign-Tokens) and, while it still has sign-ups with it, the device's
 * code from before codes were per sheet (X-Sign-Old). */
function tokensOf(req) {
  return [...(req.headers.get("X-Sign-Tokens") || "").split(","), req.headers.get("X-Sign-Old") || ""].filter((x) => isId(x, 16, 32));
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

// One home line is one address: IPv6 by its /64, IPv4 as itself; only a hash goes to the limit (safety round 2, J7/J9)
export function netOf(ip) {
  ip = String(ip || "unknown").trim().replace(/^::ffff:(?=\d+\.)/i, "");
  if (!ip.includes(":")) return ip;
  const [a, b = ""] = ip.split("%")[0].split("::");
  const head = a ? a.split(":") : [], tail = b ? b.split(":") : [];
  const all = ip.includes("::") ? [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill("0"), ...tail] : head;
  return all.slice(0, 4).map((x) => (parseInt(x, 16) || 0).toString(16)).join(":") + "::/64";
}
async function netKey(ip) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("sumate-net|" + netOf(ip)));
  return [...new Uint8Array(h).slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
