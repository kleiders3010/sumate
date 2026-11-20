// node test.mjs : what must stay true about sheets the server accepts.
import assert from "node:assert/strict";
import { cleanSheet, cleanCopy, mergeCopies, cleanAnswers, waitingOf } from "./src/index.js";
import { shut, mostFor, qtyOf, canSelfIn } from "../web/cal.js";

// every row gets a real id, also when the editor sends none (regex.test(undefined) once let "undefined" through)
const s = cleanSheet({ title: " Lunch ", rows: [{ text: "Desserts", heading: true }, { text: "Cake", need: 2 }, { text: "Drinks" }, { text: "  " }] });
assert.equal(s.title, "Lunch");
assert.equal(s.rows.length, 3);
for (const r of s.rows) assert.match(r.id, /^[a-z0-9]{8}$/);
assert.equal(new Set(s.rows.map((r) => r.id)).size, 3);
// an existing id is kept, so sign-ups stay on their line after an edit; a duplicate gets a new one
const k = cleanSheet({ title: "x", rows: [{ id: "abcdef12", text: "a" }, { id: "abcdef12", text: "b" }] });
assert.equal(k.rows[0].id, "abcdef12");
assert.notEqual(k.rows[1].id, "abcdef12");
// need: 1..999, anything else = any number (0)
assert.deepEqual(cleanSheet({ title: "x", rows: [{ text: "a", need: 5 }, { text: "b", need: -3 }, { text: "c", need: "zz" }] }).rows.map((r) => r.need), [5, 0, 0]);
// no title, no sheet; switches default on
assert.equal(cleanSheet({ title: " ", rows: [] }), null);
const d = cleanSheet({ title: "x", rows: [] });
assert.equal(d.showNames, true);
assert.equal(d.open, true);

// two servers' copies of one sheet merge without losing a sign-up, whichever order they come in
const sheet = cleanSheet({ title: "Lunch", rows: [{ id: "rowaaaa1", text: "Cake", need: 0 }, { id: "rowbbbb2", text: "Drinks", need: 0 }] });
const base = { id: "abcdefgh23", key: "k".repeat(24), sheet, sheetAt: 1, entries: [], gone: [], changed: 1 };
const e = (id, row, at) => ({ id, row, name: "N" + id, note: "", token: "t".repeat(20), at });
const A = { ...base, entries: [e("aaaaaaa1", "rowaaaa1", 5), e("ccccccc3", "rowaaaa1", 3)], changed: 5 };
const B = { ...base, entries: [e("bbbbbbb2", "rowbbbb2", 6), e("ccccccc3", "rowaaaa1", 3)], gone: [], changed: 6 };
const ab = mergeCopies(A, B), ba = mergeCopies(B, A);
assert.deepEqual(ab, ba);
assert.deepEqual(ab.entries.map((x) => x.id), ["ccccccc3", "aaaaaaa1", "bbbbbbb2"]);
// a sign-up removed on one side stays removed
const Bx = { ...B, entries: B.entries.filter((x) => x.id !== "ccccccc3"), gone: ["ccccccc3"] };
assert.ok(!mergeCopies(A, Bx).entries.some((x) => x.id === "ccccccc3"));
// the sheet edited last wins; sign-ups on a line it no longer has go
const edited = cleanSheet({ title: "Lunch!", rows: [{ id: "rowaaaa1", text: "Cake" }] });
const m2 = mergeCopies({ ...B, sheet: edited, sheetAt: 9 }, A);
assert.equal(m2.sheet.title, "Lunch!");
assert.ok(m2.entries.every((x) => x.row === "rowaaaa1"));
// a deleted sheet stays deleted
assert.equal(mergeCopies(A, { id: base.id, key: base.key, deleted: true, changed: 2, gone: [] }).deleted, true);
// what comes from the other server is checked like everything else
assert.equal(cleanCopy({ ...A, id: "other12345" }, base.id), null);
assert.equal(cleanCopy({ ...A, key: "short" }, base.id), null);
assert.equal(cleanCopy({ ...A, entries: [{ ...e("aaaaaaa1", "rowaaaa1", 1), name: " " }] }, base.id).entries.length, 0);
// the organizer's own questions: bounded, a choice only from its choices, answers only to questions the sheet has
const qs = cleanSheet({ title: "x", rows: [{ text: "a" }], asks: [{ text: " T-shirt size? ", opts: ["S", "M", "M", " "], req: 1 }, { text: "Allergies?" }, { text: " " },
  ...Array.from({ length: 9 }, (_, i) => ({ text: "q" + i }))] });
assert.equal(qs.asks.length, 5); // pinned: at most 5 questions
assert.deepEqual(qs.asks[0].opts, ["S", "M"]);
assert.equal(qs.asks[0].req, true);
assert.equal(qs.asks[1].req, false);
assert.deepEqual(cleanSheet({ title: "x", rows: [] }).asks, []); // pinned: no questions unless the organizer adds them
const [size, allergies] = qs.asks;
assert.deepEqual(cleanAnswers({ [size.id]: "XL", [allergies.id]: " nuts ", zzz: "x" }, qs.asks), { [allergies.id]: "nuts" });
assert.deepEqual(cleanAnswers({ [size.id]: "M" }, qs.asks), { [size.id]: "M" });
// the answers travel to the other server with the sign-up
const withAns = cleanCopy({ id: base.id, key: base.key, sheet: qs, entries: [{ ...e("aaaaaaa9", qs.rows[0].id, 1), ans: { [size.id]: "S", bad: "x" } }] }, base.id);
assert.deepEqual(withAns.entries[0].ans, { [size.id]: "S" });
// a line may say when: a real day, times as HH:MM, an end only with a start; the zone must be a real one
const w = cleanSheet({ title: "x", place: " Parque  Centenario ", tz: "America/Argentina/Buenos_Aires", rows: [
  { text: "a", date: "2026-11-22", start: "09:00", end: "11:30" }, { text: "b", date: "2026-02-30", start: "25:00", end: "10:00" },
  { text: "c", end: "10:00" }, { text: "d", start: "22:00", end: "01:00" }, { text: "h", heading: true, date: "2026-11-22" }] });
assert.deepEqual(w.rows.map(({ date, start, end }) => [date, start, end]),
  [["2026-11-22", "09:00", "11:30"], [undefined, undefined, undefined], [undefined, undefined, undefined], [undefined, "22:00", "01:00"], [undefined, undefined, undefined]]);
assert.equal(w.place, "Parque Centenario");
assert.equal(w.tz, "America/Argentina/Buenos_Aires");
assert.equal(cleanSheet({ title: "x", tz: "Mars/Olympus" }).tz, "");
assert.equal(cleanSheet({ title: "x", tz: "a;b" }).tz, "");
// and it travels to the other server with the sheet
assert.deepEqual(cleanCopy({ id: base.id, key: base.key, sheet: w, entries: [] }, base.id).sheet.rows[0].start, "09:00");

// opening and closing at set moments, and lines that stop taking sign-ups before they start
const T0 = Date.UTC(2026, 11, 1, 12, 0);
const oc = cleanSheet({ title: "x", opens: T0, closes: T0 + 3600e3, lock: 1440, final: true, tz: "America/Argentina/Buenos_Aires",
  rows: [{ text: "a", date: "2026-12-03", start: "09:00" }, { text: "b" }] });
assert.deepEqual([oc.opens, oc.closes, oc.lock, oc.final], [T0, T0 + 3600e3, 1440, true]);
const bad = cleanSheet({ title: "x", opens: T0, closes: T0 - 1, lock: 7, final: "" });
assert.deepEqual([bad.opens, bad.closes, bad.lock, bad.final], [T0, undefined, undefined, false]); // closing before opening: dropped
assert.equal(cleanSheet({ title: "x", opens: "soon", closes: 12.5 }).opens, undefined);
assert.equal(cleanSheet({ title: "x", lock: 0 }).lock, 0); // pinned: 0 = until the line starts (none = any time)
assert.equal(cleanSheet({ title: "x" }).lock, undefined);
assert.equal(shut(oc, oc.rows[1], T0 - 1), "notyet");
assert.equal(shut(oc, oc.rows[1], T0), "");
assert.equal(shut(oc, oc.rows[1], T0 + 3600e3), "closed");
assert.equal(shut({ ...oc, open: false }, oc.rows[1], T0 + 1), "closed");
// line a: Dec 3, 9:00 in Buenos Aires = 12:00 UTC; a day before = Dec 2, 12:00 UTC
const open = { ...oc, opens: undefined, closes: undefined };
assert.equal(shut(open, oc.rows[0], Date.UTC(2026, 11, 2, 11, 59)), "");
assert.equal(shut(open, oc.rows[0], Date.UTC(2026, 11, 2, 12, 0)), "locked");
assert.equal(shut(open, oc.rows[1], Date.UTC(2026, 11, 9)), ""); // a line without a day never locks
assert.equal(shut({ ...open, lock: undefined }, oc.rows[0], Date.UTC(2026, 11, 9)), "");
assert.equal(cleanCopy({ id: base.id, key: base.key, sheet: oc, entries: [] }, base.id).sheet.closes, T0 + 3600e3);

// more than one spot in a sign-up, and the most one person may take (like SignUpGenius' quantity limits)
const qs2 = cleanSheet({ title: "Bake", qty: true, per: 3, perRow: 500, rows: [{ id: "cookies1", text: "Cookies", need: 3 }, { id: "brownie1", text: "Brownies", need: 0 }] });
assert.equal(qs2.qty, true);
assert.equal(qs2.per, 3);
assert.equal(qs2.perRow, undefined); // out of range: no limit
assert.equal(cleanSheet({ title: "x", rows: [] }).qty, false); // pinned: off unless the organizer turns it on
const q = (id, row, at, qty) => ({ ...e(id, row, at), ...(qty ? { qty } : {}) });
const kept = cleanCopy({ id: base.id, key: base.key, sheet: qs2, entries: [q("aaaaaaa1", "cookies1", 1, 2), q("bbbbbbb2", "cookies1", 2, 1), q("ccccccc3", "cookies1", 3, 500)] }, base.id);
assert.deepEqual(kept.entries.map(qtyOf), [2, 1, 99]); // the other server keeps how many, bounded
assert.equal(mostFor(qs2, qs2.rows[0], [q("aaaaaaa1", "cookies1", 1, 2)]), 1);
assert.equal(mostFor(qs2, qs2.rows[1], [q("aaaaaaa1", "cookies1", 1, 3)]), 0); // the whole sheet counts
assert.equal(mostFor({ perRow: 2 }, qs2.rows[1], [q("aaaaaaa1", "cookies1", 1, 3)]), 2); // another line doesn't
assert.equal(mostFor({}, qs2.rows[0], []), Infinity);
// waiting: spots in the order people came; nobody skips the line, even if a smaller one would fit
const wq = { sheet: { ...qs2, wait: true }, entries: [q("aaaaaaa1", "cookies1", 1, 2), q("bbbbbbb2", "cookies1", 2, 2), q("ccccccc3", "cookies1", 3, 1)] };
assert.deepEqual([...waitingOf(wq)], [["bbbbbbb2", 1], ["ccccccc3", 2]]);
wq.entries.shift(); // the first one leaves: both are in (2 + 1 = 3)
assert.equal(waitingOf(wq).size, 0);

// check-in: the later change wins on both servers (marked on one, undone later on the other), whichever comes first
const hs = cleanSheet({ title: "Shift", rows: [{ id: "rowaaaa1", text: "Door", need: 2 }] });
const hb = { id: "abcdefgh23", key: "k".repeat(24), sheet: hs, sheetAt: 1, gone: [], changed: 1 };
const he = (here, hereAt) => ({ ...e("aaaaaaa1", "rowaaaa1", 1), ...(hereAt ? { here, hereAt } : {}) });
const H1 = cleanCopy({ ...hb, entries: [he(10, 10)] }, "abcdefgh23"), H2 = cleanCopy({ ...hb, entries: [he(0, 20)] }, "abcdefgh23");
assert.equal(H1.entries[0].here, 10);
assert.equal(mergeCopies(H1, H2).entries[0].here, 0);
assert.deepEqual(mergeCopies(H1, H2), mergeCopies(H2, H1));
assert.equal(mergeCopies(H1, cleanCopy({ ...hb, entries: [he()] }, "abcdefgh23")).entries[0].here, 10); // never marked loses
// the check-in link: the one made (or turned off) last
const D1 = { ...H1, door: "d".repeat(24), doorAt: 5 }, D2 = { ...H1, door: "", doorAt: 7 };
assert.equal(mergeCopies(D1, D2).door, "");
assert.equal(cleanCopy({ ...hb, entries: [], door: "x".repeat(24), doorAt: 3 }, "abcdefgh23").door, "x".repeat(24));
assert.equal(cleanCopy({ ...hb, entries: [], door: "bad" }, "abcdefgh23").door, "");
// people check themselves in only with the switch, and from the line's day
const day = { id: "r1", text: "x", date: "2030-01-10" };
assert.equal(canSelfIn({ selfIn: false }, { id: "r", text: "x" }), false);
assert.equal(canSelfIn({ selfIn: true }, { id: "r", text: "x" }), true);
assert.equal(canSelfIn({ selfIn: true, tz: "UTC" }, day, Date.UTC(2030, 0, 9, 23)), false);
assert.equal(canSelfIn({ selfIn: true, tz: "UTC" }, day, Date.UTC(2030, 0, 10, 0, 1)), true);
assert.equal(cleanSheet({ title: "x", rows: [], selfIn: 1 }).selfIn, true);
// someone added at the check-in takes a free spot; on a full line they are extra: never waiting, nobody pushed out
const ws = { sheet: { rows: [{ id: "r", text: "Door", need: 2 }] }, entries: [
  { id: "a", row: "r", at: 1 }, { id: "w", row: "r", at: 2, walk: 1, here: 2, hereAt: 2 }, { id: "b", row: "r", at: 3 }, { id: "x", row: "r", at: 4, walk: 1 }] };
assert.deepEqual([...waitingOf(ws)], [["b", 1]]);
assert.equal(cleanCopy({ ...hb, entries: [{ ...he(5, 5), walk: 1 }] }, "abcdefgh23").entries[0].walk, 1);
console.log("ok");
