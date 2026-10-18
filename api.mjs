// api.mjs - dump the NS API surface from defs.d.ts so modules use real names.
import fs from "node:fs";

const text = fs.readFileSync("defs.d.ts", "utf8");
const start = text.indexOf("export interface NS");
const lines = text.slice(start).split(/\r?\n/);

let depth = 0;
const path = [];
const out = [];

for (const raw of lines) {
  const line = raw.trim();
  if (!line || line.startsWith("/**") || line.startsWith("*") || line.startsWith("*/")) continue;

  const before = depth;
  for (const ch of line) {
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
  }

  if (before === 1) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(:|\{)/);
    if (m) out.push("NS." + m[1] + (m[2] === "{" ? " {namespace}" : ""));
  }
  if (depth <= 0) break;
}

console.log(out.join("\n"));
