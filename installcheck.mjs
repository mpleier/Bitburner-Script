/**
 * installcheck.mjs - run scripts/install.js against the mock ns API.
 *
 *   node installcheck.mjs
 *
 * ns.wget() is stubbed to read the file straight off disk instead of GitHub, so
 * the download -> verify -> exec path is exercised end to end. Every installer
 * flag is run once and its terminal output is printed.
 */
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { makeNs } from "./mocksuite.mjs";

const installer = await import(pathToFileURL("./scripts/install.js").href);

const CASES = [
  ["--no-run"],
  ["--logs", "5"],
  ["--logs", "3", "--log", "mylog"],
  ["--status"],
  ["--kill"],
  ["--selftest"],
  ["--no-run", "--verbose", "--only", "gang"],
  ["--server", "n0006"],
];

let failures = 0;
const results = [];

for (const args of CASES) {
  const ns = makeNs(args, "home", {
    ram: 32,
    money: 1e9,
    bitnode: 10,
    tor: true,
    noPrograms: false,
    bladesSimulacrum: false,
    disable4SData: false,
    sourceFiles: new Map([[2, 1], [3, 1], [4, 4], [6, 1], [8, 1], [9, 1], [10, 1], [13, 1], [14, 1], [15, 1]]),
  });
  const out = [];

  /* Capture the terminal instead of the harness log so we can inspect it. */
  ns.print = (s) => out.push(`  print: ${s}`);
  ns.tprint = (s) => out.push(`  tprint: ${s}`);

  /* wget reads from disk; ps/exec are stubbed so --status and --kill have work. */
  ns.wget = async (url, target) => {
    const file = `scripts/${target}`;
    if (!fs.existsSync(file)) return false;
    ns.write(target, fs.readFileSync(file, "utf8"), "w");
    return true;
  };
  ns.ps = () => [
    { filename: "autobot.ts", pid: 42, bytesUsed: 14.15 },
    { filename: "gang.ts", pid: 43, bytesUsed: 22.4 },
    { filename: "not-part-of-the-suite.js", pid: 44, bytesUsed: 1 },
  ];
  ns.exec = (file, host, threads, ...a) => {
    out.push(`  exec: ${file} on ${host} threads ${threads} args ${a.join(" ") || "(none)"}`);
    return 1;
  };

  /* A log written by a module on a remote server, to test the --logs search. */
  ns.write("autobot_log.txt", "[2026-10-18 12:00:00] home autobot.ts: cycle 1\n", "a");
  ns.write("mylog.txt", "[2026-10-18 12:00:01] home a custom log file\n", "a");

  try {
    await installer.main(ns);
  } catch (err) {
    failures++;
    console.log(`--- install.js ${args.join(" ")}  [FAILED] ${err.message}`);
    continue;
  }

  results.push([args, out]);
  console.log(`--- install.js ${args.join(" ") || "(defaults)"}`);
  for (const line of out) console.log(line);
  console.log();
}

/* autobot.ts must never receive an installer-only flag. */
const INSTALLER_ONLY = ["--no-run", "--open-ports", "--selftest", "--logs", "--kill", "--status", "--ref", "--server"];
for (const [args, out] of results) {
  const execLine = out.find((l) => l.startsWith("  exec:"));
  if (!execLine) continue;
  const passed = execLine.split("args ")[1] ?? "";
  const leaked = INSTALLER_ONLY.filter((f) => passed.includes(f));
  if (leaked.length) {
    failures++;
    console.log(`FAIL: install.js ${args.join(" ")} leaked ${leaked.join(", ")} to autobot.ts`);
  }
}

console.log(failures ? `${failures} case(s) failed` : "all installer cases ran cleanly");
process.exit(failures ? 1 : 0);
