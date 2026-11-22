// Sumate: free sign-up sheets. Plain JS, no build step.
import { t, translatePage, LANG } from "./i18n.js";
import { openFeedback } from "./feedback.js";
import { whenText, slotOf, makeSlots, googleLink, outlookLink, icsText, shut, alarmTrigger, REMINDERS, MAX_QTY, qtyOf, mostFor, canSelfIn } from "./cal.js";
// the folder the app lives in: "/" on signup.jurisgames.com, "/sumate/" on the copy at GitHub Pages
const BASE = new URL(".", import.meta.url).pathname;
const here = () => "/" + location.pathname.slice(BASE.length); // the app's own path ("/s/abc...")
// on someone else's page in an iframe (the share box's website code adds ?embed; go() keeps it)
const EMBED = new URLSearchParams(location.search).has("embed");
// inside any other page's frame the app is a visitor, whatever this browser holds: no organizer or check-in key is
// sent and nothing that edits or deletes is offered (safety round 3, S9; APP-RULES safety)
const FRAMED = (() => { try { return window.top !== window.self; } catch { return true; } })();

const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

translatePage();

// ---------- device memory: name, a device token (to remove your own sign-ups), your sheets ----------
function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } }

function deviceToken() {
  let tok = safeGet("sumate.token");
  if (!/^[a-z0-9]{20}$/.test(tok || "")) {
    const a = crypto.getRandomValues(new Uint8Array(20));
    tok = [...a].map((b) => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");
    // (a save that holds a key says when it fails, APP-RULES safety 113: without it this browser can't change or
    // remove its sign-ups after a reload)
    if (!safeSet("sumate.token", tok) && !deviceToken.told) {
      deviceToken.told = true;
      toast(t("This browser's storage is full: after a reload it can't change or remove the names it put down."));
    }
  }
  return tok;
}
// The device's old code (safety round 3, S5): sign-ups from before 21 Nov carry it itself, and on those sheets it is
// sent too (X-Sign-Old) until the server says none are left. It is stored on the servers with those sign-ups.
const HAD_OLD = /^[a-z0-9]{20}$/.test(safeGet("sumate.token") || "");
const SECRET = deviceToken();
// The secret each sheet's own code is made from (second-pass S2-8): a new one, never sent or stored anywhere but here,
// because codes made from the old one could be worked out by whoever reads the servers. Sheets this device already
// knew when it got the new secret ("lg") keep sending the code made the old way too, so their sign-ups stay theirs.
function sheetSecret() {
  const have = safeGet("sumate.secret");
  if (/^[a-z0-9]{24}$/.test(have || "")) return have;
  const s = [...crypto.getRandomValues(new Uint8Array(24))].map((b) => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");
  if (!safeSet("sumate.secret", s)) return SECRET; // nowhere to keep a new one: the old way, as before
  if (HAD_OLD) safeSet("sumate.sheets", JSON.stringify(mySheets().map((x) => ({ ...x, lg: 1 }))));
  return s;
}
const SECRET2 = sheetSecret();
const tokens = new Map();
async function codeFrom(secret, id) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode("sumate-sheet|" + id)));
  return [...sig.slice(0, 20)].map((b) => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");
}
/** This sheet's code (what a new sign-up carries). */
async function tokenFor(id) {
  if (tokens.has(id)) return tokens.get(id);
  let tok = SECRET2;
  try { tok = await codeFrom(SECRET2, id); } catch {}
  tokens.set(id, tok);
  return tok;
}
/** Every code that may be on this device's sign-ups here: this sheet's, and on sheets known before the new secret the
 * one made the old way. */
async function tokensFor(id) {
  const mine = [await tokenFor(id)];
  if (SECRET2 !== SECRET && mySheets().find((x) => x.id === id)?.lg) {
    try { mine.push(await codeFrom(SECRET, id)); } catch {}
  }
  return mine.join(",");
}

function mySheets() {
  try { return JSON.parse(safeGet("sumate.sheets") || "[]").filter((s) => s && s.id); } catch { return []; }
}
function rememberSheet(id, patch) {
  const all = mySheets();
  const had = all.find((s) => s.id === id);
  // a sheet first kept from now on has only this sheet's code on it (t2: no old code to send)
  const next = { ...(had || { id, t2: 1 }), ...patch, seen: Date.now() };
  // the newest 100, and every sheet this device holds a key for: opening other sheets never pushes a key out (S1)
  const v = JSON.stringify([next, ...all.filter((s) => s.id !== id)].filter((s, i) => i < 100 || s.key || s.door));
  // the organizer's key matters more than the offline copies: a full storage gives those up first (audit R13)
  if (safeSet("sumate.sheets", v)) return;
  try { localStorage.removeItem("sumate.copies"); } catch {}
  if (!safeSet("sumate.sheets", v) && (patch.key || patch.door))
    toast(t("This browser's storage is full, so it can't remember this sheet. Keep its link somewhere safe."));
}
function forgetSheet(id) {
  safeSet("sumate.sheets", JSON.stringify(mySheets().filter((s) => s.id !== id)));
}
const keyFor = (id) => (FRAMED ? "" : mySheets().find((s) => s.id === id)?.key || "");
const doorFor = (id) => (FRAMED ? "" : mySheets().find((s) => s.id === id)?.door || ""); // a helper's check-in link

function copies() {
  try { return JSON.parse(safeGet("sumate.copies") || "{}") || {}; } catch { return {}; }
}
function keepCopy(id, v) {
  const all = copies();
  delete all[id];
  const next = { [id]: { at: Date.now(), v }, ...all };
  safeSet("sumate.copies", JSON.stringify(Object.fromEntries(Object.entries(next).slice(0, 30))));
}
function dropCopy(id) {
  const all = copies();
  delete all[id];
  safeSet("sumate.copies", JSON.stringify(all));
}

// "Send feedback" (start page and every sheet): what the person writes, plus, if they keep the tick, the page they
// are on. Never the sheet, its links or anyone's name.
document.addEventListener("click", (e) => {
  if (!e.target.closest(".fbOpen")) return;
  e.preventDefault();
  openFeedback({ app: "sumate", t, toast, details: () => ({ page: document.querySelector(".page:not([hidden])")?.id || "" }) });
});

// ---------- small UI helpers ----------
let toastTimer;
function toast(text) {
  const d = $("#toast");
  d.textContent = text;
  d.hidden = false;
  clearTimeout(toastTimer);
  // long enough to read: at least 5 s, more for long text (Juntos UX review U-J7)
  toastTimer = setTimeout(() => (d.hidden = true), Math.max(5000, String(text).length * 70));
}
function showMsg(sel, text) {
  const m = $(sel);
  m.textContent = text || "";
  m.hidden = !text;
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast(t("Copied")); }
  catch { toast(t("Select the link and copy it")); }
}

// ---------- servers ----------
// Every sheet is kept on two servers that copy each other (Kleider: "all parts of the app should work even if one
// the pieces break down"): this site's own (Cloudflare) and the game host's (games.jurisgames.com/sumate). When one
// doesn't answer, the app asks the other, and stays with the one that answered.
// Test switches (?server= etc.) take only our own hosts, or addresses that can never connect (.invalid, for failover
// tests): a crafted link can never point the app at somebody else's server (APP-RULES safety 1). This computer
// (localhost) only when the page itself is served from this computer, so a link to the real site can never make it
// talk to something running on the visitor's own machine (safety round 2, J15). The shipped page's CSP has no
// localhost either; the test server adds it (worker/wrangler.test.toml).
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/;
const testHost = (u) => {
  try {
    const x = new URL(u);
    if (!/^(wss?|https?):$/.test(x.protocol)) return null;
    const h = x.hostname;
    // only on a page served from this computer (APP-RULES safety 1; Juntos' audit, N12: on the live page a link could
    // point someone at another of our servers or at nothing)
    if (!LOCAL.test(location.hostname)) return null;
    return LOCAL.test(h) || /(^|\.)jurisgames\.com$/.test(h) || /\.invalid$/.test(h) ? u : null;
  } catch { return null; }
};
const RP = new URLSearchParams(location.search);
const RPG = (k) => (RP.get(k) ? testHost(RP.get(k)) : null);
const OURS = /(^|\.)jurisgames\.com$|\.github\.io$/.test(location.hostname);
const SERVERS = [
  RPG("server") || (location.hostname.endsWith(".github.io") ? "https://signup.jurisgames.com" : ""),
  RPG("server2") || (OURS && !RPG("server") ? "https://games.jurisgames.com/sumate" : null),
].filter((s) => s !== null);
// the game host first when the page has both (item 46, Kleider: the unlimited route "should attempt do to the work
// before touching the cloudflare limits"): every read it answers costs nothing of Cloudflare's daily allowance; only
// its copy of a change goes to Cloudflare. Test pages that name their servers keep the order they name.
const FIRST = SERVERS.length > 1 && !RPG("server") ? 1 : 0;
let at = FIRST;
try { const kept = sessionStorage.getItem("sumate.server"); if (kept !== null) at = Math.min(Number(kept) || 0, SERVERS.length - 1); } catch {}

// `as`: a key to try instead of the one kept (a link's, checked before it is kept: round 3, S1)
async function api(path, opts = {}, id, as = null) {
  const headers = {};
  if (id) {
    headers["X-Sign-Tokens"] = await tokensFor(id);
    const s = mySheets().find((x) => x.id === id);
    if (s && !s.t2) headers["X-Sign-Old"] = SECRET;
  }
  const key = as ? as.key : id && keyFor(id);
  if (key) headers["X-Sheet-Key"] = key;
  const door = as ? as.door : id && !key && doorFor(id);
  if (door) headers["X-Door-Key"] = door;
  if (opts.body) headers["Content-Type"] = "application/json";
  let failed = { error: "offline" };
  for (const i of SERVERS.length > 1 ? [at, 1 - at] : [0]) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    let r;
    try {
      r = await fetch(SERVERS[i] + path, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined, signal: ctl.signal });
    } catch {
      continue; // no answer: the other one
    } finally {
      clearTimeout(timer);
    }
    // an answer that isn't the app's own (a platform's error or over-quota page, a cap that isn't this visitor's): the
    // other server (round 3, S3). The app's own answers are JSON.
    const own = (r.headers.get("content-type") || "").includes("application/json");
    let data = {};
    try { data = await r.json(); } catch {}
    if (!r.ok && !own) { failed = { error: "offline", status: r.status }; continue; }
    if (r.status >= 500) { failed = { error: r.status === 503 ? "offline" : data.error || "error", status: r.status }; continue; }
    if (at !== i) { at = i; try { sessionStorage.setItem("sumate.server", String(i)); } catch {} }
    if (!r.ok) return { error: data.error || "error", status: r.status };
    return data;
  }
  return failed;
}
const errText = (e) => errTexts()[Object.hasOwn(errTexts(), e) ? e : ""] ?? t("Something went wrong. Try again.");
const errTexts = () => ({
  offline: t("No connection. Try again."),
  full: t("Someone just took the last spot."),
  few: t("There aren't that many spots left."),
  limit: t("That's more than one person can take on this sheet."),
  closed: t("Sign-ups are closed."),
  notyet: t("Sign-ups aren't open yet."),
  locked: t("This one isn't taking sign-ups any more."),
  final: t("The list is final: ask the organizer if you can't come."),
  answer: t("Answer the questions marked as required."),
  gone: t("This sheet doesn't exist"),
  notday: t("You can check in from the day it happens."),
  waiting: t("Still on the waiting list: not in yet."),
  big: t("This sheet is as big as it can get. The organizer can remove sign-ups to make room."),
  busy: t("Many sign-ups from this network in the last hour. Try again later."),
  slow: t("Too many tries. Wait a minute and try again."),
});

// ---------- routing ----------
const PAGES = ["home", "edit", "sheet", "door", "gone"];
function show(id) {
  for (const p of PAGES) $("#" + p).hidden = p !== id;
  window.scrollTo(0, 0);
}
function go(path, replace = false) {
  history[replace ? "replaceState" : "pushState"](null, "", BASE + path.slice(1) + location.search);
  route();
}
window.addEventListener("popstate", route);

let current = null; // the open sheet's view from the server
let pollTimer = null;

function route() {
  closeBoxes();
  clearInterval(pollTimer);
  const p = here();
  // an organizer link carries its key after #k= : keep it on this device, then hide it from the address bar
  const hk = location.hash.match(/^#([kd])=([a-z0-9]{24})$/); // #k= the organizer's, #d= a check-in helper's
  const m = p.match(/^\/s\/([a-z0-9]{10})(\/edit|\/copy|\/door)?$/);
  if (m && hk) {
    history.replaceState(null, "", location.pathname + location.search);
    if (!FRAMED) return claimKey(m[1], hk[1], hk[2]).then(route);
  }
  if (m && m[2] === "/door") return openDoor(m[1]);
  if (p === "/new") return openEditor(null);
  if (m && m[2] === "/copy") return openEditor(null, m[1]);
  if (m && m[2]) return openEditor(m[1]);
  if (m) return openSheet(m[1]);
  return openHome();
}

/** A key from a link is kept only when the server takes it, and never over a key that still works (safety round 3,
 * S1: a made-up #k= in a link wrote over the organizer's real key). With no server to ask it is kept only where
 * there was no key to lose. */
async function claimKey(id, kind, val) {
  const s = mySheets().find((x) => x.id === id);
  const has = kind === "k" ? s?.key : s?.door;
  if (has === val) return;
  const v = await api("/api/sheets/" + id, {}, id, kind === "k" ? { key: val } : { door: val });
  const ok = kind === "k" ? v.owner : v.door;
  if (ok) return rememberSheet(id, kind === "k" ? { key: val } : { door: val });
  // no server to ask: kept apart, never sent in place of a key, and asked about once a server answers (second-pass
  // S2-10: a made-up key kept unasked was sent instead of the real check-in key, which then got erased)
  if (v.error && v.status !== 404 && !has) return rememberSheet(id, kind === "k" ? { pkey: val } : { pdoor: val });
  if (!v.error) toast(kind === "k" ? t("This organizer link doesn't work (any more). Ask whoever made the sheet.") : t("This check-in link was turned off or replaced. Ask the organizer for the new one."));
}

/** A key from a link that no server could check yet: asked about now that one answers, then kept or dropped. */
async function checkPending(id) {
  const s = mySheets().find((x) => x.id === id);
  if (!s || (!s.pkey && !s.pdoor && !s.nkey)) return;
  const { pkey, pdoor, nkey } = s;
  rememberSheet(id, { pkey: "", pdoor: "" });
  // a new organizer link whose answer never came (S2-5): the sheet decides, the old key stays until it does
  if (nkey) {
    const v = await api("/api/sheets/" + id, {}, id, { key: nkey });
    if (v.owner) rememberSheet(id, { key: nkey, nkey: "" });
    else if (!v.error) rememberSheet(id, { nkey: "" });
  }
  if (pkey) await claimKey(id, "k", pkey);
  if (pdoor) await claimKey(id, "d", pdoor);
}

// ---------- home ----------
function openHome() {
  document.title = t("Sumate · free sign-up sheets");
  const list = $("#mine");
  list.replaceChildren();
  const all = mySheets();
  $("#mineWrap").hidden = !all.length;
  for (const s of all) {
    const li = el("li");
    const b = el("button");
    b.append(el("b", "", s.title || t("Sheet")));
    b.append(el("span", s.key ? "tag" : "tag alt", s.key ? t("Yours") : s.door ? t("Check-in") : t("Signed up")));
    b.onclick = () => go("/s/" + s.id + (!s.key && s.door ? "/door" : ""));
    li.append(b);
    list.append(li);
  }
  show("home");
}
$("#makeBtn").onclick = () => go("/new");

// ---------- editor ----------
let editId = null;
let editTz = ""; // the sheet's time zone, kept when the organizer edits from somewhere else
let skew = 0; // the server's clock minus this device's: sign-ups open and close by the server's

// a moment <-> the value of an <input type=datetime-local> (this device's time)
const pad = (n) => String(n).padStart(2, "0");
function toLocalInput(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const fromLocalInput = (v) => (v ? new Date(v).getTime() || undefined : undefined);
const momentText = (ms) => new Intl.DateTimeFormat(LANG, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(ms);
const MAX_ROWS = 200;

function needLabel(n) { return n ? String(n) : "∞"; }

function rowEl(r) {
  const li = el("li", "erow" + (r.heading ? " head" : ""));
  li.dataset.id = r.id || "";
  li.dataset.heading = r.heading ? "1" : "";
  const inp = el("input", "text");
  inp.maxLength = 160;
  inp.value = r.text || "";
  inp.placeholder = r.heading ? t("Heading, e.g. Saturday or Desserts") : t("e.g. Salad, or 10:00 - 12:00");
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); addRow({ need: r.heading ? 1 : li.need }, li); }
    if (e.key === "Backspace" && !inp.value && $("#rows").children.length > 1) {
      e.preventDefault();
      const prev = li.previousElementSibling || li.nextElementSibling;
      li.remove();
      prev?.querySelector("input")?.focus();
    }
  });
  li.append(inp);
  if (!r.heading) {
    // when: a day and times (like SignUpGenius' dates and times), hidden until asked for or set
    const when = el("div", "ewhen");
    const day = el("input");
    day.type = "date";
    day.name = "date";
    day.value = r.date || "";
    day.setAttribute("aria-label", t("Day"));
    const from = el("input");
    from.type = "time";
    from.name = "start";
    from.value = r.start || "";
    from.setAttribute("aria-label", t("From"));
    const to = el("input");
    to.type = "time";
    to.name = "end";
    to.value = r.end || "";
    to.setAttribute("aria-label", t("To"));
    when.append(day, from, el("span", "", "–"), to);
    when.hidden = !(r.date || r.start);
    const clockBtn = el("button", "clock", "🕒");
    clockBtn.type = "button";
    clockBtn.title = t("Day and time");
    clockBtn.setAttribute("aria-label", clockBtn.title);
    clockBtn.onclick = () => { when.hidden = !when.hidden; if (!when.hidden) day.focus(); };
    li.whenBox = when; // not li.when: Chrome elements have a built-in when() (Observables)
    li.clockBtn = clockBtn;
    li.need = r.need ?? 1;
    const box = el("div", "need");
    const minus = el("button", "", "−");
    const val = el("span", "", needLabel(li.need));
    const plus = el("button", "", "+");
    minus.type = plus.type = "button";
    minus.title = t("Fewer people");
    plus.title = t("More people");
    val.title = t("How many people (∞ = any number)");
    // 1 ... 999, and below 1 comes "any number" (∞)
    minus.onclick = () => { li.need = li.need === 0 ? 0 : li.need - 1; val.textContent = needLabel(li.need); };
    plus.onclick = () => { li.need = li.need === 0 ? 1 : Math.min(999, li.need + 1); val.textContent = needLabel(li.need); };
    box.append(minus, val, plus);
    li.append(box);
  }
  if (li.clockBtn) li.append(li.clockBtn);
  const x = el("button", "x", "×");
  x.type = "button";
  x.title = t("Remove");
  x.onclick = () => li.remove();
  li.append(x);
  if (li.whenBox) li.append(li.whenBox);
  return li;
}

// time slots in one go (like SignUpGenius' "Add Time Slots"): a day, from, to, every so many minutes
const genSlots = () => {
  const from = $("#genFrom").value, to = $("#genTo").value;
  return from && to ? makeSlots(from, to, +$("#genEvery").value, MAX_ROWS - $("#rows").children.length) : [];
};
const sayGen = () => { $("#genSay").textContent = t("{n} slots", { n: genSlots().length }); };
for (const f of ["#genFrom", "#genTo", "#genEvery"]) $(f).addEventListener("input", sayGen);
$("#addSlots").onclick = () => {
  $("#slotGen").hidden = false;
  if (!$("#genDay").value) {
    const last = [...$("#rows").querySelectorAll("input[name=date]")].map((i) => i.value).filter(Boolean).pop();
    $("#genDay").value = last || "";
  }
  sayGen();
  $("#genDay").focus();
};
$("#genCancel").onclick = () => { $("#slotGen").hidden = true; };
$("#genAdd").onclick = () => {
  const slots = genSlots();
  if (!slots.length) return $("#genTo").focus();
  const last = [...$("#rows").children].reverse().find((li) => !li.dataset.heading);
  // the lines the editor starts with, still empty, make room for the slots
  for (const li of [...$("#rows").children]) if (!li.querySelector("input.text").value.trim()) li.remove();
  const what = $("#genWhat").value.trim() || t("Spot");
  for (const s of slots) $("#rows").append(rowEl({ text: what, need: last?.need || 1, date: $("#genDay").value, ...s }));
  $("#slotGen").hidden = true;
  toast(t("Added {n} slots", { n: slots.length }));
};

function addRow(r, after) {
  const li = rowEl(r);
  if (after) after.after(li); else $("#rows").append(li);
  li.querySelector("input").focus();
}
$("#addRow").onclick = () => {
  const last = [...$("#rows").children].reverse().find((li) => !li.dataset.heading);
  addRow({ need: last ? last.need : 1 });
};
$("#addHead").onclick = () => addRow({ heading: true });

function readEditor() {
  return {
    title: $("#title").value,
    details: $("#details").value,
    place: $("#place").value,
    tz: editTz || Intl.DateTimeFormat().resolvedOptions().timeZone, // the organizer's: the times are theirs
    showNames: $("#showNames").checked,
    open: $("#openSw").checked,
    opens: fromLocalInput($("#opensAt").value),
    closes: fromLocalInput($("#closesAt").value),
    lock: $("#lockSel").value === "" ? undefined : Number($("#lockSel").value),
    final: $("#finalSw").checked,
    wait: $("#waitSw").checked,
    qty: $("#qtySw").checked,
    selfIn: $("#selfInSw").checked,
    per: Number($("#perSel").value) || undefined,
    perRow: Number($("#perRowSel").value) || undefined,
    rows: [...$("#rows").children].map((li) => ({
      id: li.dataset.id || undefined,
      text: li.querySelector("input").value,
      heading: !!li.dataset.heading,
      need: li.need,
      date: li.querySelector("input[name=date]")?.value || undefined,
      start: li.querySelector("input[name=start]")?.value || undefined,
      end: li.querySelector("input[name=end]")?.value || undefined,
    })).filter((r) => r.text.trim()),
    asks: [...$("#asks").children].map((li) => ({
      id: li.dataset.id || undefined,
      text: li.querySelector("input.text").value,
      opts: li.querySelector("textarea").value.split("\n").map((o) => o.trim()).filter(Boolean),
      req: li.querySelector("input[type=checkbox]").checked,
    })).filter((q) => q.text.trim()),
  };
}

// ---------- the organizer's own questions ----------
const MAX_ASKS = 5;
function askEl(q) {
  const li = el("li", "eask");
  li.dataset.id = q.id || "";
  const top = el("div", "erow");
  const inp = el("input", "text");
  inp.maxLength = 120;
  inp.value = q.text || "";
  inp.placeholder = t("e.g. T-shirt size? or Any allergies?");
  inp.setAttribute("aria-label", t("Question"));
  const x = el("button", "x", "×");
  x.type = "button";
  x.title = t("Remove");
  x.onclick = () => { li.remove(); $("#addAsk").hidden = false; };
  top.append(inp, x);
  const opts = el("textarea");
  opts.rows = 2;
  opts.value = (q.opts || []).join("\n");
  opts.placeholder = t("Choices, one per line (leave empty for a written answer)");
  opts.setAttribute("aria-label", t("Choices"));
  const req = el("label", "switch small");
  const cb = el("input");
  cb.type = "checkbox";
  cb.checked = !!q.req;
  req.append(cb, el("span", "", t("Required")));
  li.append(top, opts, req);
  return li;
}
$("#addAsk").onclick = () => {
  const li = askEl({});
  $("#asks").append(li);
  li.querySelector("input").focus();
  $("#addAsk").hidden = $("#asks").children.length >= MAX_ASKS;
};
// the answers of one sign-up, in the order of the questions
const answersOf = (e, asks) => (asks || []).map((q) => (e.ans && Object.hasOwn(e.ans, q.id) ? e.ans[q.id] : ""));

// a copy (like SignUpGenius' "duplicate"): same lines, questions and settings, nobody signed up yet; the days can all
// move by a week or so at once
const addDays = (ymd, n) => {
  const d = new Date(ymd + "T12:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
function shiftDays() {
  const n = Number($("#shiftSel").value);
  for (const inp of $("#rows").querySelectorAll("input[name=date]")) {
    if (inp.dataset.orig === undefined) inp.dataset.orig = inp.value;
    if (inp.dataset.orig) inp.value = n ? addDays(inp.dataset.orig, n) : inp.dataset.orig;
  }
  for (const inp of [$("#opensAt"), $("#closesAt")]) {
    if (inp.dataset.orig === undefined) inp.dataset.orig = inp.value;
    if (inp.dataset.orig) inp.value = addDays(inp.dataset.orig.slice(0, 10), n) + inp.dataset.orig.slice(10);
  }
}
$("#shiftSel").onchange = shiftDays;

async function openEditor(id, from) {
  editId = id;
  showMsg("#editMsg", "");
  $("#rows").replaceChildren();
  $("#asks").replaceChildren();
  $("#slotGen").hidden = true;
  editTz = "";
  $("#delSheet").hidden = !id;
  $("#editHead").textContent = id ? t("Edit sheet") : t("New sheet");
  let s = { title: "", details: "", showNames: true, open: true, rows: [{ need: 1 }, { need: 1 }, { need: 1 }] };
  if (from) {
    const v = current?.id === from && !current.stale ? current : await api("/api/sheets/" + from, {}, from);
    if (v.error) return go("/s/" + from, true);
    const strip = ({ id: _, ...x }) => x; // new lines and questions: the copy has its own
    s = { ...v.sheet, title: t("{title} (copy)", { title: v.sheet.title }).slice(0, 120), rows: v.sheet.rows.map(strip), asks: (v.sheet.asks || []).map(strip) };
    $("#editHead").textContent = t("Copy of the sheet");
  }
  if (id) {
    if (!keyFor(id)) return go("/s/" + id, true);
    const v = await api("/api/sheets/" + id, {}, id);
    if (v.error) return v.status === 404 ? show("gone") : go("/s/" + id, true); // no server: the sheet page says so
    s = v.sheet;
  }
  $("#title").value = s.title;
  $("#details").value = s.details;
  $("#place").value = s.place || "";
  editTz = s.tz || "";
  $("#showNames").checked = s.showNames;
  $("#openSw").checked = s.open;
  $("#opensAt").value = toLocalInput(s.opens);
  $("#closesAt").value = toLocalInput(s.closes);
  $("#lockSel").value = typeof s.lock === "number" ? String(s.lock) : "";
  $("#finalSw").checked = !!s.final;
  $("#waitSw").checked = !!s.wait;
  $("#qtySw").checked = !!s.qty;
  $("#selfInSw").checked = !!s.selfIn;
  pickNum($("#perSel"), s.per);
  pickNum($("#perRowSel"), s.perRow);
  $("#limits").hidden = !(s.per || s.perRow);
  $("#timing").hidden = !(s.opens || s.closes || typeof s.lock === "number" || s.final);
  for (const r of s.rows) $("#rows").append(rowEl(r));
  for (const q of s.asks || []) $("#asks").append(askEl(q));
  $("#addAsk").hidden = $("#asks").children.length >= MAX_ASKS;
  for (const inp of [$("#opensAt"), $("#closesAt")]) delete inp.dataset.orig;
  $("#shiftSel").value = "0";
  $("#shiftWrap").hidden = !from || !s.rows.some((r) => r.date);
  show("edit");
  if (!id) $("#title").focus();
}

$("#timingBtn").onclick = () => { $("#timing").hidden = !$("#timing").hidden; };
$("#limitsBtn").onclick = () => { $("#limits").hidden = !$("#limits").hidden; };
// a limit picker: its own choices, plus the sheet's number if it is another one
function pickNum(sel, n) {
  if (n && ![...sel.options].some((o) => o.value === String(n))) sel.append(new Option(String(n), String(n)));
  sel.value = n ? String(n) : "";
}

$("#editBack").onclick = () => (editId ? go("/s/" + editId) : go("/"));

$("#saveBtn").onclick = async () => {
  const s = readEditor();
  if (!s.title.trim()) { showMsg("#editMsg", t("Give the sheet a title.")); $("#title").focus(); return; }
  if (!s.rows.some((r) => !r.heading)) { showMsg("#editMsg", t("Add at least one line.")); return; }
  if (s.opens && s.closes && s.closes <= s.opens) { showMsg("#editMsg", t("It has to close after it opens.")); $("#closesAt").focus(); return; }
  $("#saveBtn").disabled = true;
  const r = editId
    ? await api("/api/sheets/" + editId, { method: "PUT", body: s }, editId)
    : await api("/api/sheets", { method: "POST", body: s });
  $("#saveBtn").disabled = false;
  if (r.error) return showMsg("#editMsg", errText(r.error));
  if (editId) {
    rememberSheet(editId, { title: s.title.trim() });
    go("/s/" + editId);
  } else {
    rememberSheet(r.id, { key: r.key, title: s.title.trim() });
    go("/s/" + r.id, true);
    openShare(true);
  }
};

$("#delSheet").onclick = async () => {
  const b = $("#delSheet");
  if (!b.dataset.sure) {
    b.dataset.sure = "1";
    b.textContent = t("Tap again to delete it for everyone");
    setTimeout(() => { delete b.dataset.sure; b.textContent = t("Delete this sheet"); }, 4000);
    return;
  }
  const r = await api("/api/sheets/" + editId, { method: "DELETE" }, editId);
  // only the sheet's own "gone" means it is no more; any other 404 is something on the way (second-pass S2-9)
  if (r.error && !(r.status === 404 && r.error === "gone")) return showMsg("#editMsg", errText(r.error));
  forgetSheet(editId);
  dropCopy(editId);
  toast(t("Sheet deleted"));
  go("/", true);
};

// ---------- sheet ----------
async function openSheet(id, quiet = false) {
  if (EMBED) $("#openFull").href = sheetUrl(id);
  let v = await api("/api/sheets/" + id, {}, id);
  if (v.error === "gone" && v.status === 404) {
    if (!quiet) { forgetSheet(id); dropCopy(id); show("gone"); }
    return;
  }
  if (v.error) {
    // no server answers: the last copy this device saw, to read (nothing can be changed until one is back)
    const c = copies()[id];
    if (quiet && !current?.stale) return;
    if (c) {
      current = { ...c.v, stale: c.at };
      renderSheet();
      showMsg("#sheetMsg", t("Can't reach the sheet right now. This is the copy saved on this device ({when}). Signing up works again when it's back.", { when: new Date(c.at).toLocaleString(LANG) }));
    } else showMsg("#sheetMsg", errText(v.error));
    if (!quiet) { show("sheet"); poll(id); }
    return;
  }
  const before = copies()[id]?.v;
  current = v;
  if (v.now) skew = v.now - Date.now();
  keepCopy(id, v);
  const waited = new Set((before?.entries || []).filter((e) => e.mine && e.wait).map((e) => e.id));
  const moved = v.entries.find((e) => e.mine && !e.wait && waited.has(e.id));
  if (moved) toast(t("A spot opened: you're in for {what}", { what: v.sheet.rows.find((r) => r.id === moved.row)?.text || "" }));
  showMsg("#sheetMsg", "");
  const known = mySheets().find((s) => s.id === id);
  if (known || v.entries.some((e) => e.mine)) rememberSheet(id, { title: v.sheet.title, ...(v.old === 0 ? { t2: 1 } : {}) });
  renderSheet();
  if (!quiet) {
    show("sheet");
    poll(id);
  }
  if (known?.pkey || known?.pdoor || known?.nkey) checkPending(id).then(() => { if (keyFor(id) || doorFor(id)) openSheet(id, true); });
}
// How often an open sheet asks for news (round 3, S3: every 8 s in every open tab spent Cloudflare's daily
// allowance): every 8 s while things change, then every 20 s, then every minute once nothing has changed for 10
// minutes; at once when the tab is shown again.
let lastNews = 0, pollDue = 0;
const pace = () => { const idle = Date.now() - lastNews; return idle < 2 * 60e3 ? 8000 : idle < 10 * 60e3 ? 20000 : 60000; };
function pacer(fn) {
  clearTimeout(pollTimer);
  lastNews = Date.now();
  pollDue = Date.now() + pace();
  const tick = () => {
    if (document.visibilityState === "visible" && Date.now() >= pollDue) {
      pollDue = Date.now() + pace();
      const before = current?.changed;
      Promise.resolve(fn()).then(() => { if (current?.changed !== before) lastNews = Date.now(); });
    }
    pollTimer = setTimeout(tick, 1000);
  };
  pollTimer = setTimeout(tick, 1000);
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { lastNews = Date.now(); pollDue = 0; } });
function poll(id) {
  pacer(() => { if ($("#signBox").hidden) return openSheet(id, true); });
}

function renderSheet() {
  const v = current;
  const s = v.sheet;
  const live = !v.stale; // a copy saved on this device: read only
  document.title = s.title + " · Sumate";
  $("#sTitle").textContent = s.title;
  $("#sDetails").textContent = s.details;
  $("#sPlace").hidden = !s.place;
  $("#sPlace").textContent = s.place ? "📍 " + s.place : "";
  $("#editBtn").hidden = !v.owner || !live;
  $("#ownerTools").hidden = !v.owner;
  $("#cleanBtn").hidden = !live;
  if (!v.owner || !live) $("#cleanWrap").hidden = true;
  else if (!$("#cleanWrap").hidden) cleanLabel();
  const now = Date.now() + skew;
  const whole = shut(s, null, now);
  const note = $("#closedNote");
  note.textContent = whole === "notyet" ? t("Sign-ups open {when}.", { when: momentText(s.opens) })
    : whole ? t("Sign-ups are closed.")
    : s.closes ? t("Sign-ups close {when}.", { when: momentText(s.closes) }) : "";
  note.hidden = !note.textContent;
  const on = $("#ownerNote");
  on.hidden = !v.owner;
  on.textContent = v.owner
    ? (s.showNames ? t("You can change or remove anyone and download the list.")
      : t("You are the organizer. Only you see the names; others see how many signed up."))
    : "";

  const byRow = new Map();
  for (const e of v.entries) {
    if (!byRow.has(e.row)) byRow.set(e.row, []);
    byRow.get(e.row).push(e);
  }
  let need = 0, have = 0;
  const wrap = $("#srows");
  wrap.replaceChildren();
  for (const r of s.rows) {
    if (r.heading) { wrap.append(el("h2", "shead", r.text)); continue; }
    const all = byRow.get(r.id) || [];
    const list = all.filter((e) => !e.wait); // in
    const waiting = all.filter((e) => e.wait).sort((a, b) => a.wait - b.wait); // waiting list, in order
    const spots = list.reduce((n, e) => n + qtyOf(e), 0); // someone may take more than one
    if (r.need) { need += r.need; have += Math.min(spots, r.need); }
    const full = r.need && spots >= r.need;
    const card = el("div", "srow" + (full ? " full" : "") + (r.id === justJoined ? " just" : ""));
    const top = el("div", "top");
    top.append(el("span", "what", r.text));
    top.append(el("span", "left",
      full ? (waiting.length ? t("Full · {n} waiting", { n: waiting.length }) : t("Full")) : r.need ? t("{n} of {m}", { n: spots, m: r.need })
        : spots > list.length ? t("{n} taken", { n: spots }) : list.length ? t("{n} signed up", { n: list.length }) : ""));
    card.append(top);
    if (r.date || r.start) {
      const w = whenText(r, LANG, s.tz);
      card.append(el("span", "when", w.text + (w.zone ? " · " + t("{place} time", { place: w.zone }) : "")));
    }
    if (list.length) {
      const people = el("div", "people");
      for (const e of list) {
        // pinned: a final sheet keeps its list once sign-ups are shut (the organizer can still remove anyone)
        const canX = live && (v.owner || (e.mine && !(s.final && shut(s, r, now))));
        const chip = el("span", "person" + (e.mine ? " me" : "") + (e.name ? "" : " anon") + (canX ? "" : " noX"));
        if (e.here) { const k = el("span", "tick", "✓"); k.title = t("Checked in {when}", { when: hereTime(e.here) }); chip.append(k); }
        chip.append(el("span", "", e.name || t("Taken")));
        if (qtyOf(e) > 1) chip.append(el("b", "qty", "×" + qtyOf(e)));
        if (e.note) chip.append(el("i", "", "· " + e.note));
        const said = answersOf(e, s.asks);
        if (said.some(Boolean)) { // only the organizer and the person themselves get these
          chip.append(el("i", "ans", "· " + said.filter(Boolean).join(" · ")));
          chip.title = s.asks.map((q, i) => said[i] && q.text + " " + said[i]).filter(Boolean).join("\n");
        }
        if (canX) {
          const c = el("button", "ed", "✎");
          c.title = e.mine ? t("Change my sign-up") : t("Change {name}", { name: e.name });
          c.setAttribute("aria-label", c.title);
          c.onclick = () => openSign(r, false, e);
          chip.append(c);
          const x = el("button", "x", "×");
          x.title = e.mine ? t("Remove me") : t("Remove {name}", { name: e.name });
          x.setAttribute("aria-label", x.title);
          x.onclick = () => removeEntry(e);
          chip.append(x);
        }
        people.append(chip);
      }
      card.append(people);
    }
    if (waiting.length) {
      const wl = el("div", "people waiting");
      wl.append(el("span", "wlabel", t("Waiting list")));
      for (const e of waiting) {
        const canX = live && (v.owner || (e.mine && !(s.final && shut(s, r, now))));
        const chip = el("span", "person" + (e.mine ? " me" : "") + (e.name ? "" : " anon") + (canX ? "" : " noX"));
        chip.append(el("span", "", e.wait + ". " + (e.name || t("Taken"))));
        if (qtyOf(e) > 1) chip.append(el("b", "qty", "×" + qtyOf(e)));
        if (e.note) chip.append(el("i", "", "· " + e.note));
        const said = answersOf(e, s.asks);
        if (said.some(Boolean)) {
          chip.append(el("i", "ans", "· " + said.filter(Boolean).join(" · ")));
          chip.title = s.asks.map((q, i) => said[i] && q.text + " " + said[i]).filter(Boolean).join("\n");
        }
        if (canX) {
          const c = el("button", "ed", "✎");
          c.title = e.mine ? t("Change my sign-up") : t("Change {name}", { name: e.name });
          c.setAttribute("aria-label", c.title);
          c.onclick = () => openSign(r, false, e);
          chip.append(c);
          const x = el("button", "x", "×");
          x.title = e.mine ? t("Remove me") : t("Remove {name}", { name: e.name });
          x.setAttribute("aria-label", x.title);
          x.onclick = () => removeEntry(e);
          chip.append(x);
        }
        wl.append(chip);
      }
      card.append(wl);
    }
    // check themselves in (the sheet's switch), from the line's day
    for (const e of list.filter((x) => x.mine)) {
      if (!live || !canSelfIn(s, r, now)) break;
      const b = el("button", "btn ghost selfIn" + (e.here ? " on" : ""), e.here ? "✓ " + t("You're checked in") : t("I'm here: check in"));
      b.setAttribute("aria-pressed", String(!!e.here));
      if (list.filter((x) => x.mine).length > 1 && e.name) b.textContent += " · " + e.name;
      b.onclick = () => markHere(e, !e.here, () => renderSheet());
      card.append(b);
    }
    if (r.date && list.some((e) => e.mine)) {
      const c = el("button", "btn link cal", "📅 " + t("Add to my calendar"));
      c.onclick = () => openCal(r);
      card.append(c);
    }
    const why = shut(s, r, now);
    if (why === "locked" && (!full || s.wait)) card.append(el("span", "shut", t("No more sign-ups for this one")));
    // someone who already has the most one person may take: said on the line, no box to fill in for nothing
    const atMost = !v.owner && (s.per || s.perRow) && mostFor(s, r, v.entries.filter((e) => e.mine)) < 1;
    if (atMost && live && (!full || s.wait) && !why) card.append(el("span", "shut", t("You have the most one person can take")));
    else if (live && (!full || s.wait) && (!why || v.owner)) {
      const b = el("button", "btn ghost join" + (full ? " wait" : ""), full ? t("Join the waiting list") : t("Sign up"));
      b.onclick = () => openSign(r);
      card.append(b);
    }
    wrap.append(card);
  }
  const counted = need > 0;
  $("#fill").style.width = counted ? Math.round((100 * have) / need) + "%" : "0";
  $("#fill").parentElement.hidden = !counted;
  $("#count").textContent = counted
    ? t("{n} of {m} spots filled", { n: have, m: need })
    : t("{n} signed up", { n: v.entries.length });
}

// ---------- check-in (like SignUpGenius' Participant Check-In) ----------
const hereTime = (ms) => new Intl.DateTimeFormat(LANG, { hour: "numeric", minute: "2-digit" }).format(ms);
async function markHere(e, on, then) {
  const id = current.id;
  const r = await api(`/api/sheets/${id}/signups/${e.id}/here`, { method: "POST", body: { on } }, id);
  if (r.error) { openSheet(id, true); return toast(errText(r.error)); }
  current = r;
  keepCopy(id, r);
  then();
}

let doorQuery = "";
async function openDoor(id, quiet = false) {
  const v = await api("/api/sheets/" + id, {}, id);
  if (v.error === "gone" && v.status === 404) { if (!quiet) show("gone"); return; }
  if (v.error) { showMsg("#doorMsg", errText(v.error)); if (!quiet) { show("door"); pollDoor(id); } return; }
  current = v;
  if (v.now) skew = v.now - Date.now();
  if (!v.door) { // the link was replaced or turned off: the sheet as anyone sees it
    if (doorFor(id)) { rememberSheet(id, { door: "" }); toast(t("This check-in link was turned off or replaced. Ask the organizer for the new one.")); }
    return go("/s/" + id, true);
  }
  rememberSheet(id, { title: v.sheet.title });
  showMsg("#doorMsg", "");
  renderDoor();
  if (!quiet) { $("#dSearch").value = doorQuery = ""; show("door"); pollDoor(id); }
}
function pollDoor(id) {
  pacer(() => { if ($("#signBox").hidden && document.activeElement?.classList?.contains("hereBtn") !== true) return openDoor(id, true); });
}
const fold = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
function renderDoor() {
  const v = current;
  const s = v.sheet;
  document.title = t("Check-in") + " · " + s.title;
  $("#dTitle").textContent = s.title;
  $("#doorShare").hidden = !v.owner;
  const q = fold(doorQuery.trim());
  const wrap = $("#drows");
  wrap.replaceChildren();
  let total = 0, came = 0, shown = 0;
  const now = Date.now() + skew;
  for (const r of s.rows) {
    if (r.heading) { if (!q) wrap.append(el("h2", "shead", r.text)); continue; }
    const list = v.entries.filter((e) => e.row === r.id && !e.wait); // the waiting list is not in
    const spots = list.reduce((n, e) => n + qtyOf(e), 0);
    const inN = list.filter((e) => e.here).reduce((n, e) => n + qtyOf(e), 0);
    total += spots; came += inN;
    const rowHit = !q || fold(r.text).includes(q);
    const people = rowHit ? list : list.filter((e) => fold(e.name).includes(q) || fold(e.note).includes(q));
    if (q && !people.length) continue;
    shown++;
    const card = el("div", "srow");
    card.dataset.row = r.id;
    const top = el("div", "top");
    top.append(el("span", "what", r.text));
    // pinned: a line counts who came against who signed up (SignUpGenius: "checked in vs. total spots filled")
    top.append(el("span", "left" + (spots && inN >= spots ? " in" : ""), t("{n} of {m} here", { n: inN, m: spots })));
    card.append(top);
    if (r.date || r.start) {
      const w = whenText(r, LANG, s.tz, now);
      card.append(el("span", "when", w.text + (w.zone ? " · " + t("{place} time", { place: w.zone }) : "")));
    }
    const dl = el("div", "dlist");
    for (const e of people) {
      const row = el("div", "dperson" + (e.here ? " on" : ""));
      row.dataset.entry = e.id;
      const who = el("div", "who");
      who.append(el("b", "", e.name + (qtyOf(e) > 1 ? " ×" + qtyOf(e) : "")));
      if (e.note) who.append(el("i", "", e.note));
      if (e.here) who.append(el("span", "at", t("Here since {when}", { when: hereTime(e.here) })));
      row.append(who);
      const b = el("button", "hereBtn" + (e.here ? " on" : ""), e.here ? "✓ " + t("Here") : t("Check in"));
      b.setAttribute("aria-pressed", String(!!e.here));
      b.title = e.here ? t("Tap again to undo") : "";
      b.onclick = async () => {
        b.disabled = true;
        await markHere(e, !e.here, () => renderDoor());
        b.disabled = false;
      };
      row.append(b);
      dl.append(row);
    }
    if (people.length) card.append(dl);
    // someone who just turned up (SignUpGenius' walk-ups): added and checked in at once
    const add = el("button", "btn link walkup", "+ " + t("Someone who just came"));
    add.onclick = () => openSign(r, true);
    card.append(add);
    wrap.append(card);
  }
  $("#dNone").hidden = !q || shown > 0;
  $("#dFill").style.width = total ? Math.round((100 * came) / total) + "%" : "0";
  $("#dCount").textContent = t("{n} of {m} here", { n: came, m: total });
}
$("#dSearch").oninput = () => { doorQuery = $("#dSearch").value; renderDoor(); };
$("#doorBack").onclick = () => (current?.owner ? go("/s/" + current.id) : go("/"));
$("#doorBtn").onclick = () => go("/s/" + current.id + "/door");
$("#doorShare").onclick = () => openShare();

async function removeEntry(e) {
  const id = current.id;
  const r = await api(`/api/sheets/${id}/signups/${e.id}`, { method: "DELETE" }, id);
  if (r.error) { if (r.error === "final") openSheet(id, true); return toast(errText(r.error)); }
  current = r;
  keepCopy(id, r);
  renderSheet();
  toast(e.mine ? t("Removed you") : t("Removed {name}", { name: e.name }));
}

// ---------- sign-up box ----------
const signId = () => [...crypto.getRandomValues(new Uint8Array(8))].map((b) => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");
let signRow = null;
let justJoined = null; // the line this device just signed up for: shown lit for a moment
let signHere = false; // added at the check-in: in and checked in at once
let signChange = null; // the sign-up being changed (like SignUpGenius' Edit / Swap; the organizer's Move)
const spotsOn = (r, but) => current.entries.filter((e) => e.row === r.id && e !== but).reduce((n, e) => n + qtyOf(e), 0); // in and waiting
/** How many one may take on this line (and why not more), for a new sign-up or the one being changed. */
function fitQty(r) {
  const s = current.sheet;
  const ch = signChange;
  const taken = spotsOn(r, ch);
  const stays = ch && ch.row === r.id;
  // pinned: a change moves only onto room (no waiting list); the organizer onto a full line by trading places
  const roomOnly = ch && !(stays && ch.wait);
  const mine = current.entries.filter((e) => e.mine && e !== ch);
  const most = current.owner || signHere ? Infinity : mostFor(s, r, mine);
  const room = r.need ? (signHere ? MAX_QTY : s.wait && !roomOnly ? r.need : r.need - taken) : MAX_QTY;
  const top = Math.min(MAX_QTY, most, room);
  const q = $("#signQty");
  q.max = String(Math.max(1, top));
  if (!ch || Number(q.value) > top) q.value = String(Math.max(1, Math.min(top, ch ? qtyOf(ch) : 1)));
  $("#signQtyWrap").hidden = !s.qty || top < 2;
  const lim = [s.per && t("Up to {n} per person on this sheet", { n: s.per }), s.perRow && t("Up to {n} per person on each line", { n: s.perRow })].filter(Boolean);
  const rowDone = s.perRow && mostFor({ perRow: s.perRow }, r, mine) < 1;
  $("#signLimit").textContent = most < 1
    ? (rowDone ? t("You already have {n} on this line, the most one person can take.", { n: s.perRow })
      : t("You already have {n} on this sheet, the most one person can take.", { n: s.per }))
    : lim.join(" · ");
  $("#signLimit").hidden = !lim.length;
  const isFull = r.need && taken >= r.need;
  $("#signWait").hidden = !isFull || signHere || !!ch;
  // the organizer moving someone onto a full line: they trade places with someone there
  const trade = !!(ch && !stays && isFull && current.owner);
  $("#signWithWrap").hidden = !trade;
  if (trade) {
    const w = $("#signWith");
    w.replaceChildren(new Option(t("Choose one"), ""));
    for (const e of current.entries.filter((x) => x.row === r.id && !!x.wait === !!ch.wait)) w.append(new Option(e.name + (qtyOf(e) > 1 ? " ×" + qtyOf(e) : ""), e.id));
  }
  $("#signWith").required = trade;
  $("#signRow").textContent = ch ? (ch.mine ? t("Change my sign-up") : t("Change {name}", { name: ch.name })) : r.text;
  $("#signForm").querySelector(".btn.primary").disabled = most < 1 || (ch && !stays && isFull && !current.owner);
}
function openSign(r, walkUp = false, change = null) {
  signRow = r;
  signHere = walkUp;
  signChange = change;
  $("#signDoor").hidden = !walkUp;
  const s = current.sheet;
  const mv = $("#signMove");
  mv.hidden = !change;
  if (change) {
    const pick = $("#signLine");
    pick.replaceChildren();
    const now = Date.now() + skew;
    let group = null;
    for (const x of s.rows) {
      if (x.heading) { group = el("optgroup"); group.label = x.text; pick.append(group); continue; }
      const w = x.date || x.start ? " · " + whenText(x, LANG, s.tz).text : "";
      const full = x.need && spotsOn(x, change) + 1 > x.need;
      const o = new Option(x.text + w + (x.id !== change.row && full ? " · " + t("Full") : ""), x.id);
      // a person: only lines taking sign-ups, with room; the organizer: any line (a full one by trading places)
      if (x.id !== change.row && !current.owner && (full || shut(s, x, now))) o.disabled = true;
      (group || pick).append(o);
    }
    pick.value = change.row;
  }
  fitQty(r);
  $("#signNameLbl").textContent = change && !change.mine ? t("Name") : t("Your name");
  $("#signName").value = change ? change.name : walkUp ? "" : safeGet("sumate.name") || "";
  $("#signNote").value = change ? change.note || "" : "";
  const box = $("#signAsks");
  box.replaceChildren();
  for (const q of current.sheet.asks || []) {
    const lbl = el("label", "lbl", q.req ? q.text : t("{q} (optional)", { q: q.text }));
    lbl.htmlFor = "ask-" + q.id;
    let f;
    if (q.opts.length) {
      f = el("select");
      f.append(new Option(t("Choose one"), ""));
      for (const o of q.opts) f.append(new Option(o, o));
    } else {
      f = el("input");
      f.maxLength = 200;
    }
    f.id = "ask-" + q.id;
    f.dataset.ask = q.id;
    f.required = q.req && !current.owner && !walkUp; // the organizer (or the check-in) may add someone without the answers
    if (change) f.value = change.ans && Object.hasOwn(change.ans, q.id) ? change.ans[q.id] : "";
    box.append(lbl, f);
  }
  showMsg("#signMsg", "");
  $("#signBox").hidden = false;
  $("#signForm").querySelector(".btn.primary").textContent = change ? t("Save") : walkUp ? t("Add and check in") : t("Add me");
  (change ? $("#signLine") : $("#signName").value ? $("#signNote") : $("#signName")).focus();
}
$("#signLine").onchange = () => { signRow = current.sheet.rows.find((x) => x.id === $("#signLine").value) || signRow; fitQty(signRow); };
$("#signCancel").onclick = closeBoxes;
const askValues = () => Object.fromEntries([...$("#signAsks").querySelectorAll("[data-ask]")].map((f) => [f.dataset.ask, f.value]));
async function saveChange() {
  const ch = signChange;
  const id = current.id;
  const name = $("#signName").value.trim();
  if (!name) return $("#signName").focus();
  if (ch.mine) safeSet("sumate.name", name);
  const btn = $("#signForm").querySelector(".btn.primary");
  btn.disabled = true;
  const to = signRow;
  const trade = !$("#signWithWrap").hidden && $("#signWith").value;
  const other = trade && current.entries.find((x) => x.id === trade);
  const r = await api(`/api/sheets/${id}/signups/${ch.id}`, {
    method: "POST",
    body: { row: to.id, name, note: $("#signNote").value, qty: Number($("#signQty").value) || 1, ans: askValues(), ...(trade ? { with: trade } : {}) },
  }, id);
  btn.disabled = false;
  if (r.error) {
    showMsg("#signMsg", r.error === "nosign" ? t("That sign-up isn't there any more.") : errText(r.error));
    if (["full", "few", "closed", "notyet", "locked", "final", "nosign"].includes(r.error)) openSheet(id, true);
    return;
  }
  current = r;
  keepCopy(id, current);
  closeBoxes();
  justJoined = to.id;
  renderSheet();
  $(".srow.just")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  setTimeout(() => { justJoined = null; $(".srow.just")?.classList.remove("just"); }, 2500);
  toast(to.id === ch.row ? t("Saved") : other ? t("{a} and {b} traded places", { a: name, b: other.name })
    : ch.mine ? t("Moved you to {line}", { line: to.text }) : t("Moved {name} to {line}", { name, line: to.text }));
}
$("#signForm").onsubmit = async (e) => {
  e.preventDefault();
  if (signChange) return saveChange();
  const name = $("#signName").value.trim();
  if (!name) return $("#signName").focus();
  if (!signHere) safeSet("sumate.name", name);
  const id = current.id;
  const btn = $("#signForm").querySelector(".btn.primary");
  btn.disabled = true;
  const r = await api(`/api/sheets/${id}/signups`, {
    method: "POST",
    // its own id: sent again to the other server (no answer from the first), it is still one sign-up
    // a walk-up gets their own token: it isn't this device's sign-up
    body: { id: signId(), row: signRow.id, name, note: $("#signNote").value, token: signHere ? signId() + signId() : await tokenFor(id), qty: Number($("#signQty").value) || 1, here: signHere || undefined,
      ans: askValues() },
  }, id);
  btn.disabled = false;
  if (r.error) {
    showMsg("#signMsg", errText(r.error));
    if (["full", "few", "closed", "notyet", "locked"].includes(r.error)) openSheet(id, true);
    return;
  }
  current = r.view;
  if (signHere) {
    closeBoxes();
    renderDoor();
    return toast(t("{name} added and checked in", { name }));
  }
  keepCopy(id, current);
  rememberSheet(id, { title: current.sheet.title });
  closeBoxes();
  renderSheet();
  const placed = current.entries.find((x) => x.mine && x.wait && x.row === signRow.id);
  if (placed && !current.entries.some((x) => x.mine && !x.wait && x.row === signRow.id)) {
    justJoined = signRow.id;
    renderSheet();
    $(".srow.just")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    setTimeout(() => { justJoined = null; $(".srow.just")?.classList.remove("just"); }, 2500);
    return toast(t("You're on the waiting list, number {n}", { n: placed.wait }));
  }
  // a line with a day: like a thank-you page, straight to the calendar buttons (it says "You're in" itself)
  if (signRow.date) openCal(signRow, true);
  else {
    justJoined = signRow.id;
    renderSheet();
    $(".srow.just")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    setTimeout(() => { justJoined = null; $(".srow.just")?.classList.remove("just"); }, 2500);
  }
};

// ---------- add to my calendar ----------
function calEvent(r) {
  const s = current.sheet;
  const url = sheetUrl(current.id);
  return {
    uid: current.id + "-" + r.id + "@sumate.jurisgames.com",
    title: r.text + " · " + s.title,
    place: s.place,
    details: [s.details, url].filter(Boolean).join("\n\n"),
    url,
    slot: slotOf(r, s.tz),
  };
}
let calRow = null;
function openCal(r, justIn = false) {
  calRow = r;
  const ev = calEvent(r);
  $("#calHi").textContent = justIn ? t("You're in. Add it to your calendar?") : t("Add to your calendar");
  $("#calWhat").textContent = r.text;
  const w = whenText(r, LANG, current.sheet.tz);
  $("#calWhen").textContent = w.text + (w.zone ? " · " + t("{place} time", { place: w.zone }) : "");
  // the reminder goes in the .ics file; a whole-day line has no "1 hour before", it gets "that morning"
  const allDay = ev.slot.allDay;
  const words = { "0": "No reminder", h1: allDay ? "That morning" : "1 hour before", d1: "1 day before", d2: "2 days before", w1: "1 week before" };
  for (const o of $("#calRemind").options) o.textContent = t(words[o.value]);
  const saved = localStorage.getItem("sumate.remind");
  $("#calRemind").value = REMINDERS.includes(saved) ? saved : "d1";
  $("#calGoogle").href = googleLink(ev);
  $("#calOutlook").href = outlookLink(ev);
  $("#calBox").hidden = false;
}
$("#calRemind").onchange = () => localStorage.setItem("sumate.remind", $("#calRemind").value);
$("#calIcs").onclick = () => {
  const ev = calEvent(calRow);
  ev.alarm = alarmTrigger($("#calRemind").value, ev.slot.allDay);
  const a = el("a");
  a.href = URL.createObjectURL(new Blob([icsText(ev)], { type: "text/calendar;charset=utf-8" }));
  a.download = (calRow.text.replace(/[^\p{L}\p{N} _-]+/gu, "").trim() || "sumate") + ".ics";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
$("#calClose").onclick = () => { $("#calBox").hidden = true; };

// ---------- share ----------
const sheetUrl = (id) => location.origin + BASE + "s/" + id;
function openShare(firstTime = false) {
  const id = here().split("/")[2] || current?.id; // the page shown: right after saving a new sheet, current is still the last one
  const url = sheetUrl(id);
  $("#shareLink").value = url;
  const key = keyFor(id);
  $("#ownerLinkWrap").hidden = !key;
  $("#ownerLink").value = key ? url + "#k=" + key : "";
  $("#nativeShare").hidden = !navigator.share;
  showDoorLink();
  const q = $("#qr");
  q.replaceChildren();
  if (window.qrcode) {
    const code = window.qrcode(0, "M");
    code.addData(url);
    code.make();
    q.innerHTML = code.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  }
  $("#shareBox").hidden = false;
}
$("#shareBtn").onclick = () => openShare();
function showDoorLink() {
  const v = current;
  $("#doorLinkWrap").hidden = !v?.owner || v.stale;
  if (!v?.owner) return;
  $("#doorLinkOn").hidden = !v.doorKey;
  $("#doorLink").value = v.doorKey ? sheetUrl(v.id) + "/door#d=" + v.doorKey : "";
  $("#doorMake").textContent = v.doorKey ? t("New link (the old one stops working)") : t("Make a check-in link");
  $("#doorOff").hidden = !v.doorKey;
}
async function setDoor(on) {
  const id = current.id;
  const r = await api(`/api/sheets/${id}/door`, { method: on ? "POST" : "DELETE" }, id);
  if (r.error) return toast(errText(r.error));
  current = r;
  showDoorLink();
  toast(on ? t("Check-in link ready") : t("Check-in link turned off"));
}
$("#doorMake").onclick = () => setDoor(true);
$("#doorOff").onclick = () => setDoor(false);
$("#copyDoor").onclick = () => copy($("#doorLink").value);
$("#copyLink").onclick = () => copy($("#shareLink").value);
$("#copyOwner").onclick = () => copy($("#ownerLink").value);
// a new organizer link (round 3, S7): for one shared by mistake. Two taps; the old one stops working everywhere.
$("#keyNew").onclick = async () => {
  const b = $("#keyNew");
  if (!b.dataset.sure) {
    b.dataset.sure = "1";
    b.textContent = t("Tap again: the old organizer link stops working");
    setTimeout(() => { delete b.dataset.sure; b.textContent = t("New organizer link (the old one stops working)"); }, 4000);
    return;
  }
  delete b.dataset.sure;
  b.textContent = t("New organizer link (the old one stops working)");
  const id = current.id;
  // the new key is made here and kept before asking (second-pass S2-5): a lost answer can't leave the sheet with a key
  // nobody has. If no answer comes, the sheet is asked with the new key (now, and when the app opens it next).
  const nkey = [...crypto.getRandomValues(new Uint8Array(24))].map((x) => "abcdefghijkmnpqrstuvwxyz23456789"[x % 32]).join("");
  rememberSheet(id, { nkey });
  let r = await api(`/api/sheets/${id}/key`, { method: "POST", body: { key: nkey } }, id);
  if (r.error || !r.key) {
    const v = await api("/api/sheets/" + id, {}, id, { key: nkey });
    if (!v.owner) {
      if (!v.error) rememberSheet(id, { nkey: "" }); // a server answered: the old key still holds
      return toast(errText(r.error));
    }
    r = { key: nkey, view: v };
  }
  rememberSheet(id, { key: r.key, nkey: "" });
  current = r.view;
  keepCopy(id, current);
  openShare();
  toast(t("New organizer link ready. Keep it private."));
};

// remove everyone who signed up in the last hour / 6 hours / day (round 3, S2: someone filled a sheet with made-up
// sign-ups). Two taps; the organizer's own additions at the door are not touched.
const recent = () => {
  const since = Date.now() + skew - Number($("#cleanSpan").value) * 3600e3;
  return (current?.entries || []).filter((e) => e.at && e.at >= since && (!e.here || e.byDoor)); // helpers' additions too (S2-7b)
};
function cleanLabel() {
  const b = $("#cleanGo");
  delete b.dataset.sure;
  const n = recent().length;
  b.textContent = t("Remove {n} sign-ups", { n });
  b.disabled = !n;
}
$("#cleanBtn").onclick = () => { $("#cleanWrap").hidden = !$("#cleanWrap").hidden; cleanLabel(); };
$("#cleanSpan").onchange = cleanLabel;
$("#cleanGo").onclick = async () => {
  const b = $("#cleanGo");
  const ids = recent().map((e) => e.id);
  if (!ids.length) return;
  if (!b.dataset.sure) {
    b.dataset.sure = "1";
    b.textContent = t("Tap again to remove {n} sign-ups for everyone", { n: ids.length });
    setTimeout(() => { if (b.dataset.sure) cleanLabel(); }, 4000);
    return;
  }
  const id = current.id;
  const r = await api(`/api/sheets/${id}/signups/remove`, { method: "POST", body: { ids } }, id);
  if (r.error) return toast(errText(r.error));
  current = r;
  keepCopy(id, r);
  $("#cleanWrap").hidden = true;
  renderSheet();
  toast(t("Removed {n} sign-ups", { n: ids.length }));
};
$("#nativeShare").onclick = () => {
  const s = current?.sheet;
  navigator.share({ title: s?.title || "Sumate", text: s?.title, url: $("#shareLink").value }).catch(() => {});
};
$("#shareClose").onclick = closeBoxes;

// website code: the sheet itself in an iframe that grows with it, or a button that opens it (like SignUpGenius'
// "share on website"; theirs embeds only on the paid plan)
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
function embedCode() {
  const url = $("#shareLink").value;
  const title = current?.sheet?.title || "Sumate";
  if ($("#embedKind").value === "button")
    return `<a href="${esc(url)}" target="_blank" rel="noopener" style="display:inline-block;padding:12px 22px;border-radius:999px;background:#0f5e57;color:#fff;font:600 17px system-ui,sans-serif;text-decoration:none">${esc(t("Sign up: {title}", { title }))}</a>`;
  const origin = new URL(url).origin;
  return `<iframe src="${esc(url)}?embed" title="${esc(title)}" loading="lazy" style="width:100%;max-width:760px;height:640px;border:0"></iframe>\n`
    + `<script>addEventListener("message",function(e){if(e.origin!=="${origin}"||!e.data||!e.data.sumate)return;`
    + `document.querySelectorAll("iframe").forEach(function(f){if(f.contentWindow===e.source)f.style.height=e.data.sumate+"px"})})</script>`;
}
$("#embedBtn").onclick = () => {
  $("#embedWrap").hidden = !$("#embedWrap").hidden;
  $("#embedCode").value = embedCode();
};
$("#embedKind").onchange = () => { $("#embedCode").value = embedCode(); };
$("#copyEmbed").onclick = () => copy($("#embedCode").value);

if (EMBED) {
  document.body.classList.add("embed");
  // the page is as tall as the iframe, so a box or a message shows next to what was tapped, not at the bottom
  let tapY = 0;
  addEventListener("pointerdown", (e) => {
    tapY = e.pageY;
    document.body.style.setProperty("--toastAt", Math.max(8, tapY + 30) + "px");
    // before a box opens (its field takes focus at once, and focus scrolls the page around to it); a tap inside an
    // open box leaves it where it is
    if (e.target.closest?.(".sheetbox")) return;
    const page = document.querySelector(".page:not([hidden])")?.offsetHeight || 0;
    document.body.style.setProperty("--at", Math.max(8, Math.min(tapY - 80, page - 420)) + "px");
  }, true);
  for (const box of document.querySelectorAll(".sheetbox")) {
    new MutationObserver(() => {
      if (box.hidden) { document.body.style.minHeight = ""; return; }
      const b = box.querySelector(".box");
      const page = document.querySelector(".page:not([hidden])")?.offsetHeight || 0;
      document.body.style.minHeight = b.offsetHeight + 16 + "px";
      document.body.style.setProperty("--at", Math.max(8, Math.min(tapY - 80, page - b.offsetHeight - 8)) + "px");
      document.activeElement?.scrollIntoView?.({ block: "nearest" });
    }).observe(box, { attributes: true, attributeFilter: ["hidden"] });
  }
  // tell the page around it how tall the sheet is (its website code resizes the iframe)
  let lastH = 0;
  const tell = () => {
    const p = document.querySelector(".page:not([hidden])");
    const h = Math.ceil(Math.max(p ? p.offsetHeight : 0, parseFloat(document.body.style.minHeight) || 0));
    if (h && h !== lastH && parent !== window) { lastH = h; parent.postMessage({ sumate: h }, "*"); }
  };
  new ResizeObserver(tell).observe(document.body);
  for (const p of PAGES) new ResizeObserver(tell).observe($("#" + p));
}

function closeBoxes() {
  $("#signBox").hidden = true;
  $("#shareBox").hidden = true;
  $("#calBox").hidden = true;
}
for (const box of [$("#signBox"), $("#shareBox"), $("#calBox")]) {
  box.addEventListener("click", (e) => { if (e.target === box) closeBoxes(); });
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeBoxes(); });

$("#sheetBack").onclick = () => go("/");
$("#editBtn").onclick = () => go("/s/" + current.id + "/edit");
$("#copyBtn").onclick = () => go("/s/" + current.id + "/copy");
$("#goneHome").onclick = () => go("/new");

// ---------- CSV ----------
$("#csvBtn").onclick = () => {
  const v = current;

  const cell = (x) => {
    let s = String(x ?? "").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
    // keep spreadsheets from running it as a formula, also after leading spaces or control characters (APP-RULES 70)
    if (typeof x !== "number" && /^[=+\-@]/.test(s.replace(/^[\s\x00-\x1f]+/, ""))) s = "'" + s;
    return /[",\r\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const asks = v.sheet.asks || [];
  const dated = v.sheet.rows.some((r) => r.date || r.start);
  const waits = v.entries.some((x) => x.wait);
  const many = v.sheet.qty || v.entries.some((x) => qtyOf(x) > 1);
  const came = v.sheet.selfIn || !!v.doorKey || v.entries.some((x) => x.here); // check-in used: who came, and when
  const lines = [[t("Line"), t("Name"), ...(many ? [t("How many")] : []), t("Note"), t("When"), ...(dated ? [t("Day"), t("Time")] : []), ...(waits ? [t("Waiting list")] : []), ...(came ? [t("Checked in")] : []), ...asks.map((q) => q.text)].map(cell).join(",")];
  for (const r of v.sheet.rows) {
    if (r.heading) continue;
    for (const e of v.entries.filter((x) => x.row === r.id)) {
      const slot = dated ? [r.date || "", r.start ? r.start + (r.end ? "-" + r.end : "") : ""] : [];
      lines.push([r.text, e.name, ...(many ? [qtyOf(e)] : []), e.note, e.at ? new Date(e.at).toLocaleString(LANG) : "", ...slot, ...(waits ? [e.wait || ""] : []), ...(came ? [e.here ? new Date(e.here).toLocaleString(LANG) : ""] : []), ...answersOf(e, asks)].map(cell).join(","));
    }
  }
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = el("a");
  a.href = URL.createObjectURL(blob);
  a.download = (v.sheet.title.replace(/[^\p{L}\p{N} _-]+/gu, "").trim() || "sumate") + ".csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};

route();

// the offline page (sw.js): opening the app with no connection shows ours, not the browser's error page
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
