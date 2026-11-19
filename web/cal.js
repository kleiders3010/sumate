// When a line happens, and "Add to my calendar" (like SignUpGenius' Google / Outlook / iCal buttons after signing up).
// A line's day and times are as the organizer wrote them, in the sheet's time zone; a calendar gets the real moment, so
// someone in another zone sees it at their own time. No libraries, no server: the links and the .ics file are made here.

const HOUR = 3600e3;
const DAY = 24 * HOUR;

// how far a zone is from UTC at a moment (ms)
function offset(ms, tz) {
  const p = {};
  for (const x of new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(ms)) p[x.type] = x.value;
  return Date.UTC(+p.year, p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
}

/** The moment a day + time on the wall clock of a zone is (no zone: this device's). */
export function wallTime(day, time, tz) {
  const [y, m, d] = day.split("-").map(Number);
  const [h, mi] = (time || "00:00").split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  if (tz) {
    try {
      let ms = guess - offset(guess, tz);
      ms = guess - offset(ms, tz); // once more, for a day the clocks change
      return ms;
    } catch { /* an unknown zone: this device's */ }
  }
  return new Date(y, m - 1, d, h, mi).getTime();
}

// When sign-ups are taken (like SignUpGenius' start/stop dates and "lock before the event"): the sheet may open and
// close at set moments, and each line with a day may stop taking sign-ups some minutes before it starts. Both servers
// and the app use this same function.
export const LOCKS = [0, 60, 180, 360, 720, 1440, 2880, 4320, 10080]; // minutes before a line starts

/** Why sign-ups are not taken now ("closed", "notyet" until it opens, "locked" for a line about to start), or "". */
export function shut(sheet, row, now = Date.now()) {
  if (!sheet.open) return "closed";
  if (sheet.opens && now < sheet.opens) return "notyet";
  if (sheet.closes && now >= sheet.closes) return "closed";
  if (row?.date && typeof sheet.lock === "number" && now >= wallTime(row.date, row.start, sheet.tz) - sheet.lock * 60e3) return "locked";
  return "";
}

const nextDay = (day) => new Date(Date.parse(day + "T00:00:00Z") + DAY).toISOString().slice(0, 10);

/** A line's event: null without a day; a whole day without a start; an hour without an end; an end before the start
 * is the next day. */
export function slotOf(row, tz) {
  if (!row?.date) return null;
  if (!row.start) return { allDay: true, day: row.date, next: nextDay(row.date) };
  const start = wallTime(row.date, row.start, tz);
  let end = row.end ? wallTime(row.date, row.end, tz) : start + HOUR;
  if (row.end && end <= start) end = wallTime(nextDay(row.date), row.end, tz);
  return { allDay: false, start, end };
}

const clock = (time, lang) => {
  const [h, m] = time.split(":").map(Number);
  return new Intl.DateTimeFormat(lang, { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(Date.UTC(2000, 0, 1, h, m));
};

/** "Sat, Nov 22 · 9:00 AM – 11:30 AM" as the organizer wrote it, and the zone's city when this device is elsewhere. */
export function whenText(row, lang, tz, now = Date.now()) {
  const parts = [];
  if (row.date) {
    const ms = Date.parse(row.date + "T12:00:00Z");
    const sameYear = new Date(ms).getUTCFullYear() === new Date(now).getUTCFullYear();
    parts.push(new Intl.DateTimeFormat(lang, {
      weekday: "short", day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }), timeZone: "UTC",
    }).format(ms));
  }
  if (row.start) parts.push(clock(row.start, lang) + (row.end ? " – " + clock(row.end, lang) : ""));
  let zone = "";
  if (row.start && tz) {
    try {
      const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const at = row.date ? wallTime(row.date, row.start, tz) : now;
      if (here !== tz && offset(at, here) !== offset(at, tz)) zone = tz.split("/").pop().replace(/_/g, " ");
    } catch { /* no zone note */ }
  }
  return { text: parts.join(" · "), zone };
}

/** Time slots between two times, every so many minutes (like SignUpGenius' "Add Time Slots"). */
export function makeSlots(from, to, every, max = 200) {
  const mins = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  const hhmm = (n) => String(Math.floor(n / 60) % 24).padStart(2, "0") + ":" + String(n % 60).padStart(2, "0");
  let a = mins(from), b = mins(to);
  if (b <= a) b += 24 * 60; // past midnight
  const out = [];
  for (let s = a; s + every <= b && out.length < max; s += every) out.push({ start: hhmm(s), end: hhmm(s + every) });
  return out;
}

// ---------- calendars ----------
const utc = (ms) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const compact = (day) => day.replace(/-/g, "");

/** Google Calendar's "new event" page, filled in. */
export function googleLink(ev) {
  const s = ev.slot;
  const dates = s.allDay ? compact(s.day) + "/" + compact(s.next) : utc(s.start) + "/" + utc(s.end);
  const q = new URLSearchParams({ action: "TEMPLATE", text: ev.title, dates, details: ev.details, location: ev.place || "" });
  return "https://calendar.google.com/calendar/render?" + q;
}

/** Outlook.com's "new event" page, filled in. */
export function outlookLink(ev) {
  const s = ev.slot;
  const q = new URLSearchParams({
    path: "/calendar/action/compose", rru: "addevent", subject: ev.title, body: ev.details, location: ev.place || "",
    startdt: s.allDay ? s.day : new Date(s.start).toISOString(), enddt: s.allDay ? s.next : new Date(s.end).toISOString(),
    ...(s.allDay ? { allday: "true" } : {}),
  });
  return "https://outlook.live.com/calendar/0/action/compose?" + q;
}

const esc = (v) => String(v ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
// lines of at most 75 bytes, the rest on lines that start with a space (RFC 5545)
function fold(l) {
  const enc = new TextEncoder();
  const out = [];
  let cur = "", n = 0;
  for (const ch of l) {
    const b = enc.encode(ch).length;
    if (n + b > (out.length ? 74 : 75)) { out.push(cur); cur = ""; n = 0; }
    cur += ch;
    n += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}

// a reminder before it (like SignUpGenius' automatic reminders, with no email: the person's own calendar rings). A
// line with a time: that long before it starts; a whole-day line: the day before at 9, or that morning at 8.
export const REMINDERS = ["0", "h1", "d1", "d2", "w1"];
export function alarmTrigger(choice, allDay) {
  const timed = { h1: "-PT1H", d1: "-P1D", d2: "-P2D", w1: "-P7D" };
  const day = { h1: "PT8H", d1: "-PT15H", d2: "-P1DT15H", w1: "-P6DT15H" };
  return (allDay ? day : timed)[choice] || "";
}

/** An .ics file (Apple Calendar, Outlook, and any other calendar) with one event. */
export function icsText(ev, now = Date.now()) {
  const s = ev.slot;
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//jurisgames.com//Sumate//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    "UID:" + ev.uid,
    "DTSTAMP:" + utc(now),
    ...(s.allDay
      ? ["DTSTART;VALUE=DATE:" + compact(s.day), "DTEND;VALUE=DATE:" + compact(s.next)]
      : ["DTSTART:" + utc(s.start), "DTEND:" + utc(s.end)]),
    "SUMMARY:" + esc(ev.title),
    ...(ev.place ? ["LOCATION:" + esc(ev.place)] : []),
    ...(ev.details ? ["DESCRIPTION:" + esc(ev.details)] : []),
    ...(ev.url ? ["URL:" + ev.url] : []),
    ...(ev.alarm ? ["BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:" + esc(ev.title), "TRIGGER:" + ev.alarm, "END:VALARM"] : []),
    "END:VEVENT", "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}
