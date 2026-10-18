import fs from "node:fs";
const s = fs.readFileSync("verify2.mjs", "utf8");
const start = s.indexOf("function stripTs");
const end = s.indexOf("const src = stripTs");
(0, eval)(s.slice(start, end));
const file = process.argv[2];
if (file === "contracts") {
  const src = stripTs(fs.readFileSync("scripts/contracts.ts", "utf8").replace(/namespace NS\b/g, "").replace(/^export /gm, ""));
  console.log(src.split("\n").slice(0, 40).join("\n"));
  process.exit(0);
}
const t = fs.readFileSync(file, "utf8");
const re = /^function \w+\(/gm;
let m;
while ((m = re.exec(t))) {
  let i = m.index, d = 0, e = -1;
  for (let j = i; j < t.length; j++) {
    if (t[j] === "{") d++;
    else if (t[j] === "}") { d--; if (d === 0) { e = j; break; } }
  }
  console.log("--- helper ---");
  console.log(stripTs(t.slice(i, e + 1)).slice(0, 400));
}
