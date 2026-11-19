// The sheet code is written once (worker/src/index.js) and copied here as sheet.mjs, so both servers run the same
// thing. `node pack.mjs` makes sheet.mjs; `node pack.mjs <folder>` also puts server.mjs + sheet.mjs into <folder>
// (the game host's games/sumate/).
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// the sheet code imports the app's cal.js (when sign-ups are taken: one rule for both servers and the app)
const src = readFileSync(join(here, "../worker/src/index.js"), "utf8");
const imp = '"../../web/cal.js"';
if (!src.includes(imp)) throw new Error("index.js no longer imports " + imp);
writeFileSync(join(here, "sheet.mjs"), src.split(imp).join('"./cal.mjs"'));
copyFileSync(join(here, "../web/cal.js"), join(here, "cal.mjs"));
const out = process.argv[2];
if (out) {
  mkdirSync(out, { recursive: true });
  for (const f of ["server.mjs", "sheet.mjs", "cal.mjs", "package.json"]) copyFileSync(join(here, f), join(out, f));
}
console.log("sheet.mjs made" + (out ? `; copied to ${out}` : ""));
