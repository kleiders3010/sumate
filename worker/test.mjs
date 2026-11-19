// node test.mjs : what must stay true about sheets the server accepts.
import assert from "node:assert/strict";
import { cleanSheet, cleanCopy, mergeCopies } from "./src/index.js";

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
console.log("ok");
