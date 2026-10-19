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
 *   --open-ports             also open ports + NUKE servers you can root (for hacking)
 *   --no-run                 download the files but do not start autobot.ts
 *   --kill                   stop every suite script running on every rooted server
 *   --logs [N]               print the last N lines of the log and exit. Every server
 *                            keeps its own log file, so this searches every rooted
 *                            server and says which one it found the log on.
 *   --status                 list which suite scripts are running, on which server,
 *                            how much RAM each one costs, and where the log lives
 *   --selftest               start autobot.ts once in --dry-run mode and show the plan
 *   --only hacking,hacknet   forward to autobot.ts
 *   --skip corporation       forward to autobot.ts
 *   --dry-run                forward to autobot.ts
 *   --interval 5000          forward to autobot.ts
 *   --loops 3                forward to autobot.ts
 *   --log mylog              log file name (logger.ts adds ".txt" if you leave it off)
 *   --verbose                per-action detail instead of one summary line per cycle
 *   --no-log                 print to the terminal instead of writing a log file
 *   --ref main               branch/tag of the repo to pull from
 *   --server n0006           force which server autobot.ts runs on
 *   --no-update              do not refresh install.js itself (see below)
 *
 * install.js updates ITSELF. It is the one file the game cannot refresh by itself
 * (it is the bootstrap you pasted with nano), so every run it downloads its own
 * newest version from GitHub and, if the file changed, hands the job over to the
 * fresh copy. One paste is all you ever need.
 *
 * If the download fails (no internet, GitHub blocked, --no-update) the installer
 * simply carries on with the copy already on the server. To refresh it by hand:
 *   wget https://raw.githubusercontent.com/mpleier/Bitburner-Script/main/scripts/install.js install.js
 *
 * RAM cost (GB), from the official RamCostGenerator:
 *   base 1.6 | scan 0.2 | ls 0.2 | getServer 2 | getHostname 0.05
 *   getServerMaxRam 0.05 | getServerUsedRam 0.05 | hasRootAccess 0.05
 *   ps 0.2 | kill 0.5 | scp 0.6 | exec 1.3 | wget 0 | read/write 0
 *   print/tprint/sleep 0
 *   => ~7 GB, so it fits on an 8 GB home server.
 *   --logs and --status are read-only: they add only read (0 GB) and ps (0.2 GB),
 *   so they are safe to run at any point in a save.
 *   The self-update costs nothing extra (wget 0 GB, read 0 GB), but the fresh
 *   copy needs ~7 GB of free RAM, so it is started on the biggest rooted server
 *   that has room - and if none does, the update is simply saved to disk for the
 *   next run.
 */

const REPO = "mpleier/Bitburner-Script";
const DEFAULT_REF = "main";

/** install.js's own filename and RAM cost, used by the self-update step. */
const SELF = "install.js";
const SELF_RAM = 7;

/** Every file the suite needs, in download order. */
const FILES = [
  "core.ts", "logger.ts", "types.ts", "contracts.ts", "autobot.ts",
  "hacking.ts", "hacknet.ts", "contractRunner.ts", "factions.ts",
  "jobs.ts", "crime.ts", "gang.ts", "bladeburner.ts",
  "corporation.ts", "stock.ts", "stanek.ts", "sleeves.ts",
  "go.ts", "infiltration.ts", "darknet.ts", "share.ts",
  "casino.ts", "casino-policy.ts",
];

/** autobot.ts is allocated 15.15 GB by Bitburner (its own ns calls + core.ts). */
const AUTOBOT_RAM = 16;

export async function main(ns) {
  ns.clearLog();
  ns.disableLog("ALL");

  const args = ns.args.map(String);
  const ref = flag(args, "--ref") ?? DEFAULT_REF;
  const forcedServer = flag(args, "--server");
  const noRun = args.includes("--no-run");
  const base = `https://raw.githubusercontent.com/${REPO}/${ref}/scripts/`;
  const here = ns.getHostname();

  /* 0. install.js is the bootstrap you pasted by hand, so it is the one file the
     game cannot refresh by itself. Download the newest copy and, if it changed,
     hand the rest of this run to the fresh version. */
  if (!args.includes("--no-update") && !args.includes("--updated")) {
    if (await refreshSelf(ns, base, here, args)) return;
  }

  /* 1. Read-only conveniences, so you can inspect the bot without running it. */
  if (args.includes("--logs")) {
    const n = Number(flag(args, "--logs") ?? 40);
    const found = findLog(ns, logNames(flag(args, "--log")));
    if (!found) {
      ns.tprint("no log file on any rooted server - start a module first: run autobot.ts");
      return;
    }
    const lines = found.text.split("\n").filter((l) => l.trim()).slice(-n);
    ns.tprint(
      `${found.name} on ${found.host}: ${found.text.length} chars, showing the last ${lines.length}` +
        (found.copied ? ` (copied to ${here} to read it)` : ""),
    );
    ns.tprint(lines.join("\n"));
    return;
  }

  if (args.includes("--status")) {
    const rows = [];
    for (const host of reachable(ns)) {
      if (!ns.hasRootAccess(host)) continue;

      let procs = [];
      try {
        procs = ns.ps(host);
      } catch {
        continue;
      }

      const suite = procs.filter((p) => FILES.includes(p.filename));
      if (!suite.length) continue;

      const detail = suite
        .map((p) => `${p.filename}${p.bytesUsed != null ? ` (${p.bytesUsed.toFixed(2)} GB, pid ${p.pid})` : ` (pid ${p.pid})`}`)
        .join(", ");
      rows.push(`${host}: ${detail} | RAM ${ns.getServerUsedRam(host).toFixed(2)}/${ns.getServerMaxRam(host)} GB`);
    }

    if (!rows.length) {
      ns.tprint("No suite script is running on any rooted server. Start one: run autobot.ts");
      return;
    }

    ns.tprint(rows.join("\n"));
    const found = findLog(ns, logNames(flag(args, "--log")));
    ns.tprint(found
      ? `log: ${found.name} on ${found.host} (${found.text.length} chars) - read it with: run install.js --logs 30`
      : "no log file written yet");
    return;
  }

  if (args.includes("--kill")) {
    const killed = killSuite(ns);
    ns.tprint(`stopped ${killed} suite script process(es) on every rooted server`);
    return;
  }

  /* 2. Download the whole suite onto the server this installer runs on. */
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

  /* 3. Optional: open ports / NUKE so hacking.ts has something to do. */
  if (args.includes("--open-ports")) openPorts(ns);

  /* 4. Pick the biggest rooted server with enough free RAM for the orchestrator. */
  const target = forcedServer ?? bestHost(ns, here);

  if (target !== here) {
    ns.scp(downloaded, target, here);
    ns.print(`copied ${downloaded.length} files -> ${target}`);
  }

  /* 5. Make sure every file really landed. logger.ts is the one an old
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

  /* 6. Start the orchestrator, forwarding every flag autobot understands.
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
    ns.tprint("gang/corporation/casino print one summary line per cycle - add --verbose for every action.");
  }
}

/**
 * install.js is the bootstrap you paste with nano, so it is the one file the game
 * cannot refresh by itself. Download the newest copy; if it differs from the one
 * running, start the fresh copy (marked --updated so it does not do this again)
 * and let it finish the job.
 *
 * Returns true when a new instance of install.js took over, in which case the
 * caller must stop - the work is already being done by the fresh copy.
 */
async function refreshSelf(ns, base, here, args) {
  let before = "";
  try {
    before = ns.read(SELF);
  } catch {
    ns.print("could not read install.js - skipping the self-update");
    return false;
  }

  if (!(await ns.wget(base + SELF, SELF, here))) {
    ns.print("could not download the latest install.js - using the copy already on this server");
    return false;
  }

  const after = ns.read(SELF);
  if (after === before) {
    ns.print(`install.js is already up to date (${after.length} chars)`);
    return false;
  }

  ns.tprint(`install.js updated itself: ${before.length} -> ${after.length} chars`);

  // The instance running right now is already loaded in memory and still holds
  // its ~7 GB, so the fresh copy has to start where there is room for it.
  const host = bestHost(ns, here, SELF_RAM);
  if (host !== here && !ns.scp(SELF, host, here)) {
    ns.tprint(`Could not copy install.js to ${host}. Run install.js again to use the new version.`);
    return false;
  }

  const pid = ns.exec(SELF, host, 1, ...args, "--updated");
  if (pid === 0) {
    ns.tprint(
      `The updated install.js could not start on ${host} (needs ${SELF_RAM} GB free). ` +
        "The new version is saved on disk - run install.js again to use it.",
    );
    return false;
  }

  ns.tprint(`Continuing with the updated install.js on ${host} (pid ${pid})`);
  return true;
}

/** Every server reachable from `from` by ns.scan(), as a Set. */
function reachable(ns, from) {
  const seen = new Set();
  const queue = [from ?? ns.getHostname()];
  while (queue.length > 0) {
    const host = queue.shift();
    if (seen.has(host)) continue;
    seen.add(host);
    for (const next of ns.scan(host)) if (!seen.has(next)) queue.push(next);
  }
  return seen;
}

/** logger.ts appends ".txt" to a name without a valid extension, so try both. */
function logNames(value) {
  const name = value ?? "autobot_log.txt";
  return /\.(txt|json|css)$/i.test(name) ? [name] : [`${name}.txt`, name];
}

/**
 * Each server keeps its own log file, so search every rooted server for it.
 * ns.read() only sees files on the server this script is running on, so a log
 * living on another server is copied over with scp() before reading it.
 */
function findLog(ns, names) {
  const here = ns.getHostname();

  for (const host of reachable(ns)) {
    if (!ns.hasRootAccess(host)) continue;

    for (const name of names) {
      let text = "";
      try {
        if (host !== here) {
          // scp() keeps the original filename, so only copy when this server has
          // no log of that name - never overwrite a log the player is reading.
          if (ns.read(name)) continue;
          if (!ns.scp(name, here, host)) continue;
        }
        text = ns.read(name);
      } catch {
        continue;
      }
      if (text && text.trim()) return { host, name, text, copied: host !== here };
    }
  }

  return null;
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

  for (const host of reachable(ns)) {
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
function bestHost(ns, fallback, ram = AUTOBOT_RAM) {
  let best = null;
  let bestFree = 0;

  for (const host of reachable(ns, "home")) {
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
    if (free >= ram && free > bestFree) {
      best = host;
      bestFree = free;
    }
  }

  return best ?? fallback;
}

/** Kill every script of the suite that is running on a rooted server. */
function killSuite(ns) {
  let killed = 0;
  for (const host of reachable(ns)) {
    let procs = [];
    try {
      procs = ns.ps(host);
    } catch {
      continue;
    }
    for (const p of procs) {
      if (!FILES.includes(p.filename)) continue;
      try {
        // PIDs are unique across every server, so ns.kill(pid) needs no host.
        if (ns.kill(p.pid)) killed += 1;
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
    // installer-only conveniences: autobot.ts has its own --logs/--kill/--status,
    // and running both would just print the same thing twice.
    if (a === "--logs" || a === "--kill" || a === "--status") continue;
    // self-update bookkeeping - autobot.ts would choke on these.
    if (a === "--no-update" || a === "--updated") continue;
    out.push(a);
  }
  return out;
}

/** `--name value` -> value, or undefined when the flag is absent. */
function flag(args, name) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}