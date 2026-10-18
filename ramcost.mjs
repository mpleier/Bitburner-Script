// ramcost.mjs - print the documented RAM cost of every ns function the runner uses
import { readFileSync } from "node:fs";
const src = readFileSync("defs.d.ts", "utf8");
const lines = src.split("\n");
const wanted = [
  "scan(", "ls(", "getServer(", "getServerMaxRam(", "getHostname(", "exec(", "scp(", "sleep(",
  "print(", "tprint(", "clearLog(", "disableLog(", "nuke(", "brutessh(", "ftpcrack(", "relaysmtp(",
  "httpworm(", "sqlinject(", "dynamicImport(", "getContractType(", "getData(", "attempt(",
  "getNumTriesRemaining(", "isRunning(", "getServerInfo(",
];
for (let i = 0; i < lines.length; i++) {
  const t = lines[i].trim();
  for (const w of wanted) {
    if (t.startsWith(w)) {
      let cost = "not stated";
      for (let j = i - 1; j > i - 30; j--) {
        const m = lines[j].match(/RAM cost: ([0-9.]+) GB/);
        if (m) { cost = m[1] + " GB"; break; }
      }
      console.log(`${w.slice(0, -1)}: ${cost}`);
    }
  }
}
