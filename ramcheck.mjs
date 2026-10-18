/**
 * ramcheck.mjs
 * ============================================================================
 * Static RAM budget audit for the Bitburner automation suite.
 *
 * Bitburner computes a script's RAM cost *statically*: it walks the source,
 * collects every DISTINCT ns function the script touches, and sums those costs
 * on top of the 1.6 GB base cost. Calling a function 1000 times does NOT
 * multiply its cost - see updateDynamicRam() in src/Netscript/Helpers.tsx,
 * which short-circuits on `ws.dynamicLoadedFns[fnName]`.
 *
 * So the right question is "which ns functions does this file reference?",
 * not "how many times does it call them?".
 *
 * This tool:
 *   1. loads the authoritative cost table (ramtable.json, built by ramtable.mjs
 *      from RamCostGenerator.ts),
 *   2. scans every scripts/*.ts for `ns.<...>` references,
 *   3. computes the exact static RAM cost,
 *   4. compares it with the file's declared `const RAM_NEEDED = ...`,
 *   5. cross-checks against the mock harness's dynamic usage.
 *
 * Run:
 *   node ramtable.mjs          # (once) regenerate ramtable.json
 *   node ramcheck.mjs          # audit
 *   node ramcheck.mjs --no-dynamic
 *   node ramcheck.mjs --fix-hint
 *
 * Exit code is 1 if any module's declared budget is smaller than its real cost.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const SCRIPTS = path.join(process.cwd(), "scripts");
const BASE_COST = 1.6; // RamCostConstants.Base

/* -------------------------------------------------------------------------- */
/* Cost table                                                                 */
/* -------------------------------------------------------------------------- */
function loadRamTable() {
  const tablePath = path.join(process.cwd(), "ramtable.json");
  if (fs.existsSync(tablePath)) {
    const raw = JSON.parse(fs.readFileSync(tablePath, "utf8"));
    if (raw && raw.best && raw.worst) return raw;
    return { best: raw, worst: raw, namespaces: [] }; // legacy flat table
  }
  // Fallback: the flat leaf-name dump (UTF-16LE or UTF-8).
  const raw = fs.readFileSync(path.join(process.cwd(), "ramcost.txt"));
  const txt = raw.slice(0, 2).toString("hex") === "fffe" ? raw.toString("utf16le") : raw.toString("utf8");
  const table = {};
  for (const line of txt.split("\n")) {
    const m = line.trim().match(/^([a-zA-Z_][a-zA-Z0-9_]*)=([0-9.]+)$/);
    if (m) table[m[1]] = Number(m[2]);
  }
  return { best: table, worst: table, namespaces: [] };
}

const RAM = loadRamTable();
const NAMESPACES = new Set(RAM.namespaces || []);

/**
 * Cost of `ns.<name>`.
 * scenario = "worst" (no SF4 -> Singularity API costs 16x) or "best" (SF4.3+).
 */
function costOf(name, scenario) {
  const table = scenario === "worst" ? RAM.worst : RAM.best;
  if (name in table) return table[name];
  const leaf = name.split(".").pop();
  return leaf in table ? table[leaf] : undefined;
}
/* -------------------------------------------------------------------------- */
/* Source scanning                                                            */
/* -------------------------------------------------------------------------- */
/** Remove comments and string literals so we only match real code. */
function stripNonCode(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, " ");
}

/** Every distinct `ns.foo` / `ns.foo.bar` *function* reference in a file. */
function referencedFunctions(src) {
  const clean = stripNonCode(src);
  const names = new Set();
  for (const m of clean.matchAll(/\bns\.([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)/g)) {
    const name = m[1];
    const head = name.split(".")[0];
    // ns.args and ns.enums are not RAM-charged API functions.
    if (head === "args" || head === "enums") continue;
    // A bare namespace reference (ns.corporation) costs nothing by itself.
    if (NAMESPACES.has(name)) continue;
    names.add(name);
  }
  return names;
}

function hasMain(src) {
  return /export\s+(async\s+)?function\s+main\s*\(/.test(src);
}

function declaredBudget(src) {
  const m = src.match(/const\s+RAM_NEEDED\s*=\s*(\d+)/);
  return m ? Number(m[1]) : null;
}

/* -------------------------------------------------------------------------- */
/* Dynamic cross-check via the mock harness                                    */
/* -------------------------------------------------------------------------- */
function dynamicUsage() {
  const out = execFileSync("node", ["mocksuite.mjs", "--loops", "3"], { encoding: "utf8" });
  const map = new Map();
  for (const line of out.split("\n")) {
    const m = line.match(/^\s+([A-Za-z0-9_.]+\.(?:ts|js))\s+([\d.]+)\s+GB\s+declared\s+(-|\d+)/);
    if (m) map.set(m[1], Number(m[2]));
  }
  return map;
}

/* -------------------------------------------------------------------------- */
/* Audit                                                                      */
/* -------------------------------------------------------------------------- */
const useDynamic = !process.argv.includes("--no-dynamic");
const fixHint = process.argv.includes("--fix-hint");
const dynamic = useDynamic ? dynamicUsage() : new Map();

const rows = [];
let problems = 0;

for (const file of fs.readdirSync(SCRIPTS)) {
  if (!file.endsWith(".ts") && !file.endsWith(".js")) continue;
  const src = fs.readFileSync(path.join(SCRIPTS, file), "utf8");
  const names = referencedFunctions(src);

  const items = [];
  const unknown = [];
  for (const name of names) {
    const best = costOf(name, "best");
    const worst = costOf(name, "worst");
    if (best === undefined && worst === undefined) {
      unknown.push(name);
      continue;
    }
    if (worst > 0) items.push({ name, best: best ?? 0, worst: worst ?? 0 });
  }
  items.sort((a, b) => b.worst - a.worst);

  const totalBest = BASE_COST + items.reduce((s, i) => s + i.best, 0);
  const totalWorst = BASE_COST + items.reduce((s, i) => s + i.worst, 0);
  const declared = declaredBudget(src);
  const dyn = dynamic.get(file);

  rows.push({ file, executed: hasMain(src), distinct: items.length, totalBest, totalWorst, declared, dyn, items, unknown });
  if (declared !== null && totalWorst > declared) problems++;
}

const bar = "=".repeat(86);

console.log(bar);
console.log("Static RAM audit - Bitburner charges each DISTINCT ns function once");
console.log(`base cost ${BASE_COST} GB + sum of distinct ns function costs`);
console.log(`"worst" = no SF4 (Singularity API costs 16x), "best" = SF4.3+ installed`);
console.log(bar);

for (const r of rows.sort((a, b) => b.totalWorst - a.totalWorst)) {
  const declared = r.declared === null ? "n/a" : String(r.declared);
  const headroom = r.declared === null ? null : r.declared - r.totalWorst;
  const verdict =
    r.declared === null
      ? "no RAM_NEEDED declared"
      : headroom >= 0
        ? `headroom ${headroom.toFixed(1)} GB`
        : `OVER BUDGET by ${(r.totalWorst - r.declared).toFixed(1)} GB`;

  console.log(
    `\n${r.file.padEnd(20)} worst ${r.totalWorst.toFixed(2).padStart(7)} GB  ` +
    `best ${r.totalBest.toFixed(2).padStart(7)} GB  ` +
    `declared ${declared.padStart(4)}  ${verdict}` +
    (r.dyn !== undefined ? `  (mock dynamic: ${r.dyn.toFixed(2)} GB)` : "") +
    (r.executed ? "" : "  [library file, never executed]")
  );

  for (const item of r.items.slice(0, 12)) {
    const note = item.best === item.worst ? "" : `  (SF4.3+ -> ${item.best.toFixed(2)})`;
    console.log(`      ${item.name.padEnd(34)} ${item.worst.toFixed(2)} GB${note}`);
  }
  if (r.items.length > 12) {
    console.log(`      ... ${r.items.length - 12} more distinct functions ` +
      `(${r.items.slice(12).reduce((s, i) => s + i.worst, 0).toFixed(2)} GB)`);
  }
  if (r.unknown.length) {
    console.log(`      UNKNOWN API names (not in cost table): ${r.unknown.join(", ")}`);
  }
}

console.log("\n" + bar);
console.log(`Modules with a declared budget: ${rows.filter((r) => r.declared !== null).length}`);
console.log(`Modules over their declared budget: ${problems}`);

if (fixHint) {
  console.log("\nSuggested RAM_NEEDED values (worst-case static cost rounded up, +1 GB margin):");
  console.log("Note: if SF4.3+ is installed, the Singularity API is 16x cheaper and these");
  console.log("values can be reduced to the 'best' column.");
  for (const r of rows) {
    if (r.declared === null) continue;
    const suggested = Math.ceil(r.totalWorst) + 1;
    const suggestedBest = Math.ceil(r.totalBest) + 1;
    if (suggested !== r.declared) {
      console.log(
        `  ${r.file.padEnd(20)} RAM_NEEDED = ${String(r.declared).padStart(4)}  ->  ` +
        `${String(suggested).padStart(4)} (worst)   ${String(suggestedBest).padStart(4)} (SF4.3+)`
      );
    }
  }
}

console.log(bar);
if (problems > 0) process.exitCode = 1;

