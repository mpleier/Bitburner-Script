/**
 * ramtable.mjs
 * ============================================================================
 * Build the authoritative ns.<...> -> RAM cost table by evaluating the
 * `RamCosts` tree from RamCostGenerator.ts (the file the game itself uses).
 *
 * IMPORTANT: many Singularity API costs are wrapped in SF4Cost(), which
 * multiplies the base cost by 16 (SF4 level <= 1) or 4 (SF4 level == 2) and
 * only reaches the base cost at SF4 level >= 3:
 *
 *   function SF4Cost(cost) {
 *     return () => {
 *       if (Player.bitNodeN === 4) return cost;
 *       const sf4 = Player.activeSourceFileLvl(4);
 *       if (sf4 <= 1) return cost * 16;
 *       if (sf4 === 2) return cost * 4;
 *       return cost;
 *     };
 *   }
 *
 * So a module's RAM cost is *state dependent*. We therefore emit two tables:
 *   best  - SF4.3+ installed (cheapest legal cost)
 *   worst - no SF4 at all     (the budget you must actually plan for)
 *
 * Writes ramtable.json:
 *   { "best": {...}, "worst": {...}, "namespaces": [...] }
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

/** Evaluate the whole RamCosts tree for a given simulated SF4 level. */
function evaluate(sf4Level) {
  const namespaces = new Set();

  const { RamCosts } = eval(`(() => {
    const Player = { bitNodeN: 8, activeSourceFileLvl: (sf) => (sf === 4 ? ${sf4Level} : 0) };
    ${body}
    return { RamCosts };
  })()`);

  const table = {};
  const walk = (obj, prefix) => {
    for (const [key, value] of Object.entries(obj)) {
      const p = prefix ? `${prefix}.${key}` : key;
      if (typeof value === "number") table[p] = value;
      else if (typeof value === "function") table[p] = value();
      else if (value && typeof value === "object") {
        namespaces.add(p);
        walk(value, p);
      }
    }
  };
  walk(RamCosts, "");
  return { table, namespaces };
}

const best = evaluate(4);   // SF4.4 -> SF4Cost returns the base cost
const worst = evaluate(0);  // no SF4 -> 16x penalty on Singularity API

fs.writeFileSync(
  "ramtable.json",
  JSON.stringify({ best: best.table, worst: worst.table, namespaces: [...best.namespaces] }, null, 2)
);

const sf4Gated = Object.keys(best.table).filter((k) => best.table[k] !== worst.table[k]);

console.log(`wrote ${Object.keys(best.table).length} entries to ramtable.json`);
console.log(`  ${sf4Gated.length} functions are SF4-cost gated (cheapest at SF4.3+)`);

const samples = [
  "baseCost", "getPlayer", "singularity.getPlayer", "singularity.commitCrime",
  "corporation.getDivision", "corporation.hireEmployee", "formulas.gang.respectGain",
  "stanek.chargeFragment", "go.getBoardState", "infiltration.getInfiltration",
  "sleeve.getSleeve", "stock.buyStock", "codingcontract.attempt", "tprint", "sleep",
];
for (const k of samples) {
  console.log(`  ${k.padEnd(34)} best ${best.table[k]}  worst ${worst.table[k]}`);
}
