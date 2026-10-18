// ramcost2.mjs - extract RAM cost for every API function from defs.d.ts
import fs from "node:fs";
const text = fs.readFileSync("defs.d.ts", "utf8");
const lines = text.split(/\r?\n/);
let pending = null;
const map = {};
for (const raw of lines) {
  const l = raw.trim();
  const c = l.match(/RAM cost: ([0-9.]+) GB/);
  if (c) pending = Number(c[1]);
  const m = l.match(/^([A-Za-z_][A-Za-z0-9_]*)\(/);
  if (m && pending !== null) {
    if (map[m[1]] === undefined) map[m[1]] = pending;
    pending = null;
  }
}
const rows = Object.entries(map).sort((a, b) => b[1] - a[1]);
console.log(rows.map(([k, v]) => `${k}=${v}`).join("\n"));
console.log("total keys:", rows.length);
