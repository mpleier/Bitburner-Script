/**
 * ramgap.mjs
 * ============================================================================
 * Bitburner reserves RAM *statically* and charges it *dynamically*:
 *
 *   static  src/Script/RamCalculations.ts   walks the AST of the script and of
 *                                           every script it *statically* imports
 *   dynamic src/Netscript/APIWrapper.ts     helpers.updateDynamicRam() adds the
 *                                           cost of each ns function the first
 *                                           time it is actually called
 *
 * If dynamic usage ever exceeds the static allocation the game kills the script:
 *   "Dynamic RAM usage calculated to be greater than RAM allocation."
 *
 * The classic way to hit that is ns.dynamicImport(): the imported module is not
 * part of the AST walk, so the API calls it makes are never reserved.
 *
 * This tool replays both passes locally and fails if any script can outgrow its
 * allocation.
 *
 * Run: node ramgap.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { transformSync } from "@swc/core";
import * as acorn from "acorn";
import * as walk from "acorn-walk";

const require = createRequire(import.meta.url);
const RAM = require("./ramtable.json");
const BEST = RAM.best;
const WORST = RAM.worst;
const NAMESPACES = new Set(RAM.namespaces || []);
const BASE = 1.6; // RamCostConstants.Base
const SCRIPTS = path.join(process.cwd(), "scripts");

/* -------------------------------------------------------------------------- */
/* AST helpers                                                                */
/* -------------------------------------------------------------------------- */
function astOf(file) {
  const code = fs.readFileSync(file, "utf8");
  const js = transformSync(code, {
    jsc: {
      parser: { syntax: file.endsWith(".ts") ? "typescript" : "ecmascript" },
      target: "esnext",
    },
  }).code;
  return acorn.parse(js, { ecmaVersion: "latest", sourceType: "module" });
}

/** Full dotted path of an `ns.a.b` member expression, or null. */
function nsPath(node) {
  if (node.object.type === "Identifier" && node.object.name === "ns") {
    return node.property.type === "Identifier" ? node.property.name : null;
  }
  if (node.object.type === "MemberExpression") {
    const parent = nsPath(node.object);
    if (parent && node.property.type === "Identifier") return parent + "." + node.property.name;
  }
  return null;
}

/** API calls, static imports and dynamic imports found in one file. */
function analyse(file) {
  const ast = astOf(file);
  const api = new Set();
  const staticImports = new Set();
  const dynamicImports = new Set();

  walk.simple(ast, {
    MemberExpression(node) {
      const p = nsPath(node);
      if (!p) return;
      const head = p.split(".")[0];
      if (head === "args" || head === "enums" || head === "pid") return; // ns.args / ns.enums / ns.pid are free
      if (NAMESPACES.has(p)) return; // a bare namespace reference costs nothing
      api.add(p);
    },
    ImportDeclaration(node) {
      staticImports.add(node.source.value);
    },
    CallExpression(node) {
      if (node.callee.type !== "MemberExpression") return;
      const p = nsPath(node.callee);
      if (p === "dynamicImport" && node.arguments[0] && node.arguments[0].type === "Literal") {
        dynamicImports.add(String(node.arguments[0].value));
      }
    },
  });

  return { api, staticImports, dynamicImports };
}

/** Resolve a specifier the way the game does: same server, script extension. */
function resolve(spec, baseFile) {
  const joined = path.normalize(path.join(path.dirname(baseFile), spec));
  if (!joined.startsWith(SCRIPTS)) return null; // escapes the script root
  return fs.existsSync(joined) ? joined : null;
}

function costOf(name, table) {
  if (name in table) return table[name];
  const leaf = name.split(".").pop();
  return leaf in table ? table[leaf] : undefined;
}

/* -------------------------------------------------------------------------- */
/* Walk every script                                                          */
/* -------------------------------------------------------------------------- */
const info = new Map(); // absolute path -> { api, staticImports, dynamicImports }
for (const file of fs.readdirSync(SCRIPTS)) {
  if (!file.endsWith(".ts") && !file.endsWith(".js")) continue;
  info.set(path.join(SCRIPTS, file), analyse(path.join(SCRIPTS, file)));
}

/** API calls the game can *see*, i.e. the script plus its static imports. */
function reservedApi(file, seen = new Set()) {
  if (seen.has(file)) return new Set();
  seen.add(file);
  const entry = info.get(file);
  let acc = new Set(entry ? entry.api : []);
  for (const spec of entry ? entry.staticImports : []) {
    const resolved = resolve(spec, file);
    if (!resolved) continue;
    for (const n of reservedApi(resolved, seen)) acc.add(n);
  }
  return acc;
}

/** API calls that can actually be made: the whole module graph, dynamic imports
 *  included. Anything reached only through ns.dynamicImport() is NOT reserved by
 *  the static pass, which is what triggers the RAM usage error. */
function chargedApi(file, seen = new Set()) {
  if (seen.has(file)) return new Set();
  seen.add(file);
  const entry = info.get(file);
  let acc = new Set(entry ? entry.api : []);
  for (const spec of entry ? [...entry.staticImports, ...entry.dynamicImports] : []) {
    const resolved = resolve(spec, file);
    if (!resolved) continue;
    for (const n of chargedApi(resolved, seen)) acc.add(n);
  }
  return acc;
}

function total(names, table) {
  let sum = BASE;
  const unknown = [];
  for (const n of names) {
    const c = costOf(n, table);
    if (c === undefined) {
      unknown.push(n);
      continue;
    }
    sum += c;
  }
  return { sum: Math.round(sum * 100) / 100, unknown };
}

/* -------------------------------------------------------------------------- */
/* Report                                                                     */
/* -------------------------------------------------------------------------- */
let problems = 0;
const bar = "=".repeat(88);
console.log(bar);
console.log("RAM allocation (static) vs. RAM charge (dynamic)");
console.log('"best" = SF4.3+ installed (smallest allocation, the one that can bite)');
console.log('"worst" = no SF4 (Singularity API costs 16x), used for the declared budget');
console.log(bar);

for (const file of fs.readdirSync(SCRIPTS)) {
  if (!file.endsWith(".ts") && !file.endsWith(".js")) continue;
  const full = path.join(SCRIPTS, file);
  if (!info.has(full)) continue;

  const reserved = total(reservedApi(full), BEST);
  const reservedWorst = total(reservedApi(full), WORST);
  const charged = total(chargedApi(full), BEST);
  const gap = Math.round((charged.sum - reserved.sum) * 100) / 100;

  const src = fs.readFileSync(full, "utf8");
  const declaredMatch = src.match(/(?:RAM_NEEDED|AUTOBOT_RAM)\s*=\s*(\d+)/);
  const declared = declaredMatch ? Number(declaredMatch[1]) : null;

  const head = `${file.padEnd(20)} allocated ${String(reserved.sum).padStart(6)} GB | charged ${String(charged.sum).padStart(6)} GB | declared ${String(declared ?? "-").padStart(4)}`;

  if (gap > 0) {
    problems++;
    const missing = [...chargedApi(full)].filter((n) => !reservedApi(full).has(n));
    console.log(`${head}  <-- RAM USAGE ERROR, unreserved: ${missing.join(", ")}`);
  } else if (declared !== null && reserved.sum > declared) {
    problems++;
    console.log(`${head}  <-- declared budget below the real allocation (${reserved.sum} GB, worst case ${reservedWorst.sum} GB)`);
  } else {
    console.log(head);
  }

  if (reserved.unknown.length) {
    console.log(`    not in ramtable.json: ${reserved.unknown.join(", ")}`);
  }
}

console.log("\n" + bar);
console.log(
  problems === 0
    ? "OK - every script's allocation covers every API call it can make"
    : `${problems} script(s) at risk`
);
process.exitCode = problems ? 1 : 0;
