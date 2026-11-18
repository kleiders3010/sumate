// Sumate: the web app (static files) and its sign-up sheets, one Worker.
// One Durable Object per sheet keeps the sheet (title, details, rows) and who signed up where.
// A sheet is deleted 90 days after its last change, or when its organizer deletes it.

const KEEP_MS = 90 * 24 * 3600 * 1000;
const MAX_ROWS = 200;
const MAX_ENTRIES = 3000;
const MAX_BODY = 64 * 1024;

const cors = { "Cache-Control": "no-store" };
const json = (data, status = 200) => Response.json(data, { status, headers: cors });
const str = (v, n) => String(v ?? "").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").trim().slice(0, n);
const line = (v, n) => str(v, n).replace(/\s+/g, " ");

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
    let id = typeof r?.id === "string" && /^[a-z0-9]{6,12}$/.test(r.id) && !seen.has(r.id) ? r.id : randomToken(8);
    seen.add(id);
    if (r?.heading) { rows.push({ id, text, heading: true }); continue; }
    const need = Math.floor(Number(r?.need));
    rows.push({ id, text, need: need >= 1 && need <= 999 ? need : 0 }); // 0 = any number
  }
  return {
    title,
    details: str(s.details, 2000).replace(/\n{3,}/g, "\n\n"),
    rows,
    showNames: s.showNames !== false,
    open: s.open !== false,
  };
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/health") return new Response("ok");
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
    const m = url.pathname.match(/^\/api\/sheets\/([a-z0-9]{10})(\/.*)?$/);
    if (m) return env.SHEETS.get(env.SHEETS.idFromName(m[1])).fetch(req);
    return new Response("not found", { status: 404 });
  },
};

async function readJson(req) {
  const text = await req.text();
  if (text.length > MAX_BODY) return null;
  try { return JSON.parse(text); } catch { return null; }
}

export class Sheet {
  constructor(state) {
    this.state = state;
    this.d = undefined; // { id, key, sheet, entries: [{id, row, name, note, token, at}], changed }
  }

  async load() {
    if (this.d === undefined) this.d = (await this.state.storage.get("d")) ?? null;
    return this.d;
  }

  async save() {
    this.d.changed = Date.now();
    await this.state.storage.put("d", this.d);
    await this.state.storage.setAlarm(Date.now() + KEEP_MS);
  }

  async alarm() {
    await this.state.storage.deleteAll();
    this.d = null;
  }

  isOwner(req) {
    const k = req.headers.get("X-Sheet-Key") || "";
    return !!this.d && k.length === this.d.key.length && k === this.d.key;
  }

  /** What a visitor sees: names only if the organizer shows them (the organizer always sees them). */
  view(req) {
    const owner = this.isOwner(req);
    const mine = new Set((req.headers.get("X-Sign-Tokens") || "").split(",").filter(Boolean));
    const d = this.d;
    return {
      id: d.id,
      owner,
      sheet: d.sheet,
      changed: d.changed,
      entries: d.entries.map((e) => {
        const isMine = mine.has(e.token);
        const show = owner || isMine || d.sheet.showNames;
        return { id: e.id, row: e.row, name: show ? e.name : "", note: show ? e.note : "", mine: isMine, at: owner ? e.at : undefined };
      }),
    };
  }

  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/create") {
      if (await this.load()) return json({ error: "taken" }, 409);
      const { id, sheet } = await req.json();
      this.d = { id, key: randomToken(24), sheet, entries: [] };
      await this.save();
      return json({ id, key: this.d.key });
    }
    if (!(await this.load())) return json({ error: "gone" }, 404);
    const rest = url.pathname.replace(/^\/api\/sheets\/[a-z0-9]{10}/, "") || "/";
    const d = this.d;

    if (rest === "/" && req.method === "GET") return json(this.view(req));

    if (rest === "/" && req.method === "PUT") {
      if (!this.isOwner(req)) return json({ error: "not yours" }, 403);
      const sheet = cleanSheet(await readJson(req));
      if (!sheet) return json({ error: "bad sheet" }, 400);
      const ids = new Set(sheet.rows.filter((r) => !r.heading).map((r) => r.id));
      d.sheet = sheet;
      d.entries = d.entries.filter((e) => ids.has(e.row));
      await this.save();
      return json(this.view(req));
    }

    if (rest === "/" && req.method === "DELETE") {
      if (!this.isOwner(req)) return json({ error: "not yours" }, 403);
      await this.state.storage.deleteAlarm();
      await this.state.storage.deleteAll();
      this.d = null;
      return json({ ok: true });
    }

    if (rest === "/signups" && req.method === "POST") {
      const b = await readJson(req);
      const row = d.sheet.rows.find((r) => r.id === b?.row && !r.heading);
      const name = line(b?.name, 60);
      if (!row || !name) return json({ error: "bad sign-up" }, 400);
      const owner = this.isOwner(req);
      if (!d.sheet.open && !owner) return json({ error: "closed" }, 409);
      if (row.need && d.entries.filter((e) => e.row === row.id).length >= row.need) return json({ error: "full" }, 409);
      if (d.entries.length >= MAX_ENTRIES) return json({ error: "full" }, 409);
      const token = typeof b?.token === "string" && /^[a-z0-9]{16,32}$/.test(b.token) ? b.token : randomToken(20);
      d.entries.push({ id: randomToken(8), row: row.id, name, note: line(b?.note, 200), token, at: Date.now() });
      await this.save();
      return json({ token, view: this.view(withToken(req, token)) });
    }

    const del = rest.match(/^\/signups\/([a-z0-9]{8})$/);
    if (del && req.method === "DELETE") {
      const e = d.entries.find((x) => x.id === del[1]);
      if (!e) return json(this.view(req));
      const mine = (req.headers.get("X-Sign-Tokens") || "").split(",").includes(e.token);
      if (!mine && !this.isOwner(req)) return json({ error: "not yours" }, 403);
      d.entries = d.entries.filter((x) => x !== e);
      await this.save();
      return json(this.view(req));
    }

    return json({ error: "not found" }, 404);
  }
}

function withToken(req, token) {
  const h = new Headers(req.headers);
  const have = (h.get("X-Sign-Tokens") || "").split(",").filter(Boolean);
  h.set("X-Sign-Tokens", [...have, token].join(","));
  return new Request(req.url, { headers: h });
}
