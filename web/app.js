// Sumate: free sign-up sheets. Plain JS, no build step.
import { t, translatePage, LANG } from "./i18n.js";
import { openFeedback } from "./feedback.js";
// the folder the app lives in: "/" on signup.jurisgames.com, "/sumate/" on the copy at GitHub Pages
const BASE = new URL(".", import.meta.url).pathname;
const here = () => "/" + location.pathname.slice(BASE.length); // the app's own path ("/s/abc...")

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
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch {} }

function deviceToken() {
  let tok = safeGet("sumate.token");
  if (!/^[a-z0-9]{20}$/.test(tok || "")) {
    const a = crypto.getRandomValues(new Uint8Array(20));
    tok = [...a].map((b) => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");
    safeSet("sumate.token", tok);
  }
  return tok;
}
const TOKEN = deviceToken();

function mySheets() {
  try { return JSON.parse(safeGet("sumate.sheets") || "[]").filter((s) => s && s.id); } catch { return []; }
}
function rememberSheet(id, patch) {
  const all = mySheets();
  const old = all.find((s) => s.id === id) || { id };
  const next = { ...old, ...patch, seen: Date.now() };
  safeSet("sumate.sheets", JSON.stringify([next, ...all.filter((s) => s.id !== id)].slice(0, 100)));
}
function forgetSheet(id) {
  safeSet("sumate.sheets", JSON.stringify(mySheets().filter((s) => s.id !== id)));
}
const keyFor = (id) => mySheets().find((s) => s.id === id)?.key || "";

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
  toastTimer = setTimeout(() => (d.hidden = true), 2600);
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
const RP = new URLSearchParams(location.search);
const OURS = /(^|\.)jurisgames\.com$|\.github\.io$/.test(location.hostname);
const SERVERS = [
  RP.get("server") || (location.hostname.endsWith(".github.io") ? "https://signup.jurisgames.com" : ""),
  RP.get("server2") || (OURS && !RP.get("server") ? "https://games.jurisgames.com/sumate" : null),
].filter((s) => s !== null);
let at = 0;
try { at = Math.min(Number(sessionStorage.getItem("sumate.server")) || 0, SERVERS.length - 1); } catch {}

async function api(path, opts = {}, id) {
  const headers = { "X-Sign-Tokens": TOKEN };
  const key = id && keyFor(id);
  if (key) headers["X-Sheet-Key"] = key;
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
    let data = {};
    try { data = await r.json(); } catch {}
    if (r.status >= 500) { failed = { error: r.status === 503 ? "offline" : data.error || "error", status: r.status }; continue; }
    if (at !== i) { at = i; try { sessionStorage.setItem("sumate.server", String(i)); } catch {} }
    if (!r.ok) return { error: data.error || "error", status: r.status };
    return data;
  }
  return failed;
}
const errText = (e) => ({
  offline: t("No connection. Try again."),
  full: t("Someone just took the last spot."),
  closed: t("Sign-ups are closed."),
  gone: t("This sheet doesn't exist"),
}[e] || t("Something went wrong. Try again."));

// ---------- routing ----------
const PAGES = ["home", "edit", "sheet", "gone"];
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
  const hk = location.hash.match(/^#k=([a-z0-9]{24})$/);
  const m = p.match(/^\/s\/([a-z0-9]{10})(\/edit)?$/);
  if (m && hk) {
    rememberSheet(m[1], { key: hk[1] });
    history.replaceState(null, "", location.pathname + location.search);
  }
  if (p === "/new") return openEditor(null);
  if (m && m[2]) return openEditor(m[1]);
  if (m) return openSheet(m[1]);
  return openHome();
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
    b.append(el("span", s.key ? "tag" : "tag alt", s.key ? t("Yours") : t("Signed up")));
    b.onclick = () => go("/s/" + s.id);
    li.append(b);
    list.append(li);
  }
  show("home");
}
$("#makeBtn").onclick = () => go("/new");

// ---------- editor ----------
let editId = null;

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
  const x = el("button", "x", "×");
  x.type = "button";
  x.title = t("Remove");
  x.onclick = () => li.remove();
  li.append(x);
  return li;
}

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
    showNames: $("#showNames").checked,
    open: $("#openSw").checked,
    rows: [...$("#rows").children].map((li) => ({
      id: li.dataset.id || undefined,
      text: li.querySelector("input").value,
      heading: !!li.dataset.heading,
      need: li.need,
    })).filter((r) => r.text.trim()),
  };
}

async function openEditor(id) {
  editId = id;
  showMsg("#editMsg", "");
  $("#rows").replaceChildren();
  $("#delSheet").hidden = !id;
  $("#editHead").textContent = id ? t("Edit sheet") : t("New sheet");
  let s = { title: "", details: "", showNames: true, open: true, rows: [{ need: 1 }, { need: 1 }, { need: 1 }] };
  if (id) {
    if (!keyFor(id)) return go("/s/" + id, true);
    const v = await api("/api/sheets/" + id, {}, id);
    if (v.error) return v.status === 404 ? show("gone") : go("/s/" + id, true); // no server: the sheet page says so
    s = v.sheet;
  }
  $("#title").value = s.title;
  $("#details").value = s.details;
  $("#showNames").checked = s.showNames;
  $("#openSw").checked = s.open;
  for (const r of s.rows) $("#rows").append(rowEl(r));
  show("edit");
  if (!id) $("#title").focus();
}

$("#editBack").onclick = () => (editId ? go("/s/" + editId) : go("/"));

$("#saveBtn").onclick = async () => {
  const s = readEditor();
  if (!s.title.trim()) { showMsg("#editMsg", t("Give the sheet a title.")); $("#title").focus(); return; }
  if (!s.rows.some((r) => !r.heading)) { showMsg("#editMsg", t("Add at least one line.")); return; }
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
  if (r.error && r.status !== 404) return showMsg("#editMsg", errText(r.error));
  forgetSheet(editId);
  dropCopy(editId);
  toast(t("Sheet deleted"));
  go("/", true);
};

// ---------- sheet ----------
async function openSheet(id, quiet = false) {
  let v = await api("/api/sheets/" + id, {}, id);
  if (v.error && v.status === 404) {
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
  current = v;
  keepCopy(id, v);
  showMsg("#sheetMsg", "");
  const known = mySheets().find((s) => s.id === id);
  if (known || v.entries.some((e) => e.mine)) rememberSheet(id, { title: v.sheet.title });
  renderSheet();
  if (!quiet) {
    show("sheet");
    poll(id);
  }
}
function poll(id) {
  clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    if (document.visibilityState === "visible" && $("#signBox").hidden) openSheet(id, true);
  }, 8000);
}

function renderSheet() {
  const v = current;
  const s = v.sheet;
  const live = !v.stale; // a copy saved on this device: read only
  document.title = s.title + " · Sumate";
  $("#sTitle").textContent = s.title;
  $("#sDetails").textContent = s.details;
  $("#editBtn").hidden = !v.owner || !live;
  $("#ownerTools").hidden = !v.owner;
  $("#closedNote").hidden = s.open;
  const on = $("#ownerNote");
  on.hidden = !v.owner;
  on.textContent = v.owner
    ? (s.showNames ? t("You are the organizer: you can edit, remove anyone, and download the list.")
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
    const list = byRow.get(r.id) || [];
    if (r.need) { need += r.need; have += Math.min(list.length, r.need); }
    const full = r.need && list.length >= r.need;
    const card = el("div", "srow" + (full ? " full" : ""));
    const top = el("div", "top");
    top.append(el("span", "what", r.text));
    top.append(el("span", "left",
      full ? t("Full") : r.need ? t("{n} of {m}", { n: list.length, m: r.need }) : list.length ? t("{n} signed up", { n: list.length }) : ""));
    card.append(top);
    if (list.length) {
      const people = el("div", "people");
      for (const e of list) {
        const canX = live && (e.mine || v.owner);
        const chip = el("span", "person" + (e.mine ? " me" : "") + (e.name ? "" : " anon") + (canX ? "" : " noX"));
        chip.append(el("span", "", e.name || t("Taken")));
        if (e.note) chip.append(el("i", "", "· " + e.note));
        if (canX) {
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
    if (live && !full && (s.open || v.owner)) {
      const b = el("button", "btn ghost join", t("Sign up"));
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

async function removeEntry(e) {
  const id = current.id;
  const r = await api(`/api/sheets/${id}/signups/${e.id}`, { method: "DELETE" }, id);
  if (r.error) return toast(errText(r.error));
  current = r;
  keepCopy(id, r);
  renderSheet();
  toast(e.mine ? t("Removed you") : t("Removed {name}", { name: e.name }));
}

// ---------- sign-up box ----------
const signId = () => [...crypto.getRandomValues(new Uint8Array(8))].map((b) => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");
let signRow = null;
function openSign(r) {
  signRow = r;
  $("#signRow").textContent = r.text;
  $("#signName").value = safeGet("sumate.name") || "";
  $("#signNote").value = "";
  showMsg("#signMsg", "");
  $("#signBox").hidden = false;
  ($("#signName").value ? $("#signNote") : $("#signName")).focus();
}
$("#signCancel").onclick = closeBoxes;
$("#signForm").onsubmit = async (e) => {
  e.preventDefault();
  const name = $("#signName").value.trim();
  if (!name) return $("#signName").focus();
  safeSet("sumate.name", name);
  const id = current.id;
  const btn = $("#signForm").querySelector(".btn.primary");
  btn.disabled = true;
  const r = await api(`/api/sheets/${id}/signups`, {
    method: "POST",
    // its own id: sent again to the other server (no answer from the first), it is still one sign-up
    body: { id: signId(), row: signRow.id, name, note: $("#signNote").value, token: TOKEN },
  }, id);
  btn.disabled = false;
  if (r.error) {
    showMsg("#signMsg", errText(r.error));
    if (r.error === "full" || r.error === "closed") openSheet(id, true);
    return;
  }
  current = r.view;
  keepCopy(id, current);
  rememberSheet(id, { title: current.sheet.title });
  closeBoxes();
  renderSheet();
  toast(t("You're in: {what}", { what: signRow.text }));
};

// ---------- share ----------
const sheetUrl = (id) => location.origin + BASE + "s/" + id;
function openShare(firstTime = false) {
  const id = current?.id || here().split("/")[2];
  const url = sheetUrl(id);
  $("#shareLink").value = url;
  const key = keyFor(id);
  $("#ownerLinkWrap").hidden = !key;
  $("#ownerLink").value = key ? url + "#k=" + key : "";
  $("#nativeShare").hidden = !navigator.share;
  const q = $("#qr");
  q.replaceChildren();
  if (window.qrcode) {
    const code = window.qrcode(0, "M");
    code.addData(url);
    code.make();
    q.innerHTML = code.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  }
  $("#shareBox").hidden = false;
  if (firstTime) toast(t("Saved. Now share it."));
}
$("#shareBtn").onclick = () => openShare();
$("#copyLink").onclick = () => copy($("#shareLink").value);
$("#copyOwner").onclick = () => copy($("#ownerLink").value);
$("#nativeShare").onclick = () => {
  const s = current?.sheet;
  navigator.share({ title: s?.title || "Sumate", text: s?.title, url: $("#shareLink").value }).catch(() => {});
};
$("#shareClose").onclick = closeBoxes;

function closeBoxes() {
  $("#signBox").hidden = true;
  $("#shareBox").hidden = true;
}
for (const box of [$("#signBox"), $("#shareBox")]) {
  box.addEventListener("click", (e) => { if (e.target === box) closeBoxes(); });
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeBoxes(); });

$("#sheetBack").onclick = () => go("/");
$("#editBtn").onclick = () => go("/s/" + current.id + "/edit");
$("#goneHome").onclick = () => go("/new");

// ---------- CSV ----------
$("#csvBtn").onclick = () => {
  const v = current;

  const cell = (x) => {
    let s = String(x ?? "");
    if (/^[=+\-@]/.test(s)) s = "'" + s; // keep spreadsheets from running it as a formula
    return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [[t("Line"), t("Name"), t("Note"), t("When")].map(cell).join(",")];
  for (const r of v.sheet.rows) {
    if (r.heading) continue;
    for (const e of v.entries.filter((x) => x.row === r.id)) {
      lines.push([r.text, e.name, e.note, e.at ? new Date(e.at).toLocaleString(LANG) : ""].map(cell).join(","));
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
