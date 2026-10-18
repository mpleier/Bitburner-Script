import fs from "node:fs";
const raw = fs.readFileSync("ramcost.txt");
const txt = raw.slice(0, 2).toString("hex") === "fffe" ? raw.toString("utf16le") : raw.toString("utf8");
const map = new Map();
for (const line of txt.split("\n")) {
  const m = line.trim().match(/^([a-zA-Z_][a-zA-Z0-9_]*)=([0-9.]+)$/);
  if (m) map.set(m[1], Number(m[2]));
}
console.log("size", map.size, "getPlayer", map.get("getPlayer"));
