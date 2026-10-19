/**
 * installcheck.mjs - run scripts/install.js against the mock ns API.
 *
 *   node installcheck.mjs
 *
 * ns.wget() is stubbed to read the file straight off disk instead of GitHub, so
 * the download -> verify -> exec path is exercised end to end. Every installer
 * flag is run once and its terminal output is printed.
 *
 * Two cases start with a stale install.js on the server, which is how the
 * self-update is checked: it must download itself, notice the change, and hand
 * the run over to the fresh copy (with --updated, so it does not loop).
 */
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { makeNs } from "./mocksuite.mjs";

const installer = await import(pathToFileURL("./scripts/install.js").href);

const CASES = [
  { args: ["--no-run"] },
  { args: ["--logs", "5"] },
  { args: ["--logs", "3", "--log", "mylog"] },
  { args: ["--status"] },
  { args: ["--kill"] },
  { args: ["--selftest"] },
  { args: ["--no-run", "--verbose", "--only", "gang"] },
  { args: ["--server", "n0006"] },
  { args: ["--no-update", "--no-run"] },
  { args: ["--updated", "--no-run"] },
  // install.js started out stale: it must download itself and hand over to the
  // fresh copy instead of installing with the old code.
  { args: ["--no-run"], staleInstall: true },
  { args: ["--logs", "4"], staleInstall: true },
];

let failures = 0;
const results = [];

for (const entry of CASES) {
  const args = entry.args;
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

  /* The server already has install.js: the current version, or an old one for
     the stale cases. */
  ns.write(
    "install.js",
    entry.staleInstall ? "// an old install.js\n" : fs.readFileSync("scripts/install.js", "utf8"),
    "w",
  );

  try {
    await installer.main(ns);
  } catch (err) {
    failures++;
    console.log(`--- install.js ${args.join(" ")}  [FAILED] ${err.message}`);
    continue;
  }

  results.push([args, out, ns, Boolean(entry.staleInstall)]);
  console.log(`--- install.js ${args.join(" ") || "(defaults)"}`);
  for (const line of out) console.log(line);
  console.log();
}

/* --- the self-update contract --- */
for (const [args, out, ns, stale] of results) {
  const selfExec = out.find((l) => l.startsWith("  exec: install.js"));
  const saidUpdated = out.some((l) => l.includes("install.js updated itself"));
  const saidCurrent = out.some((l) => l.includes("already up to date"));
  const skipped = args.includes("--no-update") || args.includes("--updated");

  if (skipped && (selfExec || saidUpdated)) {
    failures++;
    console.log(`FAIL: install.js ${args.join(" ")} self-updated despite --no-update/--updated`);
  }
  if (!skipped && !saidCurrent && !saidUpdated && !selfExec) {
    failures++;
    console.log(`FAIL: install.js ${args.join(" ")} never touched its own file`);
  }
  if (!skipped && !stale && !saidCurrent) {
    failures++;
    console.log(`FAIL: install.js ${args.join(" ")} did not report itself as current`);
  }
  if (!skipped && !stale && selfExec) {
    failures++;
    console.log(`FAIL: install.js ${args.join(" ")} re-ran itself although nothing changed`);
  }
  if (stale && !saidUpdated) {
    failures++;
    console.log(`FAIL: install.js ${args.join(" ")} did not notice the stale copy`);
  }
  if (stale && !selfExec) {
    failures++;
    console.log(`FAIL: install.js ${args.join(" ")} updated itself but did not re-run the fresh copy`);
  }
  if (stale && !ns.read("install.js").startsWith("/**")) {
    failures++;
    console.log(`FAIL: install.js ${args.join(" ")} left the stale file on disk`);
  }
}

/* autobot.ts must never receive an installer-only flag. */
const INSTALLER_ONLY = [
  "--no-run", "--open-ports", "--selftest", "--logs", "--kill", "--status",
  "--ref", "--server", "--no-update", "--updated",
];
for (const [args, out] of results) {
  const execLine = out.find((l) => l.startsWith("  exec: autobot.ts"));
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
