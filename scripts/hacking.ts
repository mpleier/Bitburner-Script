/**
 * hacking.ts
 * ============================================================================
 * Automates the whole hacking pipeline:
 *   1. Make sure every port-opening program exists (create or buy on darkweb).
 *   2. Root every server you can.
 *   3. Install backdoors.
 *   4. Run the optimal weaken -> grow -> hack cycle on the richest server.
 *   5. Upgrade home RAM / cores when it pays back.
 *
 * RAM cost (GB), from the official RamCostGenerator:
 *   base 1.6 | scan 0.2 | ls 0.2 | getPlayer 0.5 | getHostname 0.05
 *   hasRootAccess 0.05 | getServerMaxRam 0.05 | getServerUsedRam 0.05
 *   getServerRequiredHackingLevel 0.1 | getServerNumPortsRequired 0.1
 *   getServerMaxMoney 0.1 | getServerMoneyAvailable 0.1 | getServerGrowth 0.1
 *   getServerSecurityLevel 0.1 | getServerMinSecurityLevel 0.1
 *   getHackingLevel 0.05 | getHackTime 0.05 | getGrowTime 0.05 | getWeakenTime 0.05
 *   hack 0.1 | grow 0.15 | weaken 0.15
 *   hackAnalyze 1 | growthAnalyze 1 | weakenAnalyze 1
 *   nuke + 5 port openers 0.05 each | installBackdoor 2 | connect 2 | getServer 0.1
 *   upgradeHomeRam 3 | upgradeHomeCores 3 | getUpgradeHomeRamCost 1.5 | getUpgradeHomeCoresCost 1.5
 *   createProgram 5 | purchaseProgram 2 | purchaseTor 2
 *   getDarkwebPrograms 0.5 | getDarkwebProgramCost 0.5
 *   => ~45 GB (39 GB of hacking calls + 6.5 GB of core.ts helpers). Run it on a
 *      server with at least 45 GB.
 *
 * Usage
 *   run hacking.ts
 *   run hacking.ts --interval 5000 --dry-run
 *   run hacking.ts --no-backdoor          ; skip the backdoor step entirely
 *   run hacking.ts --backdoor-daemon      ; allow backdooring the World Daemon (ends the bitnode)
 */

// Bitburner injects its API typings as a global declaration file, so `NS`
// needs no import (globals.d.ts mirrors that for local `tsc` checks).

// core.ts is imported statically on purpose. Bitburner's RAM allocation is
// computed from the AST of the script and everything it *statically* imports;
// ns.dynamicImport() is invisible to that pass, so the API calls core.ts makes
// would not be paid for and the game would abort the script with a RAM error.
import * as core from "./core.ts";

const RAM_NEEDED = 45;

export async function main(ns: NS): Promise<void> {
  ns.clearLog();
  ns.disableLog("ALL");

  const args = ns.args.map(String);
  const dryRun = args.includes("--dry-run");
  const interval = Number(flagOr(args, "--interval", 1000));
  const noBackdoor = args.includes("--no-backdoor");
  const backdoorDaemon = args.includes("--backdoor-daemon");

  const loops = core.maxLoops(args);

  const host = ns.getHostname();
  if (ns.getServerMaxRam(host) < RAM_NEEDED) {
    ns.tprint(`hacking.ts needs ${RAM_NEEDED} GB; ${host} has ${ns.getServerMaxRam(host)} GB.`);
    return;
  }

  ns.print("=== hacking module ===");

  for (let loop = 0; loop < loops; ++loop) {
    ensurePrograms(ns, core, dryRun);
    const rooted = rootNetwork(ns, core, dryRun);
    if (!noBackdoor) await installBackdoors(ns, core, dryRun, backdoorDaemon);
    upgradeHome(ns, dryRun);

    const target = pickTarget(ns, rooted);
    if (target) await cycle(ns, target, core, dryRun);
    else ns.print("No hackable server yet - grinding hacking level.");

    await ns.sleep(interval);
  }
}

function flagOr(args: string[], name: string, fallback: number): number {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? Number(args[i + 1]) : fallback;
}

/** Create or darkweb-buy every program we are missing. */
function ensurePrograms(ns: NS, core: any, dryRun: boolean): void {
  const owned = core.ownedPrograms(ns);
  const missing = core.PROGRAMS.filter((p: string) => !owned.has(p));
  if (missing.length === 0) return;

  const level = ns.getHackingLevel();
  const cash = ns.getPlayer().money;

  for (const program of missing) {
    if (dryRun) {
      ns.print(`[dry-run] would obtain ${program}`);
      continue;
    }

    const reqLevel = ns.singularity.getHackingLevelRequirementOfProgram(program);
    if (reqLevel <= level && ns.singularity.createProgram(program)) {
      ns.print(`created ${program}`);
      continue;
    }

    if (!owned.has("DeepscanV1.exe") && !ns.singularity.purchaseTor()) {
      ns.print("could not purchase TOR (needs 100k)");
      return;
    }

    const cost = ns.singularity.getDarkwebProgramCost(program);
    if (cost > 0 && cash >= cost * 1.2) {
      if (ns.singularity.purchaseProgram(program)) ns.print(`bought ${program} for ${core.fmt(cost)}`);
    }
  }
}

/** Root every server we can; returns the rooted list. */
function rootNetwork(ns: NS, core: any, dryRun: boolean): string[] {
  const candidates = core.rootableServers(ns);
  const rooted = core.rootedServers(ns);

  for (const host of candidates) {
    if (dryRun) {
      ns.print(`[dry-run] could root ${host} (${ns.getServerNumPortsRequired(host)} ports)`);
      continue;
    }
    if (core.rootServer(ns, host)) {
      rooted.push(host);
      ns.print(`rooted ${host}`);
    }
  }
  return rooted;
}

/**
 * Servers that must never be backdoored by this script.
 *
 * ns.singularity.installBackdoor() takes NO hostname: it always backdoors the
 * server the player is *currently connected to* (Player.getCurrentServer()).
 * Two traps follow from that:
 *   1. connect() can fail, leaving us on our own machine, and the game then
 *      throws "Cannot backdoor <host> server because it is your server"
 *      (src/Hacking/netscriptCanHack.ts -> baseCheck -> server.purchasedByPlayer).
 *   2. core.rootedServers() includes every server we own (home, cloud servers,
 *      hacknet nodes). All of them are purchasedByPlayer and can never be
 *      backdoored, so they have to be filtered out before we try.
 */
function backdoorBlocker(ns: NS, host: string, allowDaemon: boolean): string | null {
  const server = ns.getServer(host);
  if (!server) return "not reachable from our network";
  if (host === "home") return "home is your own computer";
  if (host === "darkweb") return "the darkweb cannot be backdoored";
  if (host === "daemon" && !allowDaemon) {
    return "World Daemon: backdooring it ends the bitnode (pass --backdoor-daemon to allow it)";
  }
  if (server.purchasedByPlayer) return "it is your own server, backdoor is impossible";
  if (server.backdoorInstalled) return "backdoor already installed";
  if (!ns.hasRootAccess(host)) return "no root access";
  if (ns.getServerRequiredHackingLevel(host) > ns.getHackingLevel()) return "hacking level too low";
  return null;
}

/**
 * Connect to `host`. If it is not adjacent to where we are standing, hop through
 * home (always connectable) or through a server that already has a backdoor -
 * backdoored servers are reachable from anywhere in the network.
 */
function connectTo(ns: NS, host: string): boolean {
  if (ns.singularity.connect(host)) return true;
  for (const hop of ns.scan(host)) {
    if (hop === "home" || ns.getServer(hop).backdoorInstalled) {
      if (ns.singularity.connect(hop) && ns.singularity.connect(host)) return true;
    }
  }
  return false;
}

/** Install backdoors on every rooted foreign server we can actually reach. */
async function installBackdoors(ns: NS, core: any, dryRun: boolean, allowDaemon: boolean): Promise<void> {
  for (const host of core.rootedServers(ns)) {
    const blocker = backdoorBlocker(ns, host, allowDaemon);
    if (blocker) {
      // "already installed" is the boring case, do not spam the log with it.
      if (blocker !== "backdoor already installed") ns.print(`skipping backdoor on ${host}: ${blocker}`);
      continue;
    }

    if (dryRun) {
      ns.print(`[dry-run] would install a backdoor on ${host}`);
      continue;
    }

    // installBackdoor() has no target argument: it acts on the server we are
    // connected to, so connect() must succeed before we call it.
    if (!connectTo(ns, host)) {
      ns.print(`skipping backdoor on ${host}: not reachable from our network position`);
      continue;
    }

    try {
      await ns.singularity.installBackdoor();
      ns.print(`backdoor installed on ${host}`);
    } catch (err) {
      ns.print(`backdoor on ${host} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/** Buy home RAM/cores when the cost is a small fraction of our money. */
function upgradeHome(ns: NS, dryRun: boolean): void {
  const cash = ns.getPlayer().money;

  const ramCost = ns.singularity.getUpgradeHomeRamCost();
  if (ramCost > 0 && cash > ramCost * 4) {
    if (dryRun) ns.print(`[dry-run] would upgrade home RAM for ${core0(ramCost)}`);
    else if (ns.singularity.upgradeHomeRam()) ns.print(`home RAM now ${ns.getServerMaxRam("home")} GB`);
  }

  const coreCost = ns.singularity.getUpgradeHomeCoresCost();
  if (coreCost > 0 && cash > coreCost * 6) {
    if (dryRun) ns.print(`[dry-run] would upgrade home cores for ${core0(coreCost)}`);
    else if (ns.singularity.upgradeHomeCores()) ns.print("home cores upgraded");
  }
}

function core0(n: number): string {
  return n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n.toFixed(0);
}

/** Pick the server with the best expected money per second. */
function pickTarget(ns: NS, rooted: string[]): string | null {
  const level = ns.getHackingLevel();
  let best: string | null = null;
  let bestScore = 0;

  for (const host of rooted) {
    if (host === "home") continue;
    if (ns.getServerRequiredHackingLevel(host) > level) continue;

    const maxMoney = ns.getServerMaxMoney(host);
    if (maxMoney <= 0) continue;

    const growth = ns.getServerGrowth(host);
    const chance = ns.hackAnalyze(host);
    if (chance <= 0) continue;

    const score = maxMoney * chance * growth;
    if (score > bestScore) {
      bestScore = score;
      best = host;
    }
  }
  return best;
}

/** One weaken -> grow -> hack round on `target`, using every free thread. */
async function cycle(ns: NS, target: string, core: any, dryRun: boolean): Promise<void> {
  const threads = core.availableThreads(ns, ns.getHostname());
  const cores = ns.getServer(target).cpuCores;

  const maxMoney = ns.getServerMaxMoney(target);
  const minSec = ns.getServerMinSecurityLevel(target);
  const curSec = ns.getServerSecurityLevel(target);
  const curMoney = ns.getServerMoneyAvailable(target);

  if (dryRun) {
    ns.print(
      `[dry-run] ${target}: money ${core.fmt(curMoney)}/${core.fmt(maxMoney)}, ` +
        `sec ${curSec}/${minSec}, ${threads} threads`,
    );
    return;
  }

  if (curSec > minSec) {
    const perThread = ns.weakenAnalyze(1, cores);
    const need = Math.ceil((curSec - minSec) / Math.max(perThread, 1e-6));
    const t = Math.min(threads, Math.max(1, need));
    await ns.weaken(target, { threads: t });
  }

  if (curMoney < maxMoney) {
    const mult = maxMoney / Math.max(curMoney, 1);
    const need = ns.growthAnalyze(target, mult, cores);
    const t = Math.min(threads, Math.max(1, Math.ceil(need)));
    await ns.grow(target, { threads: t });
  }

  const perThread = ns.hackAnalyze(target);
  if (perThread > 0) {
    const t = Math.min(threads, Math.max(1, Math.floor(0.9 / perThread)));
    const gained = await ns.hack(target, { threads: t });
    ns.print(`hacked ${target} with ${t} threads -> ${core.fmt(gained)}`);
  }
}


