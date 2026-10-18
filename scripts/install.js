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
 *   --only hacking,hacknet   forward to autobot.ts
 *   --skip corporation       forward to autobot.ts
 *   --dry-run                forward to autobot.ts
 *   --interval 5000          forward to autobot.ts
 *   --ref main               branch/tag of the repo to pull from
 *   --server n0006           force which server autobot.ts runs on
 *
 * RAM cost (GB), from the official RamCostGenerator:
 *   base 1.6 | scan 0.2 | ls 0.2 | getServer 2 | getHostname 0.05
 *   getServerMaxRam 0.05 | scp 0.6 | exec 1.3 | wget 0 | print/tprint/sleep 0
 *   => ~4.4 GB, so it fits on an 8 GB home server.
 */

const REPO = "mpleier/Bitburner-Script";
const DEFAULT_REF = "main";

/** Every file the suite needs, in download order. */
const FILES = [
  "core.ts", "types.ts", "contracts.ts", "autobot.ts",
  "hacking.ts", "hacknet.ts", "contractRunner.ts", "factions.ts",
  "jobs.ts", "crime.ts", "gang.ts", "bladeburner.ts",
  "corporation.ts", "stock.ts", "stanek.ts", "sleeves.ts",
  "go.ts", "infiltration.ts", "darknet.ts", "share.ts",
];

/** autobot.ts needs this much RAM just to plan (see its header comment). */
const RAM_NEEDED = 12;

export async function main(ns) {
  ns.clearLog();
  ns.disableLog("ALL");

  const args = ns.args.map(String);
  const ref = flag(args, "--ref") ?? DEFAULT_REF;
  const forcedServer = flag(args, "--server");
  const noRun = args.includes("--no-run");
  const base = `https://raw.githubusercontent.com/${REPO}/${ref}/scripts/`;
  const here = ns.getHostname();

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

  /* 3. Pick the biggest rooted server that can hold the orchestrator. */
  const target = forcedServer ?? bestHost(ns, here);

  if (target !== here) {
    ns.scp(downloaded, target, here);
    ns.print(`copied ${downloaded.length} files -> ${target}`);
  }

  if (noRun) {
    ns.tprint(
      `Installed ${downloaded.length} files on ${target}. ` +
        `Start the suite with: run autobot.ts`,
    );
    return;
  }

  if (ns.getServerMaxRam(target) < RAM_NEEDED) {
    ns.tprint(
      `autobot.ts needs ~${RAM_NEEDED} GB of RAM, but the biggest rooted ` +
        `server is ${target} (${ns.getServerMaxRam(target)} GB).`,
    );
    ns.tprint("Root a bigger server, then run install.js again.");
    ns.tprint("Meanwhile you can run the small modules directly:");
    ns.tprint("  run hacknet.ts");
    ns.tprint("  run share.ts");
    return;
  }

  /* 4. Start the orchestrator, forwarding every flag autobot understands. */
  const autobotArgs = forwarded(args);
  const pid = ns.exec("autobot.ts", target, 1, ...autobotArgs);

  if (pid === 0) {
    ns.tprint(`Could not start autobot.ts on ${target} (root access required there).`);
  } else {
    ns.tprint(
      `Started autobot.ts on ${target} (pid ${pid}) ` +
        `args: ${autobotArgs.length ? autobotArgs.join(" ") : "(defaults)"}`,
    );
    ns.tprint("Watch it with: tail autobot.ts");
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
    // getServer() throws for a host that is no longer on the network, and hacknet
    // nodes are not Server objects - neither is a usable script host.
    let server = null;
    try {
      server = ns.getServer(host);
    } catch {
      continue;
    }
    if (!server) continue;
    if (server.hasAdminRights && server.maxRam >= RAM_NEEDED && server.maxRam > bestRam) {
      best = host;
      bestRam = server.maxRam;
    }
  }

  return best ?? fallback;
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
    out.push(a);
  }
  return out;
}

/** `--name value` -> value, or undefined when the flag is absent. */
function flag(args, name) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}