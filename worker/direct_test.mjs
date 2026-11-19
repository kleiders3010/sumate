// web/direct.js (the game host straight when Cloudflare is down), with fetch and localStorage stood in for:
// the game host through Cloudflare answers -> nothing changes; it doesn't and the direct one does -> the app gets the
// direct address with the same path (https for an https app); GitHub down too -> the last address seen; Cloudflare
// back -> the app goes back. The same file is in Ronda and Sumate: node worker/direct_test.mjs [path to direct.js]
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const file = resolve(process.argv[2] || new URL("../web/direct.js", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"));
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
const up = new Set(); // addresses that answer
let github = true;
const DIRECT = "wss://direct.jurisgames.com:4321"; // a made-up port
globalThis.fetch = async (url) => {
  if (url.startsWith("https://raw.githubusercontent.com/")) {
    if (!github) throw new TypeError("offline");
    return { ok: true, json: async () => ({ direct: DIRECT }) };
  }
  const base = url.replace(/\/api\/health$/, "");
  if (!up.has(base)) throw new TypeError("unreachable");
  return { ok: true };
};
const timers = [];
globalThis.setInterval = (f) => { timers.push(f); return 0; };
const tick = async () => { for (const f of timers) await f(); await new Promise((r) => setTimeout(r, 20)); };
const { watchDirect } = await import(pathToFileURL(file).href);

// a WebSocket app (Juntos, Ronda)
const VIA = "wss://games.jurisgames.com/juntos";
let got = [];
up.add("https://games.jurisgames.com/juntos");
watchDirect(VIA, (u) => got.push(u));
await new Promise((r) => setTimeout(r, 20));
assert.deepEqual(got, [], "the game host answers through Cloudflare: nothing changes");
up.clear();
up.add("https://direct.jurisgames.com:4321/juntos");
await tick();
assert.deepEqual(got, [DIRECT + "/juntos"], "Cloudflare down: the direct address, same path");
await tick();
assert.equal(got.length, 1, "not handed over again while it stays so");
up.add("https://games.jurisgames.com/juntos");
await tick();
assert.deepEqual(got.at(-1), VIA, "Cloudflare back: back to the usual address");

// GitHub can't be reached either: the address seen last time
timers.length = 0;
got = [];
github = false;
up.clear();
up.add("https://direct.jurisgames.com:4321/ronda");
watchDirect("wss://games.jurisgames.com/ronda", (u) => got.push(u));
await new Promise((r) => setTimeout(r, 20));
assert.deepEqual(got, [DIRECT + "/ronda"], "GitHub down too: the address remembered from before");

// an https app (Sumate)
timers.length = 0;
got = [];
up.clear();
up.add("https://direct.jurisgames.com:4321/sumate");
watchDirect("https://games.jurisgames.com/sumate", (u) => got.push(u));
await new Promise((r) => setTimeout(r, 20));
assert.deepEqual(got, ["https://direct.jurisgames.com:4321/sumate"], "an https app gets https");

// nothing answers: nothing is handed over; a test server address is left alone
timers.length = 0;
got = [];
up.clear();
watchDirect("wss://games.jurisgames.com/juntos", (u) => got.push(u));
watchDirect("ws://127.0.0.1:8797/juntos", (u) => got.push(u));
await new Promise((r) => setTimeout(r, 20));
assert.deepEqual(got, [], "the direct one down too: stays as it is");
console.log("direct_test: ALL OK (" + file.split(/[\\/]/).slice(-3).join("/") + ")");
