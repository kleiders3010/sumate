// node safety3_test.mjs : safety round 3 (the Sumate audit, research/safety-audit-2026-11-21/sumate.md in
// SelfSustainment), run against the real Sheet class and Worker in memory: no network, nothing written.
import assert from "node:assert/strict";
import worker, { Sheet, cleanCopy, mergeCopies, cleanAnswers, cleanSheet, syncHeaders, goneOf, goneMark, same, sizes } from "./src/index.js";

let failed = 0;
const check = async (what, fn) => {
  try { await fn(); console.log("ok   " + what); } catch (e) { failed++; console.log("FAIL " + what + ": " + (e && e.message)); }
};

// a Durable Object stand-in: storage in a Map, the alarm noted
function stateOf() {
  const m = new Map();
  return { storage: { get: async (k) => structuredClone(m.get(k)), put: async (k, v) => void m.set(k, structuredClone(v)), deleteAll: async () => m.clear(), setAlarm: async () => {} } };
}
const sheets = new Map();
const ENV = {
  SYNC_KEY: "s".repeat(40),
  SHEETS: { idFromName: (n) => n, get: (n) => {
    if (!sheets.has(n)) sheets.set(n, new Sheet(stateOf(), { SYNC_KEY: "s".repeat(40) }));
    return { fetch: (u, i) => sheets.get(n).fetch(u instanceof Request ? u : new Request(u, i)) };
  } },
};
const call = (path, { method = "GET", body, headers = {} } = {}, env = ENV) =>
  worker.fetch(new Request("https://signup.test" + path, { method, headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.9", ...headers }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) }), env);
const made = async (sheet) => (await call("/api/sheets", { method: "POST", body: sheet })).json();
const tok = (c) => c.repeat(20);

const rows = [{ text: "Cake", need: 0 }];
const { MAX_BYTES, MAX_SYNC } = sizes();

await check("S8 every header the app sends is allowed cross-site (X-Door-Key, X-Sign-Old)", async () => { // pinned: round 3 S8
  const h = (await call("/api/sheets/abcdefgh23", { method: "OPTIONS" })).headers.get("Access-Control-Allow-Headers");
  for (const x of ["X-Sheet-Key", "X-Door-Key", "X-Sign-Tokens", "X-Sign-Old"]) assert.ok(h.includes(x), x);
});

await check("S1/S7 a new organizer link: the new key edits, the old one doesn't", async () => { // pinned: round 3 S7
  const { id, key } = await made({ title: "Lunch", rows });
  const r = await (await call(`/api/sheets/${id}/key`, { method: "POST", headers: { "X-Sheet-Key": key } })).json();
  assert.match(r.key, /^[a-z0-9]{24}$/);
  assert.equal(r.view.owner, true);
  assert.equal((await (await call(`/api/sheets/${id}`, { headers: { "X-Sheet-Key": key } })).json()).owner, false);
  assert.equal((await call(`/api/sheets/${id}/key`, { method: "POST", headers: { "X-Sheet-Key": "x".repeat(24) } })).status, 403);
});

await check("S7 the later organizer link wins when the two servers' copies meet, either way round", async () => { // pinned: round 3 S7
  const sheet = cleanSheet({ title: "x", rows: [{ id: "rowaaaa1", text: "a" }] });
  const a = { id: "abcdefgh23", key: "a".repeat(24), sheet, sheetAt: 1, entries: [], gone: [], changed: 1 };
  const b = { ...a, key: "b".repeat(24), keyAt: 5 };
  assert.equal(mergeCopies(a, b).key, "b".repeat(24));
  assert.equal(mergeCopies(b, a).key, "b".repeat(24));
});

await check("S2 one network signs up at most 100 times an hour on one sheet; the organizer is not counted", async () => { // pinned: round 3 S2
  const { id, key } = await made({ title: "Big", rows });
  const row = (await (await call(`/api/sheets/${id}`)).json()).sheet.rows[0].id;
  const codes = [];
  for (let i = 0; i < 101; i++) codes.push((await call(`/api/sheets/${id}/signups`, { method: "POST", body: { row, name: "P" + i, token: "q".repeat(19) + (i % 9) } })).status);
  assert.ok(codes.slice(0, 100).every((c) => c === 200), "first 100"); // pinned: round 3 S2, PER_NET_HOUR 100
  assert.equal(codes[100], 429);
  assert.equal((await call(`/api/sheets/${id}/signups`, { method: "POST", body: { row, name: "Org" }, headers: { "X-Sheet-Key": key } })).status, 200);
  assert.equal((await call(`/api/sheets/${id}/signups`, { method: "POST", body: { row, name: "Other home" }, headers: { "CF-Connecting-IP": "198.51.100.7" } })).status, 200);
});

await check("S2 a sheet never grows past its size budget, and the biggest one fits the copy to the other server", async () => { // pinned: round 3 S2
  assert.ok(2 * MAX_BYTES <= MAX_SYNC && MAX_SYNC < 2_000_000);
  const { id } = await made({ title: "Huge", rows, asks: [1, 2, 3, 4, 5].map((n) => ({ text: "Q" + n })) });
  const v = await (await call(`/api/sheets/${id}`)).json();
  const ans = Object.fromEntries(v.sheet.asks.map((q) => [q.id, "ü".repeat(200)]));
  let last = 200, n = 0;
  for (; n < 3000 && last === 200; n++)
    last = (await call(`/api/sheets/${id}/signups`, { method: "POST", body: { row: v.sheet.rows[0].id, name: "ñ".repeat(60), note: "é".repeat(200), ans, token: "w".repeat(20) }, headers: { "CF-Connecting-IP": "10.0." + (n >> 8) + "." + (n & 255) } })).status;
  assert.equal(last, 409, "refused at some point");
  const s = sheets.get(id);
  assert.ok(new TextEncoder().encode(JSON.stringify(s.copy())).length <= MAX_BYTES, "stored copy within budget");
});

await check("S2 the organizer removes many at once; nobody else can", async () => { // pinned: round 3 S2
  const { id, key } = await made({ title: "Clean", rows });
  const row = (await (await call(`/api/sheets/${id}`)).json()).sheet.rows[0].id;
  for (let i = 0; i < 5; i++) await call(`/api/sheets/${id}/signups`, { method: "POST", body: { row, name: "S" + i } });
  const ids = (await (await call(`/api/sheets/${id}`)).json()).entries.map((e) => e.id);
  assert.equal((await call(`/api/sheets/${id}/signups/remove`, { method: "POST", body: { ids } })).status, 403);
  const r = await (await call(`/api/sheets/${id}/signups/remove`, { method: "POST", body: { ids: ids.slice(0, 4) }, headers: { "X-Sheet-Key": key } })).json();
  assert.equal(r.entries.length, 1);
});

await check("S3 reads are counted per address before any sheet is woken, and the app's own refusal is JSON", async () => { // pinned: round 3 S3
  let woke = 0;
  const env = { ...ENV, READS: { limit: async () => ({ success: false }) }, SHEETS: { idFromName: (n) => n, get: () => { woke++; return { fetch: () => new Response("{}") }; } } };
  const r = await call("/api/sheets/abcdefgh23", {}, env);
  assert.equal(r.status, 429);
  assert.match(r.headers.get("content-type"), /json/);
  assert.equal(woke, 0);
});

await check("S11 a copy from the other server needs a fresh signature; the key alone, an old time or a wrong one is refused before any sheet is woken", async () => { // pinned: round 3 S11
  const { id } = await made({ title: "Sync", rows });
  assert.equal((await call(`/api/sync/${id}`, { headers: { "X-Sync-Key": ENV.SYNC_KEY } })).status, 403);
  const good = await syncHeaders(ENV.SYNC_KEY, "GET", id);
  assert.equal((await call(`/api/sync/${id}`, { headers: good })).status, 200);
  const old = { ...good, "X-Sync-Time": String(Date.now() - 10 * 60e3) };
  assert.equal((await call(`/api/sync/${id}`, { headers: old })).status, 403);
  const other = await syncHeaders(ENV.SYNC_KEY, "GET", "zzzzzzzzzz");
  assert.equal((await call(`/api/sync/${id}`, { headers: other })).status, 403);
  let woke = 0;
  const env = { ...ENV, SHEETS: { idFromName: (n) => n, get: () => { woke++; return { fetch: () => new Response("{}") }; } } };
  await call(`/api/sync/${id}`, { headers: { "X-Sync-Key": ENV.SYNC_KEY } }, env);
  assert.equal(woke, 0);
  const body = JSON.stringify(sheets.get(id).copy());
  const post = await call(`/api/sync/${id}`, { method: "POST", body, headers: await syncHeaders(ENV.SYNC_KEY, "POST", id, body) });
  assert.equal(post.status, 200);
  const tampered = await call(`/api/sync/${id}`, { method: "POST", body: body.replace("Sync", "Evil"), headers: await syncHeaders(ENV.SYNC_KEY, "POST", id, body) });
  assert.equal(tampered.status, 403);
});

await check("S11 times in a copy are taken as at most a few minutes ahead", async () => { // pinned: round 3 S11
  const sheet = cleanSheet({ title: "x", rows: [{ id: "rowaaaa1", text: "a" }] });
  const far = Date.now() + 365 * 864e5;
  const c = cleanCopy({ id: "abcdefgh23", key: "k".repeat(24), sheet, sheetAt: far, changed: far, gone: [goneMark("zzzzzzz1", far)],
    entries: [{ id: "aaaaaaa1", row: "rowaaaa1", name: "A", token: tok("t"), at: far, editAt: far }] }, "abcdefgh23");
  const cap = Date.now() + 6 * 60e3;
  assert.ok(c.changed < cap && c.sheetAt < cap && c.entries[0].at < cap && c.entries[0].editAt < cap);
});

await check("S12 a body that says it is too big is refused unread", async () => { // pinned: round 3 S12
  const { id, key } = await made({ title: "Body", rows });
  const r = await worker.fetch(new Request(`https://signup.test/api/sheets/${id}`, { method: "PUT", headers: { "X-Sheet-Key": key, "Content-Length": String(10 * 1024 * 1024) }, body: "{}" }), ENV);
  assert.equal(r.status, 400);
});

await check("S6 one sign-up id held by two devices stays two sign-ups, the same either way round", async () => { // pinned: round 3 S6
  const sheet = cleanSheet({ title: "x", rows: [{ id: "rowaaaa1", text: "a", need: 1 }] });
  const base = { id: "abcdefgh23", key: "k".repeat(24), sheet, sheetAt: 1, gone: [], changed: 1 };
  const a = { ...base, entries: [{ id: "aaaaaaa1", row: "rowaaaa1", name: "Ana", note: "", token: tok("a"), at: 10 }] };
  const b = { ...base, entries: [{ id: "aaaaaaa1", row: "rowaaaa1", name: "Mallory", note: "", token: tok("m"), at: 11 }] };
  const ab = mergeCopies(a, b), ba = mergeCopies(b, a);
  assert.equal(ab.entries.length, 2);
  assert.deepEqual(ab.entries, ba.entries);
  assert.equal(ab.entries.find((e) => e.id === "aaaaaaa1").name, "Ana"); // pinned: round 3 S6, the earlier keeps the id (and her place)
});

await check("S5 sign-ups made with the old device code still count as the person's, and the server says how many are left", async () => { // pinned: round 3 S5
  const { id } = await made({ title: "Old", rows });
  const row = (await (await call(`/api/sheets/${id}`)).json()).sheet.rows[0].id;
  await call(`/api/sheets/${id}/signups`, { method: "POST", body: { row, name: "Me", token: tok("o") } });
  const v = await (await call(`/api/sheets/${id}`, { headers: { "X-Sign-Tokens": tok("n"), "X-Sign-Old": tok("o") } })).json();
  assert.equal(v.old, 1);
  assert.equal(v.entries[0].mine, true);
  const eid = v.entries[0].id;
  assert.equal((await call(`/api/sheets/${id}/signups/${eid}`, { method: "DELETE", headers: { "X-Sign-Tokens": tok("n"), "X-Sign-Old": tok("o") } })).status, 200);
});

await check("S13a a question with the id 'constructor' never reads Object's", async () => { // pinned: round 3 S13a
  assert.deepEqual(cleanAnswers({}, [{ id: "constructor", opts: [] }]), {});
  assert.deepEqual(cleanAnswers({ constructor: "yes" }, [{ id: "constructor", opts: [] }]), { constructor: "yes" });
});

await check("S13b removed sign-ups are trimmed by age, not by alphabet", async () => { // pinned: round 3 S13b
  const old = goneMark("aaaaaaa1", 1000);
  const many = Array.from({ length: 3000 }, (_, i) => goneMark("z" + String(i).padStart(7, "0").replace(/0/g, "a"), 5000 + i));
  const g = goneOf([old], many);
  assert.equal(g.length, 3000);
  assert.ok(!g.includes(old), "the oldest goes first");
  assert.ok(goneOf(["aaaaaaa1"]).length === 1, "an id from before still counts");
});

await check("S13c a question taken off takes its answers with it", async () => { // pinned: round 3 S13c
  const { id, key } = await made({ title: "Q", rows, asks: [{ text: "Size" }] });
  const v = await (await call(`/api/sheets/${id}`)).json();
  await call(`/api/sheets/${id}/signups`, { method: "POST", body: { row: v.sheet.rows[0].id, name: "A", ans: { [v.sheet.asks[0].id]: "L" } } });
  await call(`/api/sheets/${id}`, { method: "PUT", body: { ...v.sheet, asks: [] }, headers: { "X-Sheet-Key": key } });
  assert.ok(!sheets.get(id).d.entries[0].ans);
});

await check("S13d secrets compared whole, in constant time", async () => { // pinned: round 3 S13d
  assert.equal(same("abc", "abc"), true);
  assert.equal(same("abc", "abd"), false);
  assert.equal(same("", ""), false);
  assert.equal(same("abc", "abcd"), false);
});

console.log(failed ? `\n${failed} FAILED` : "\nALL OK");
process.exit(failed ? 1 : 0);
