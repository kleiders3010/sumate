// node test.mjs : what must stay true about sheets the server accepts.
import assert from "node:assert/strict";
import { cleanSheet } from "./src/index.js";

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
console.log("ok");
