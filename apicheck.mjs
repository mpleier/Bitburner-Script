/**
 * apicheck.mjs - static verification of the suite against the real Bitburner
 * API in defs.d.ts. Run: node apicheck.mjs
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DEF = path.join(ROOT, "defs.d.ts");
const SCRIPTS = path.join(ROOT, "scripts");
const RAM = path.join(ROOT, "ramcost.txt");

const def = fs.readFileSync(DEF, "utf8");

/** interfaceName -> { members: Set<string>, nested: Map<memberName, typeName> } */
const interfaces = new Map();

function parseInterface(name) {
  if (interfaces.has(name)) return interfaces.get(name);
  const m =
    def.match(new RegExp(`(?:export )?(?:interface|type) ${name}\\s*(?:extends[^{=]*)?=\\s*\\{`)) ||
    def.match(new RegExp(`(?:export )?interface ${name}(?:\\s+extends[^{]*)?\\s*\\{`));
  if (!m) return null;
  const start = m.index;
  const header = def.slice(start, def.indexOf("{", start));
  const extendsList = (header.match(/extends\s+([A-Za-z_][A-Za-z0-9_,\s]*)/) || [])[1];

  let depth = 0, i = def.indexOf("{", start), end = i;
  for (; i < def.length; ++i) {
    if (def[i] === "{") depth++;
    else if (def[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
  }

  const body = def.slice(start, end);
  const members = new Set();
  const nested = new Map();

  for (const line of body.split("\n")) {
    const m = line.match(/^\s*(?:readonly\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_]*|\"[^\"]*\"|[0-9]+)(?:\[[^\]]*\])?;/);
    if (m) {
      members.add(m[1]);
      const isArray = /\[[^\]]*\]\s*;/.test(line);
      if (!isArray && !m[2].startsWith("\"") && !/^[0-9]+$/.test(m[2]) && m[2] !== "string" && m[2] !== "number" && m[2] !== "boolean" && m[2] !== "Promise") {
        nested.set(m[1], m[2]);
      }
    }
    const f = line.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/);
    if (f) members.add(f[1]);
  }

  if (extendsList) {
    for (const parent of extendsList.split(",").map((s) => s.trim())) {
      const p = parseInterface(parent);
      if (p) {
        for (const m of p.members) members.add(m);
        for (const [k, v] of p.nested) nested.set(k, v);
      }
    }
  }

  const rec = { members, nested };
  interfaces.set(name, rec);
  return rec;
}

parseInterface("NS");
const NS = interfaces.get("NS");

/* -------------------------------------------------------------------------- */
/* 2. Extract ns.* references from every module                                */
/* -------------------------------------------------------------------------- */
const refs = new Map();

for (const file of fs.readdirSync(SCRIPTS)) {
  if (!file.endsWith(".ts")) continue;
  const src = fs.readFileSync(path.join(SCRIPTS, file), "utf8");
  for (const m of src.matchAll(/\bns\.([a-zA-Z_][a-zA-Z0-9_]*)(?:\.([a-zA-Z_][a-zA-Z0-9_]*))?(?:\.([a-zA-Z_][a-zA-Z0-9_]*))?/g)) {
    const key = [m[1], m[2], m[3]].filter(Boolean).join(".");
    if (!refs.has(key)) refs.set(key, new Set());
    refs.get(key).add(file);
  }
}

/* -------------------------------------------------------------------------- */
/* 3. Validate                                                                */
/* -------------------------------------------------------------------------- */
const problems = [];
const ok = [];

for (const [key, files] of [...refs.entries()].sort()) {
  const parts = key.split(".");
  const top = parts[0];

  if (!NS.members.has(top)) {
    problems.push(`ns.${key}  (${[...files].join(", ")}) -> ns.${top} does not exist`);
    continue;
  }
  if (parts.length === 1) { ok.push(key); continue; }

  const typeName = NS.nested.get(top);
  const ARRAY_METHODS = new Set(["map", "filter", "join", "forEach", "includes", "length", "slice", "concat", "some", "find", "reduce", "sort", "push", "flat", "indexOf"]);
  if (parts.length > 1 && ARRAY_METHODS.has(parts[1])) { ok.push(key); continue; }
  if (!typeName) {
    if (parts.length > 1) problems.push(`ns.${key} -> ns.${top} is not a namespace`);
    else ok.push(key);
    continue;
  }

  const iface = parseInterface(typeName);
  if (!iface) { problems.push(`ns.${key} -> could not resolve interface ${typeName}`); continue; }

  if (!iface.members.has(parts[1])) {
    problems.push(`ns.${key}  (${[...files].join(", ")}) -> ${typeName} has no member "${parts[1]}"`);
    continue;
  }

  if (parts.length === 3) {
    const sub = iface.nested.get(parts[1]);
    if (!sub) { problems.push(`ns.${key} -> ${typeName}.${parts[1]} is not a namespace`); continue; }
    const subIface = parseInterface(sub);
    if (!subIface || !subIface.members.has(parts[2])) {
      problems.push(`ns.${key} -> ${sub} has no member "${parts[2]}"`);
      continue;
    }
  }
  ok.push(key);
}

/* -------------------------------------------------------------------------- */
/* 4. RAM budget cross-check                                                   */
/* -------------------------------------------------------------------------- */
const ramCost = new Map();
for (const line of fs.readFileSync(RAM, "utf8").split("\n")) {
  const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)=([0-9.]+)$/);
  if (m) ramCost.set(m[1], Number(m[2]));
}

console.log("=".repeat(78));
console.log("API coverage check against defs.d.ts");
console.log("=".repeat(78));
console.log(`distinct ns.* references: ${refs.size}`);
console.log(`validated:              ${ok.length}`);
console.log(`problems:               ${problems.length}`);
if (problems.length) {
  for (const p of problems) console.log("  x " + p);
  process.exitCode = 1;
} else {
  console.log("  OK: every ns.* call in scripts/ exists in the real API");
}

console.log("");
console.log("=".repeat(78));
console.log("Declared RAM budget vs. header comment");
console.log("=".repeat(78));

for (const file of fs.readdirSync(SCRIPTS)) {
  if (!file.endsWith(".ts")) continue;
  const src = fs.readFileSync(path.join(SCRIPTS, file), "utf8");
  const declared = src.match(/const RAM_NEEDED = (\d+);/);
  const header = src.match(/=>\s*~?([0-9.]+)\s*GB/i);
  if (declared && header && Number(declared[1]) !== Number(header[1])) {
    console.log(`  ~ ${file}: RAM_NEEDED ${declared[1]} vs header ~${header[1]} GB`);
  }
}
console.log("=".repeat(78));

