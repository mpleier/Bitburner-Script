import fs from "node:fs";
const t = fs.readFileSync("scripts/contracts.ts", "utf8");
const i = t.indexOf("SOLVERS");
console.log(t.slice(i, i + 2600));
