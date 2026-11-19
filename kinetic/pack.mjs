// The sheet code is written once (worker/src/index.js) and copied here as sheet.mjs, so both servers run the same
// thing. `node pack.mjs` makes sheet.mjs; `node pack.mjs <folder>` also puts server.mjs + sheet.mjs into <folder>
// (the game host's games/sumate/).
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
copyFileSync(join(here, "../worker/src/index.js"), join(here, "sheet.mjs"));
const out = process.argv[2];
if (out) {
  mkdirSync(out, { recursive: true });
  for (const f of ["server.mjs", "sheet.mjs", "package.json"]) copyFileSync(join(here, f), join(out, f));
}
console.log("sheet.mjs made" + (out ? `; copied to ${out}` : ""));
