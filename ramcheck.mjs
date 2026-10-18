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
    return JSON.parse(fs.readFileSync(tablePath, "utf8"));
  }
  // Fallback: the flat leaf-name dump (UTF-16LE or UTF-8).
  const raw = fs.readFileSync(path.join(process.cwd(), "ramcost.txt"));
  const txt = raw.slice(0, 2).toString("hex") === "fffe" ? raw.toString("utf16le") : raw.toString("utf8");
  const table = {};
  for (const line of txt.split("\n")) {
    const m = line.trim().match(/^([a-zA-Z_][a-zA-Z0-9_]*)=([0-9.]+)$/);
    if (m) table[m[1]] = Number(m[2]);
  }
  return table;
}

const RAM = loadRamTable();

function costOf(name) {
  if (name in RAM) return RAM[name];
  const leaf = name.split(".").pop();
  return leaf in RAM ? RAM[leaf] : undefined;
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

/** Every distinct `ns.foo` / `ns.foo.bar` reference in a file. */
function referencedFunctions(src) {
  const clean = stripNonCode(src);
  const names = new Set();
  for (const m of clean.matchAll(/\bns\.([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)/g)) {
    names.add(m[1]);
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

