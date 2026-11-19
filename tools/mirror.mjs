// The copy of the site on GitHub Pages (https://kleiders3010.github.io/sumate/), for when Cloudflare is down.
// Copies web/ to <out> and points the HTML and manifest paths at <base> instead of "/". The scripts find their own
// folder themselves (import.meta.url), and the copy talks to the same room servers (signup.jurisgames.com, then
// games.jurisgames.com/sumate), so a sheet made on one site opens on the other.
// GitHub Pages has no "any path -> index.html" rule: 404.html is the same page, so /sumate/s/<id> links open the sheet.
// usage: node tools/mirror.mjs <out> [base=/sumate/]
import { cpSync, readFileSync, writeFileSync, readdirSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = process.argv[2];
const base = process.argv[3] || "/sumate/";
if (!out || !/^\/([\w-]+\/)*$/.test(base)) {
  console.error("usage: node tools/mirror.mjs <out> [base like /sumate/]");
  process.exit(2);
}
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(root, "web"), out, { recursive: true });

// root paths in attributes (href="/x", src="/x"), never "//host" ones
const fix = (s) => s.replace(/((?:href|src)=")\/(?!\/)/g, `$1${base}`);
let n = 0;
for (const f of readdirSync(out)) {
  if (!f.endsWith(".html")) continue;
  const p = join(out, f);
  const s = readFileSync(p, "utf8");
  const t = fix(s);
  n += (t !== s) | 0;
  writeFileSync(p, t);
}
const mp = join(out, "manifest.webmanifest");
const m = JSON.parse(readFileSync(mp, "utf8"));
m.start_url = base;
m.scope = base;
for (const i of m.icons || []) if (i.src.startsWith("/")) i.src = base + i.src.slice(1);
writeFileSync(mp, JSON.stringify(m, null, 2) + "\n");
writeFileSync(join(out, "404.html"), readFileSync(join(out, "index.html"), "utf8"));
writeFileSync(join(out, ".nojekyll"), "");

// nothing may still point at the site root
for (const f of readdirSync(out).filter((f) => f.endsWith(".html"))) {
  const left = (readFileSync(join(out, f), "utf8").match(/(?:href|src)="\/(?!\/)[^"]*"/g) || []).filter((a) => !a.includes(`="${base}`));
  if (left.length) throw new Error(`${f} still has root paths: ${left.join(" ")}`);
}
console.log(`mirror: ${out} (base ${base}, ${n} pages rewritten)`);
