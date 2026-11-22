// node s2_test.mjs : the second-pass Sumate audit (research/safety-audit-2026-11-22/sumate.md in SelfSustainment),
// run against the real Sheet class in memory: no network, nothing written.
import assert from "node:assert/strict";
import worker, { Sheet } from "./src/index.js";

let failed = 0;
const check = async (what, fn) => {
  try { await fn(); console.log("ok   " + what); } catch (e) { failed++; console.log("FAIL " + what + ": " + (e && e.message)); }
};

function stateOf() {
  const m = new Map();
  return { m, storage: { get: async (k) => structuredClone(m.get(k)), put: async (k, v) => void m.set(k, structuredClone(v)), delete: async (k) => void m.delete(k), deleteAll: async () => m.clear(), setAlarm: async () => {}, getAlarm: async () => null } };
}

await check("S2-3 a deletion that comes back as the answer to this server's copy leaves no title, line or name", async () => { // pinned: second pass S2-3
  const st = stateOf();
  const s = new Sheet(st, { SYNC_KEY: "s".repeat(40), PEER: "https://other.test" });
  const id = "abcdefgh23";
  const key = "k".repeat(24);
  s.d = {
    id, key, sheet: { title: "Potluck", rows: [{ id: "rowaaaa1", text: "Lasagna", need: 0 }] }, sheetAt: 1,
    entries: [{ id: "enaaaaaa1", row: "rowaaaa1", name: "Ana Secret", note: "vegan lasagna", at: 2, token: "t".repeat(20) }],
    gone: [], changed: 2, v: 3, sent: 2, tries: 0,
  };
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ id, key, deleted: true, changed: 5, gone: [] }), { headers: { "Content-Type": "application/json" } });
  try {
    await s.send();
  } finally {
    globalThis.fetch = real;
  }
  const stored = JSON.stringify(st.m.get("d"));
  assert.ok(st.m.get("d").deleted, "kept as deleted: " + stored);
  for (const word of ["Potluck", "Lasagna", "Ana Secret", "vegan", "t".repeat(20)]) assert.ok(!stored.includes(word), word + " still stored: " + stored);
  assert.equal(s.d.sent, s.d.v, "nothing left to send back");
});

await check("S2-1 a copy the other server won't take is tried less and less, and a failed try never writes the sheet again", async () => { // pinned: second pass S2-1
  const st = stateOf();
  let alarm = 0;
  st.storage.setAlarm = async (t) => void (alarm = t);
  const s = new Sheet(st, { SYNC_KEY: "s".repeat(40), PEER: "https://other.test" });
  s.d = { id: "abcdefgh24", key: "k".repeat(24), sheet: { title: "T", rows: [] }, sheetAt: 1, entries: [], gone: [], changed: Date.now(), v: 2, sent: 1, tries: 0 };
  await st.storage.put("d", s.d);
  const before = JSON.stringify(st.m.get("d"));
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response("no", { status: 503 });
  const waits = [];
  try {
    for (let i = 0; i < 10; i++) {
      await s.send();
      await s.plan();
      waits.push(Math.round((alarm - Date.now()) / 60e3));
    }
  } finally {
    globalThis.fetch = real;
  }
  assert.equal(JSON.stringify(st.m.get("d")), before, "the stored sheet was written again");
  assert.equal(st.m.get("t"), 10, "only the count is kept");
  assert.ok(waits.at(-1) >= 359, "after a while 6 hours apart: " + waits.join(","));
  // a fresh start reads the count back (the object sleeps between alarms)
  const s2 = new Sheet(st, { SYNC_KEY: "s".repeat(40), PEER: "https://other.test" });
  await s2.load();
  assert.equal(s2.d.tries, 10);
});

const sheets = new Map();
const OPEN = { limit: async () => ({ success: true }) };
const ENV = { SYNC_KEY: "s".repeat(40), NEWS: OPEN, WRITES: OPEN, READS: OPEN, SHEETS: { idFromName: (n) => n, get: (n) => {
  if (!sheets.has(n)) sheets.set(n, new Sheet(stateOf(), { SYNC_KEY: "s".repeat(40) }));
  return { fetch: (u, i) => sheets.get(n).fetch(u instanceof Request ? u : new Request(u, i)) };
} } };
const call = (path, { method = "GET", body, headers = {} } = {}) =>
  worker.fetch(new Request("https://signup.test" + path, { method, headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.9", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), ENV);

await check("S2-5 a new organizer link uses the key the device made, so a lost answer leaves a key someone has", async () => { // pinned: second pass S2-5
  const { id, key } = await (await call("/api/sheets", { method: "POST", body: { title: "Lunch", rows: [{ text: "Cake" }] } })).json();
  const mine = "n".repeat(24);
  const r = await (await call(`/api/sheets/${id}/key`, { method: "POST", body: { key: mine }, headers: { "X-Sheet-Key": key } })).json();
  assert.equal(r.key, mine);
  assert.equal((await (await call(`/api/sheets/${id}`, { headers: { "X-Sheet-Key": mine } })).json()).owner, true);
  assert.equal((await (await call(`/api/sheets/${id}`, { headers: { "X-Sheet-Key": key } })).json()).owner, false);
  // a key that isn't one of ours is not taken: the server makes one
  const odd = await (await call(`/api/sheets/${id}/key`, { method: "POST", body: { key: "short" }, headers: { "X-Sheet-Key": mine } })).json();
  assert.match(odd.key, /^[a-z0-9]{24}$/);
  assert.notEqual(odd.key, "short");
});

await check("S2-13a a required answer under the id \"constructor\" still has to be given", async () => { // pinned: second pass S2-13a
  const { id } = await (await call("/api/sheets", { method: "POST", body: { title: "Q", rows: [{ text: "A" }], asks: [{ id: "constructor", text: "Size?", req: true }] } })).json();
  const v = await (await call(`/api/sheets/${id}`)).json();
  const q = v.sheet.asks[0].id;
  const r = await call(`/api/sheets/${id}/signups`, { method: "POST", body: { row: v.sheet.rows[0].id, name: "P", token: "q".repeat(20), ans: {} } });
  assert.equal(r.status, 400, "refused without the answer (question id " + q + ")");
});

await check("S2-7b what the check-in link adds has the per-network budget, and the organizer sees which ones it added", async () => { // pinned: second pass S2-7b
  const { id, key } = await (await call("/api/sheets", { method: "POST", body: { title: "Door", rows: [{ text: "In" }] } })).json();
  const row = (await (await call(`/api/sheets/${id}`)).json()).sheet.rows[0].id;
  await call(`/api/sheets/${id}/door`, { method: "POST", headers: { "X-Sheet-Key": key } });
  const door = (await (await call(`/api/sheets/${id}`, { headers: { "X-Sheet-Key": key } })).json()).doorKey;
  assert.match(door || "", /^[a-z0-9]{24}$/, "the organizer gets the check-in link");
  const add = (h, n) => call(`/api/sheets/${id}/signups`, { method: "POST", body: { row, name: "W" + n, here: true }, headers: { ...h, "X-Net": "net-1" } });
  let last;
  for (let n = 0; n <= 500; n++) last = await add({ "X-Door-Key": door }, n);
  assert.equal(last.status, 429, "the 501st from the helpers' network is refused");
  assert.equal((await add({ "X-Sheet-Key": key }, 999)).status, 200, "the organizer is not held to it");
  const v = await (await call(`/api/sheets/${id}`, { headers: { "X-Sheet-Key": key } })).json();
  assert.equal(v.entries.filter((e) => e.byDoor).length, 500);
  assert.equal(v.entries.find((e) => e.name === "W999").byDoor, undefined);
  const pub = await (await call(`/api/sheets/${id}`)).json();
  assert.ok(pub.entries.every((e) => !e.byDoor), "only the organizer sees the mark");
});

await check("S2-7a a network at the limit stays limited after the sheet sleeps, and a deleted sheet keeps no count", async () => { // pinned: second pass S2-7a
  const { id, key } = await (await call("/api/sheets", { method: "POST", body: { title: "Sleep", rows: [{ text: "In" }] } })).json();
  const row = (await (await call(`/api/sheets/${id}`)).json()).sheet.rows[0].id;
  const add = (n) => call(`/api/sheets/${id}/signups`, { method: "POST", body: { row, name: "S" + n }, headers: { "X-Net": "net-2" } });
  let last;
  for (let n = 0; n <= 500; n++) last = await add(n);
  assert.equal(last.status, 429);
  // the sheet object goes to sleep: a new one is made from what is stored
  const old = sheets.get(id);
  sheets.set(id, new Sheet(old.state, { SYNC_KEY: "s".repeat(40) }));
  assert.equal((await add(600)).status, 429, "still refused after waking");
  assert.ok(await old.state.storage.get("nets"), "the count is stored");
  await call(`/api/sheets/${id}`, { method: "DELETE", headers: { "X-Sheet-Key": key } });
  assert.equal(await old.state.storage.get("nets"), undefined, "a deleted sheet keeps no count");
});

await check("S2-13c two full copies merged stay under Cloudflare's 2 MB per value in the form it stores them", async () => { // pinned: second pass S2-13c
  const v8 = await import("node:v8");
  const { mergeCopies, cleanCopy } = await import("./src/index.js");
  const id = "sizesheet2";
  // worst case for the stored form: long plain text with one emoji, so every string is kept at two bytes a letter
  const txt = (n, i) => ("x".repeat(n - 3) + i.toString(36).padStart(2, "0")).slice(0, n - 1) + "\u{1F600}".slice(0, 1).replace(/./, "\u00e9\u2603".slice(1));
  const rows = Array.from({ length: 200 }, (_, i) => ({ id: "row" + String(i).padStart(5, "0"), text: txt(120, i), need: 50 }));
  const full = (tag) => {
    const s = new Sheet(stateOf(), {});
    s.d = { id, key: "k".repeat(24), sheet: { title: txt(100, 1), details: txt(1900, 2), rows, showNames: true }, sheetAt: 1, entries: [], gone: [], changed: 1, v: 1, sent: 1 };
    for (let i = 0; i < 6000; i++) {
      const e = { id: (tag + i.toString(36)).padEnd(8, "z").slice(0, 8), row: rows[i % 200].id, name: txt(60, i), note: txt(200, i), token: (tag + "t" + i).padEnd(20, "q"), at: 1795000000000 + i, here: 1795000000000 + i, hereAt: 1795000000000 + i };
      if (!s.fits([...s.d.entries, e])) break;
      s.d.entries.push(e);
    }
    s.d.gone = Array.from({ length: 3000 }, (_, i) => (tag + "g" + i.toString(36)).padEnd(8, "y").slice(0, 8) + "~" + (1795000000000 + i).toString(36));
    return s.copy();
  };
  const a = full("a"), b = full("b");
  assert.ok(a.entries.length > 100, "a full copy has " + a.entries.length + " sign-ups");
  const m = cleanCopy(mergeCopies(a, b), id);
  const stored = v8.serialize(m).length;
  console.log(`     ${a.entries.length} sign-ups a copy, merged ${m.entries.length}: ${Math.round(stored / 1024)} KB stored (one copy ${Math.round(v8.serialize(a).length / 1024)} KB)`);
  assert.ok(stored <= 0.95 * 2 * 1024 * 1024, "under 95% of 2 MiB: " + stored);
});

console.log(failed ? `FAILED ${failed}` : "s2 OK");
process.exit(failed ? 1 : 0);
