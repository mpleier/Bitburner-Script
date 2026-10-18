/**
 * install.js
 * ============================================================================
 * One-click installer / updater for the Bitburner contract automation.
 *
 * In the game terminal:
 *   nano install.js        -> paste this whole file, then Ctrl+S to save
 *   run install.js         -> downloads everything from GitHub and starts it
 *   run install.js --open-ports --loop
 *
 * Everything else (contractRunner.ts, contracts.ts) is fetched from GitHub, so
 * re-running install.js is also the way to UPDATE the scripts.
 *
 * Flags
 *   --open-ports      also open ports + NUKE servers you can root (for hacking)
 *   --dry-run         print the answers, submit nothing
 *   --loop            keep rescanning the network
 *   --interval 30000  delay between rounds when --loop is used
 *   --max 50          stop after N contracts
 *   --host CSEC       only look at one server
 *   --selftest        verify the solvers and exit
 *   --no-run          download the files but do not start the runner
 *   --ref main        branch/tag of the repo to pull from
 *   --server n0006    force which server the runner is installed on
 *
 * RAM cost (GB), from the official RamCostGenerator:
 *   base 1.6 | scan 0.2 | ls 0.2 | getServer 2 | getHostname 0.05
 *   getServerMaxRam 0.05 | scp 0.6 | exec 1.3 | wget 0 | print/tprint/sleep 0
 *   => ~4.4 GB, so it fits on an 8 GB home server.
 */

const REPO = "mpleier/Bitburner-Script";
const DEFAULT_REF = "main";
const FILES = ["contractRunner.ts", "contracts.ts"];

/** contractRunner.ts needs this much RAM to run (see its header comment). */
const RAM_NEEDED = 28;

export async function main(ns) {
  ns.clearLog();
  ns.disableLog("ALL");

  const args = ns.args.map(String);
  const ref = flag(args, "--ref") ?? DEFAULT_REF;
  const forcedServer = flag(args, "--server");
  const noRun = args.includes("--no-run");
  const base = `https://raw.githubusercontent.com/${REPO}/${ref}/scripts/`;
  const here = ns.getHostname();

  // 1. Download the scripts onto the server this installer is running on.
  for (const file of FILES) {
    const url = base + file;
    if (!(await ns.wget(url, file, here))) {
      ns.tprint(`FAILED to download ${url}`);
      ns.tprint("Check the branch name (--ref) or paste the file manually with nano.");
      return;
    }
    ns.print(`downloaded ${file} (${ref})`);
  }

  // 2. Pick the biggest server you already have root on that can hold the runner.
  const target = forcedServer ?? bestHost(ns, here);

  if (target !== here) {
    ns.scp(FILES, target, here);
    ns.print(`copied ${FILES.join(", ")} -> ${target}`);
  }

  if (noRun) {
    ns.tprint(`Installed ${FILES.join(", ")} on ${target}. Start it with: run contractRunner.ts`);
    return;
  }

  if (ns.getServerMaxRam(target) < RAM_NEEDED) {
    ns.tprint(
      `contractRunner.ts needs ${RAM_NEEDED} GB of RAM, but the biggest rooted ` +
        `server is ${target} (${ns.getServerMaxRam(target)} GB).`,
    );
    ns.tprint("Root a bigger server, then run install.js again.");
    return;
  }

  // 3. Start the runner, forwarding every flag contractRunner understands.
  const runnerArgs = forwarded(args);
  const pid = ns.exec("contractRunner.ts", target, 1, ...runnerArgs);

  if (pid === 0) {
    ns.tprint(`Could not start contractRunner.ts on ${target} (root access required there).`);
  } else {
    ns.tprint(
      `Started contractRunner.ts on ${target} (pid ${pid}) ` +
        `args: ${runnerArgs.length ? runnerArgs.join(" ") : "(defaults)"}`,
    );
  }
}

/** BFS over ns.scan(); returns the biggest rooted server with >= RAM_NEEDED GB. */
function bestHost(ns, fallback) {
  const seen = new Set();
  const queue = ["home"];
  let best = null;
  let bestRam = 0;

  while (queue.length > 0) {
    const host = queue.shift();
    if (seen.has(host)) continue;
    seen.add(host);
    for (const next of ns.scan(host)) {
      if (!seen.has(next)) queue.push(next);
    }
  }

  for (const host of seen) {
    const server = ns.getServer(host);
    if (server.hasAdminRights && server.maxRam >= RAM_NEEDED && server.maxRam > bestRam) {
      best = host;
      bestRam = server.maxRam;
    }
  }

  return best ?? fallback;
}

/** Strip installer-only flags, keep everything contractRunner.ts understands. */
function forwarded(args) {
  const out = [];
  for (let i = 0; i < args.length; ++i) {
    const a = args[i];
    if (a === "--ref" || a === "--server") {
      i += 1; // skip its value
      continue;
    }
    if (a === "--no-run" || a === "--install") continue;
    out.push(a);
  }
  return out;
}

/** `--name value` -> value, or undefined when the flag is absent. */
function flag(args, name) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}