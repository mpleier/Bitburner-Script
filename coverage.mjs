// coverage.mjs - report which of the 30 game contract types contracts.ts handles
// and which ones fuzz.mjs actually exercises.
import { readFileSync } from "node:fs";

const enumSrc = readFileSync("ContractEnums.ts", "utf8");
const gameTypes = [...enumSrc.matchAll(/=\s*"([^"]+)"/g)].map((m) => m[1]);

const src = readFileSync("scripts/contracts.ts", "utf8");
const handled = new Set([...src.matchAll(/case\s+"([^"]+)"/g)].map((m) => m[1]));

const fuzz = readFileSync("fuzz.mjs", "utf8");
const tested = new Set([...fuzz.matchAll(/solve\("([^"]+)"/g)].map((m) => m[1]));

const norm = (s) => s.replace(/[^\x00-\x7F]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

console.log("game types:", gameTypes.length);
console.log("solver cases:", handled.size);
console.log("fuzz-tested:", tested.size);
for (const t of gameTypes) {
  const n = norm(t);
  const ok = [...tested].some((x) => norm(x) === n);
  console.log(`  ${ok ? "OK " : "NO"}  ${t}`);
}
