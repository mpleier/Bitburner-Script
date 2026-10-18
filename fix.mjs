import fs from "node:fs";
const p = "verify2.mjs";
const lines = fs.readFileSync(p, "utf8").split("\n");
const idx = lines.findIndex((l) => l.includes("data = gen();"));
if (idx < 0) {
  console.log("anchor not found");
  process.exit(1);
}
lines[idx] = "    try { data = gen(globalThis.randomBigIntExclusive); } catch (e) { console.log(`SKIP  ${name}: ${e.message}`); break; }";
fs.writeFileSync(p, lines.join("\n"));
console.log("patched line", idx + 1);
console.log(lines[idx]);
