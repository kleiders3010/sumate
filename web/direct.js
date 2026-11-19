// The game host straight, for when Cloudflare is down (Kleider, 2026-11-19: "if it's kinetics, then it's perfectly
// fine. Just have proper protections in place"). The app's second server is the game host through Cloudflare
// (games.jurisgames.com/<app>); when that doesn't answer, this looks up the host's direct address on GitHub (not on
// Cloudflare: servers.json, written by ChessTactics/tools/direct.mjs), checks that it answers, and hands it over.
// The same file is in Juntos, Ronda and Sumate.
const LIST = "https://raw.githubusercontent.com/kleiders3010/jurisgames/main/servers.json";
const KEY = "jg.direct"; // the last address seen, for when GitHub can't be reached either

const answers = async (base, ms = 4000) => {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(base.replace(/^ws/, "http") + "/api/health", { signal: ctl.signal, cache: "no-store" });
    return r.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
};

async function directBase() {
  let url = null;
  try { url = localStorage.getItem(KEY); } catch {}
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 5000);
    const j = await (await fetch(LIST, { signal: ctl.signal, cache: "no-store" })).json();
    clearTimeout(t);
    if (typeof j.direct === "string" && /^wss:\/\/[a-z0-9.-]+(:\d+)?$/.test(j.direct)) {
      url = j.direct;
      try { localStorage.setItem(KEY, url); } catch {}
    }
  } catch {}
  return url;
}

/**
 * Watch the second server: while `via` (e.g. "wss://games.jurisgames.com/juntos") doesn't answer and the direct
 * address does, call `use(direct)` with the same path on it ("wss://direct.jurisgames.com:<port>/juntos"; an
 * https app gets https). Checks at once and then every few minutes; `use(via)` again when Cloudflare is back.
 */
export function watchDirect(via, use, { every = 180000 } = {}) {
  if (!via || !/^(wss|https):\/\/games\.jurisgames\.com\//.test(via)) return;
  const path = new URL(via.replace(/^ws/, "http")).pathname.replace(/\/$/, "");
  const https = via.startsWith("https");
  let onDirect = false;
  const check = async () => {
    if (await answers(via)) {
      if (onDirect) { onDirect = false; use(via); }
      return;
    }
    const base = await directBase();
    if (!base) return;
    const direct = (https ? base.replace(/^wss/, "https") : base) + path;
    if (!onDirect && (await answers(direct))) { onDirect = true; use(direct); }
  };
  check();
  setInterval(check, every);
}
