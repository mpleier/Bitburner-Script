/**
 * ramtable.mjs
 * ============================================================================
 * Build the authoritative ns.<...> -> RAM cost table by evaluating the
 * `RamCosts` tree from RamCostGenerator.ts (the file the game itself uses).
 *
 * Writes ramtable.json: { "singularity.getPlayer": 0.5, ... }
 *
 * Run: node ramtable.mjs
 */
import fs from "node:fs";

const src = fs.readFileSync("RamCostGenerator.ts", "utf8");

/** Index just past the closing brace of the object literal opened at `open`. */
function literalEnd(open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  throw new Error("unbalanced object literal");
}

const constStart = src.indexOf("export const RamCostConstants = {");
const treeStart = src.indexOf("export const RamCosts: RamCostTree<NSFull> = {");
const treeEnd = literalEnd(treeStart + "export const RamCosts: RamCostTree<NSFull> = ".length);

/* Everything between RamCostConstants and the end of RamCosts is plain JS,
   except the type declarations and a couple of TS annotations, which we drop. */
const body = src
  .slice(constStart, treeEnd)
  .replace(/^export type[\s\S]*?^};$/m, "")
  .replace(/^type \w+ = [^\n]*;$/m, "")
  .replace(/^export /gm, "")
  .replace(/ as const/g, "")
  .replace(/\bconst (\w+):\s*[\w<>\[\]]+ =/g, "const $1 =")
  .replace(/\bfunction\s+(\w+)\s*\(([^)]*)\)\s*:\s*[^{]*\{/g,
    (_m, name, params) => `function ${name}(${params.replace(/:\s*[\w<>\[\]|()=> ]+/g, "")}) {`);

const { RamCostConstants, RamCosts } = eval(`(() => {
  const Player = { bitNodeN: 8, activeSourceFileLvl: () => 0 };
  ${body}
  return { RamCostConstants, RamCosts };
})()`);

const table = {};

function walk(obj, prefix) {
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "number") table[path] = value;
    else if (typeof value === "function") table[path] = value();
    else if (value && typeof value === "object") walk(value, path);
  }
}

walk(RamCosts, "");

fs.writeFileSync("ramtable.json", JSON.stringify(table, null, 2));

const samples = [
  "baseCost", "getPlayer", "singularity.getPlayer", "gang.getGangInformation",
  "corporation.getDivision", "corporation.hireEmployee", "formulas.gang.respectGain",
  "stanek.chargeFragment", "go.getBoardState", "infiltration.getInfiltration",
  "sleeve.getSleeve", "stock.buyStock", "codingcontract.attempt", "tprint", "sleep",
];

console.log(`wrote ${Object.keys(table).length} entries to ramtable.json`);
for (const k of samples) console.log(`  ${k} = ${table[k]}`);
