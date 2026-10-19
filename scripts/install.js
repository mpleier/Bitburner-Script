/**
 * install.js
 * ============================================================================
 * One-click installer / updater for the whole Bitburner automation suite.
 *
 * In the game terminal:
 *   nano install.js        -> paste this whole file, then Ctrl+S to save
 *   run install.js         -> downloads everything from GitHub and starts it
 *   run install.js --open-ports
 *   run install.js --only hacking,hacknet
 *
 * Everything else (autobot.ts, core.ts, hacking.ts, ...) is fetched from
 * GitHub, so re-running install.js is also the way to UPDATE the suite.
 *
 * Flags
 *   --open-ports      also open ports + NUKE servers you can root (for hacking)
 *   --no-run          download the files but do not start autobot.ts
 *   --kill            stop every suite script running on every rooted server
 *   --logs [N]        print the last N lines of autobot_log.txt and exit
 *   --selftest        start autobot.ts once in --dry-run mode and show the plan
 *   --only hacking,hacknet   forward to autobot.ts
 *   --skip corporation       forward to autobot.ts
 *   --dry-run                forward to autobot.ts
 *   --interval 5000          forward to autobot.ts
 *   --ref main               branch/tag of the repo to pull from
 *   --server n0006           force which server autobot.ts runs on
 *
 * If this installer itself is out of date (it is the one file the game cannot
 * update by itself), refresh it from the terminal:
 *   wget https://raw.githubusercontent.com/mpleier/Bitburner-Script/main/scripts/install.js install.js
 *
 * RAM cost (GB), from the official RamCostGenerator:
 *   base 1.6 | scan 0.2 | ls 0.2 | getServer 2 | getHostname 0.05
 *   getServerMaxRam 0.05 | getServerUsedRam 0.05 | hasRootAccess 0.05
 *   ps 0.2 | kill 0.5 | scp 0.6 | exec 1.3 | wget 0 | read/write 0
 *   print/tprint/sleep 0
 *   => ~7 GB, so it fits on an 8 GB home server.
 */

const REPO = "mpleier/Bitburner-Script";
const DEFAULT_REF = "main";

/** Every file the suite needs, in download order. */
const FILES = [
  "core.ts", "logger.ts", "types.ts", "contracts.ts", "autobot.ts",
  "hacking.ts", "hacknet.ts", "contractRunner.ts", "factions.ts",
  "jobs.ts", "crime.ts", "gang.ts", "bladeburner.ts",
  "corporation.ts", "stock.ts", "stanek.ts", "sleeves.ts",
  "go.ts", "infiltration.ts", "darknet.ts", "share.ts",
];

/** autobot.ts is allocated 14.15 GB by Bitburner (its own ns calls + core.ts). */
const AUTOBOT_RAM = 15;

export async function main(ns) {
  ns.clearLog();
  ns.disableLog("ALL");

  const args = ns.args.map(String);
  const ref = flag(args, "--ref") ?? DEFAULT_REF;
  const forcedServer = flag(args, "--server");
  const noRun = args.includes("--no-run");
  const base = `https://raw.githubusercontent.com/${REPO}/${ref}/scripts/`;
  const here = ns.getHostname();

  /* 0. Read-only conveniences, so you can inspect the bot without running it. */
  if (args.includes("--logs")) {
    const n = Number(flag(args, "--logs") ?? 40);
    const file = flag(args, "--log") ?? "autobot_log.txt";
    let text = "";
    try {
      text = ns.read(file);
    } catch {
      text = "";
    }
    const lines = text.split("\n").filter((l) => l.trim()).slice(-n);
    ns.tprint(lines.length ? lines.join("\n") : `no ${file} on ${here} yet - run a module first`);
    return;
  }

  if (args.includes("--kill")) {
    const killed = killSuite(ns);
    ns.tprint(`stopped ${killed} suite script process(es) on every rooted server`);
    return;
  }

  /* 1. Download the whole suite onto the server this installer runs on. */
  const downloaded = [];
  for (const file of FILES) {
    const url = base + file;
    if (!(await ns.wget(url, file, here))) {
      ns.tprint(`FAILED to download ${url}`);
      ns.tprint("Check the branch name (--ref) or paste the file manually with nano.");
      return;
    }
    downloaded.push(file);
    ns.print(`downloaded ${file} (${ref})`);
  }

  /* 2. Optional: open ports / NUKE so hacking.ts has something to do. */
  if (args.includes("--open-ports")) openPorts(ns);

  /* 3. Pick the biggest rooted server with enough free RAM for the orchestrator. */
  const target = forcedServer ?? bestHost(ns, here);

  if (target !== here) {
    ns.scp(downloaded, target, here);
    ns.print(`copied ${downloaded.length} files -> ${target}`);
  }

  /* 4. Make sure every file really landed. logger.ts is the one an old
     install.js does not know about, and without it every module fails to load
     ("Cannot find module logger.ts"). */
  const present = new Set(ns.ls(target, ".ts"));
  const missing = downloaded.filter((f) => !present.has(f));
  if (missing.length) {
    ns.tprint(`WARNING: ${missing.join(", ")} is not on ${target}.`);
    ns.tprint(`Fix it from the terminal:`);
    for (const f of missing) {
      ns.tprint(`  wget https://raw.githubusercontent.com/${REPO}/${ref}/scripts/${f} ${f}`);
    }
  }

  if (noRun) {
    ns.tprint(
      `Installed ${downloaded.length} files on ${target}. ` +
        `Start the suite with: run autobot.ts`,
    );
    return;
  }

  const free = ns.getServerMaxRam(target) - ns.getServerUsedRam(target);
  if (free < AUTOBOT_RAM) {
    ns.tprint(
      `autobot.ts needs ${AUTOBOT_RAM} GB of free RAM, but ${target} has ` +
        `${ns.getServerMaxRam(target)} GB total and only ${free} GB free.`,
    );
    ns.tprint("Root a bigger server, kill what is running on this one, or upgrade home RAM.");
    ns.tprint("Meanwhile you can run the small modules directly:");
    ns.tprint("  run hacknet.ts");
    ns.tprint("  run share.ts");
    return;
  }

  /* 5. Start the orchestrator, forwarding every flag autobot understands.
     `--selftest` runs it for a single dry-run loop so you can see the plan
     before the suite actually does anything. */
  const autobotArgs = args.includes("--selftest")
    ? ["--dry-run", "--loops", "1", "--verbose", ...forwarded(args)]
    : forwarded(args);
  const pid = ns.exec("autobot.ts", target, 1, ...autobotArgs);

  if (pid === 0) {
    // ns.exec() returns 0 rather than throwing; say which of the three causes it is.
    ns.tprint(`Could not start autobot.ts on ${target}.`);
    if (!ns.hasRootAccess(target)) ns.tprint(`  - no root access on ${target}`);
    if (!present.has("autobot.ts")) ns.tprint(`  - autobot.ts is not on ${target}`);
    if (free < AUTOBOT_RAM) ns.tprint(`  - ${target} has only ${free} GB free (needs ${AUTOBOT_RAM} GB)`);
    ns.tprint("Start it by hand: run autobot.ts");
  } else {
    ns.tprint(
      `Started autobot.ts on ${target} (pid ${pid}) ` +
        `args: ${autobotArgs.length ? autobotArgs.join(" ") : "(defaults)"}`,
    );
    ns.tprint("Read the log with: cat autobot_log.txt  (or run install.js --logs 30)");
  }
}

/** Open ports and NUKE every server we can already root. */
function openPorts(ns) {
  const openers = [
    ["BruteSSH.exe", ns.brutessh],
    ["FTPCrack.exe", ns.ftpcrack],
    ["relaySMTP.exe", ns.relaysmtp],
    ["HTTPWorm.exe", ns.httpworm],
    ["SQLInject.exe", ns.sqlinject],
  ].filter(([prog]) => ns.fileExists(prog));

  const seen = new Set();
  const queue = [ns.getHostname()];
  while (queue.length > 0) {
    const host = queue.shift();
    if (seen.has(host)) continue;
    seen.add(host);
    for (const next of ns.scan(host)) if (!seen.has(next)) queue.push(next);
  }

  for (const host of seen) {
    if (ns.hasRootAccess(host)) continue;

    for (const [, open] of openers) open(host);

    const needed = ns.getServerNumPortsRequired(host);
    if (openers.length >= needed && ns.fileExists("NUKE.exe")) {
      ns.nuke(host);
      ns.print(`rooted ${host} (${ns.getServerMaxRam(host)} GB, ${openers.length}/${needed} ports)`);
    }
  }
}

/** BFS over ns.scan(); returns the rooted server with the most FREE RAM. */
function bestHost(ns, fallback) {
  const seen = new Set();
  const queue = ["home"];
  let best = null;
  let bestFree = 0;

  while (queue.length > 0) {
    const host = queue.shift();
    if (seen.has(host)) continue;
    seen.add(host);
    for (const next of ns.scan(host)) {
      if (!seen.has(next)) queue.push(next);
    }
  }

  for (const host of seen) {
    // getServer() throws for a host that is no longer on the network, and hacknet
    // nodes are not Server objects - neither is a usable script host.
    let server = null;
    try {
      server = ns.getServer(host);
    } catch {
      continue;
    }
    if (!server) continue;
    if (!server.hasAdminRights) continue;

    // Free RAM, not total RAM: scripts already running there have to fit too.
    const free = server.maxRam - (server.usedRam ?? 0);
    if (free >= AUTOBOT_RAM && free > bestFree) {
      best = host;
      bestFree = free;
    }
  }

  return best ?? fallback;
}

/** Kill every script of the suite that is running on a rooted server. */
function killSuite(ns) {
  const seen = new Set();
  const queue = [ns.getHostname()];
  while (queue.length > 0) {
    const host = queue.shift();
    if (seen.has(host)) continue;
    seen.add(host);
    for (const next of ns.scan(host)) if (!seen.has(next)) queue.push(next);
  }

  let killed = 0;
  for (const host of seen) {
    let procs = [];
    try {
      procs = ns.ps(host);
    } catch {
      continue;
    }
    for (const p of procs) {
      if (!FILES.includes(p.filename)) continue;
      try {
        if (ns.kill(p.pid, host)) killed += 1;
      } catch {
        /* the process is already gone */
      }
    }
  }
  return killed;
}

/** Strip installer-only flags, keep everything autobot.ts understands. */
function forwarded(args) {
  const out = [];
  for (let i = 0; i < args.length; ++i) {
    const a = args[i];
    if (a === "--ref" || a === "--server") {
      i += 1; // skip its value
      continue;
    }
    if (a === "--no-run" || a === "--open-ports" || a === "--selftest") continue;
    if (a === "--logs" || a === "--kill") continue; // installer-only conveniences
    out.push(a);
  }
  return out;
}

/** `--name value` -> value, or undefined when the flag is absent. */
function flag(args, name) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}