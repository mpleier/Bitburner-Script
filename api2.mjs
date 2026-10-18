// api2.mjs - dump interface members from defs.d.ts
import fs from "node:fs";
const lines = fs.readFileSync("defs.d.ts", "utf8").split(/\r?\n/);
const names = process.argv.slice(2);

function dump(name) {
  const start = lines.findIndex((l) => l.trim() === `export interface ${name} {`);
  if (start < 0) return `--- ${name}: not found ---`;
  let depth = 0;
  const out = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("/**") || line.startsWith("*") || line.startsWith("*/")) continue;
    const before = depth;
    for (const ch of line) {
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
    }
    if (before === 1) out.push("  " + line);
    if (depth <= 0) break;
  }
  return `--- ${name} ---\n` + out.join("\n");
}

console.log(names.map(dump).join("\n\n"));
