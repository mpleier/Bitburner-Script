// mockrun.mjs - end-to-end test of contractRunner.ts against a fake ns API.
// Simulates: network scan, .cct files, root access, port programs, attempts.
// `node mockrun.mjs --install` additionally exercises scripts/install.js, whose
// ns.wget() is stubbed to read the file straight off disk instead of GitHub.
import fs from "node:fs";
import solvers from "./build/contracts.js";
import runner from "./build/contractRunner.js";

const servers = {
  home: { maxRam: process.env.LOW_RAM ? 8 : 32, root: true, ports: 0, required: 0 },
  n0001: { maxRam: 8, root: false, ports: 0, required: 1 },
  n0002: { maxRam: 8, root: false, ports: 0, required: 2 },
  n0003: { maxRam: 8, root: false, ports: 0, required: 3 },
  n0004: { maxRam: 8, root: false, ports: 0, required: 4 },
  n0005: { maxRam: 8, root: false, ports: 0, required: 5 },
  CSEC: { maxRam: 16, root: true, ports: 5, required: 5 },
  n0006: { maxRam: process.env.NO_BIG ? 16 : 64, root: true, ports: 5, required: 5 },
  // 2 ports already open, needs 3 -> owning 1 more program is enough to NUKE
  n0007: { maxRam: 8, root: false, ports: 2, required: 3 },
};

const connections = {
  home: ["n0001", "n0002", "n0003", "n0004", "n0005", "n0007", "CSEC", "n0006"],
  n0001: ["home"],
  n0002: ["home"],
  n0003: ["home"],
  n0004: ["home"],
  n0005: ["home"],
  n0007: ["home"],
  n0006: ["home"],
  CSEC: ["home"],
};

const contracts = {
  n0001: { "prime.cct": ["Find Largest Prime Factor", 60] },
  n0002: { "spiral.cct": ["Spiralize Matrix", [[1, 2, 3], [4, 5, 6], [7, 8, 9]]] },
  n0003: { "stock.cct": ["Algorithmic Stock Trader IV", [2, [1, 2, 3, 4, 5]]] },
  n0004: { "sqrt.cct": ["Square Root", 123456789012345678901234567890n] },
  n0005: { "rect.cct": ["Largest Rectangle in a Matrix", [[0, 0, 0], [0, 0, 0], [1, 1, 1]]] },
  CSEC: { "hamming.cct": ["HammingCodes: Encoded Binary to Integer", "1001101011"] },
  // n0007 already has 2 of the 3 required ports open -> only 1 more program needed
  n0007: { "subseq.cct": ["Subarray with Maximum Sum", [1, 2, 3, -1, 5, -2, 4]] },
};

const ownedPrograms = new Set(["BruteSSH.exe", "FTPCrack.exe", "relaySMTP.exe"]);

const filesOn = { home: ["contracts.ts", "contractRunner.ts"] };
for (const [host, ccts] of Object.entries(contracts)) filesOn[host] = Object.keys(ccts);

const log = [];
const pending = [];
const ns = {
  args: process.argv.slice(2),
  clearLog() {},
  disableLog() {},
  print(...a) { log.push(a.join(" ")); },
  tprint(...a) { console.log("[tprint] " + a.join(" ")); },
  sleep: async () => true,
  getHostname: () => "home",
  scan: (h = "home") => connections[h] ?? [],
  ls: (h = "home", filter = "") => (filesOn[h] ?? []).filter((f) => f.includes(filter)),
  getServer: (h) => ({
    hostname: h,
    maxRam: servers[h].maxRam,
    hasAdminRights: servers[h].root,
    sshPortOpen: servers[h].ports >= 1,
    ftpPortOpen: servers[h].ports >= 2,
    smtpPortOpen: servers[h].ports >= 3,
    httpPortOpen: servers[h].ports >= 4,
    sqlPortOpen: servers[h].ports >= 5,
    numOpenPortsRequired: servers[h].required,
  }),
  getServerMaxRam: (h) => servers[h].maxRam,
  scp: (f, dest) => {
    filesOn[dest] = filesOn[dest] || [];
    if (!filesOn[dest].includes(f)) filesOn[dest].push(f);
    return true;
  },
  wget: async (url, target, host = "home") => {
    const name = url.split("/").pop();
    const path = `scripts/${name}`;
    if (!fs.existsSync(path)) {
      console.log(`[wget] FAILED ${url}`);
      return false;
    }
    filesOn[host] = filesOn[host] || [];
    if (!filesOn[host].includes(target)) filesOn[host].push(target);
    console.log(`[wget] ${url} -> ${host}/${target} (${fs.readFileSync(path, "utf8").length} bytes)`);
    return true;
  },
  exec: (script, host, threads, ...args) => {
    pending.push({ script, host, args });
    console.log(`[exec] ${script} on ${host} args=${args.join(" ")}`);
    return 1;
  },
  dynamicImport: () => solvers,
  nuke: (h) => {
    if (servers[h].ports < servers[h].required) return false;
    servers[h].root = true;
    return true;
  },
  brutessh: (h) => ownedPrograms.has("BruteSSH.exe") && (servers[h].ports = Math.max(servers[h].ports, 1), true),
  ftpcrack: (h) => ownedPrograms.has("FTPCrack.exe") && (servers[h].ports = Math.max(servers[h].ports, 2), true),
  relaysmtp: (h) => ownedPrograms.has("relaySMTP.exe") && (servers[h].ports = Math.max(servers[h].ports, 3), true),
  httpworm: () => false,
  sqlinject: () => false,
  codingcontract: {
    getContractTypes: () => solvers.CONTRACT_TYPES,
    getContractType: (f, h) => contracts[h]?.[f]?.[0] ?? "Unknown",
    getData: (f, h) => contracts[h]?.[f]?.[1] ?? null,
    getNumTriesRemaining: (f, h) => (contracts[h]?.[f] ? 10 : 0),
    attempt: (answer, f, h) => {
      const c = contracts[h]?.[f];
      if (!c) return "";
      const expected = solvers.solve(c[0], c[1]);
      const enc = (v) => (typeof v === "bigint" ? v.toString() : JSON.stringify(v));
      const ok = enc(answer) === enc(expected);
      if (ok) {
        delete contracts[h][f];
        return `10 GB RAM / ${h}`;
      }
      return "";
    },
  },
};

(async () => {
  if (process.argv.includes("--install")) {
    const src = fs.readFileSync("scripts/install.js", "utf8");
    const installer = await import("data:text/javascript," + encodeURIComponent(src));
    await installer.main(ns);
    for (const job of pending) {
      ns.args = job.args;
      await runner.main(ns);
    }
  } else {
    await runner.main(ns);
  }
  console.log("\n--- log ---");
  for (const l of log) console.log(l);
  console.log("\nremaining contracts:", Object.entries(contracts).map(([h, c]) => `${h}: ${Object.keys(c).join(",")}`).join(" | "));
})();
