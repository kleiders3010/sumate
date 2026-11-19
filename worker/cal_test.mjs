// The calendar side of a line's day and time (web/cal.js): the right moment in any zone, and files calendars accept.
import assert from "node:assert/strict";
import { wallTime, slotOf, makeSlots, icsText, googleLink, whenText } from "../web/cal.js";

// 9:00 in Buenos Aires is 12:00 UTC; in Madrid in July 7:00 UTC, in November 8:00 UTC
assert.equal(wallTime("2026-11-22", "09:00", "America/Argentina/Buenos_Aires"), Date.UTC(2026, 10, 22, 12, 0));
assert.equal(wallTime("2026-07-01", "09:00", "Europe/Madrid"), Date.UTC(2026, 6, 1, 7, 0));
assert.equal(wallTime("2026-11-02", "09:00", "Europe/Madrid"), Date.UTC(2026, 10, 2, 8, 0));
// no end: an hour; an end before the start: the next day; no start: the whole day; no day: nothing to add
const tz = "America/Argentina/Buenos_Aires";
const one = slotOf({ date: "2026-11-22", start: "09:00" }, tz);
assert.equal(one.end - one.start, 3600e3);
const late = slotOf({ date: "2026-11-22", start: "22:00", end: "01:00" }, tz);
assert.equal(late.end - late.start, 3 * 3600e3);
assert.deepEqual(slotOf({ date: "2026-11-30" }, tz), { allDay: true, day: "2026-11-30", next: "2026-12-01" });
assert.equal(slotOf({ start: "09:00" }, tz), null);
// slots: every 20 minutes from 9 to 10 is three; one that doesn't fit is left out
assert.deepEqual(makeSlots("09:00", "10:00", 20).map((s) => s.start + "-" + s.end), ["09:00-09:20", "09:20-09:40", "09:40-10:00"]);
assert.equal(makeSlots("09:00", "10:10", 30).length, 2);
assert.deepEqual(makeSlots("23:00", "01:00", 60).map((s) => s.start), ["23:00", "00:00"]);
// the .ics: UTC times, escaped text, no line over 75 bytes, CRLF
const ev = { uid: "abc-def@x", title: "Morning shift · Beach clean-up, día 1; ñandú", place: "Costanera Sur", details: "Bring gloves\nand water. ".repeat(8),
  url: "https://signup.jurisgames.com/s/abc", slot: one };
const ics = icsText(ev, Date.UTC(2026, 0, 1));
assert.match(ics, /\r\nDTSTART:20261122T120000Z\r\nDTEND:20261122T130000Z\r\n/);
assert.ok(ics.includes("SUMMARY:Morning shift · Beach clean-up\\, día 1\\; ñandú\r\n"));
for (const l of ics.split("\r\n")) assert.ok(new TextEncoder().encode(l).length <= 75, l);
assert.ok(ics.endsWith("END:VCALENDAR\r\n") && !/[^\r]\n/.test(ics));
assert.ok(icsText({ ...ev, slot: slotOf({ date: "2026-11-30" }, tz) }).includes("DTSTART;VALUE=DATE:20261130\r\nDTEND;VALUE=DATE:20261201"));
assert.ok(googleLink(ev).includes("dates=20261122T120000Z%2F20261122T130000Z"));
// shown as the organizer wrote it
assert.equal(whenText({ date: "2026-11-22", start: "09:00", end: "11:30" }, "en-US", "", Date.UTC(2026, 0, 1)).text, "Sun, Nov 22 · 9:00 AM – 11:30 AM");
console.log("ok");
