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
 *   nuke + 5 port openers 0.05 each | installBackdoor 2
 *   upgradeHomeRam 3 | upgradeHomeCores 3 | getUpgradeHomeRamCost 1.5 | getUpgradeHomeCoresCost 1.5
 *   createProgram 5 | purchaseProgram 2 | purchaseTor 2
 *   getDarkwebPrograms 0.5 | getDarkwebProgramCost 0.5
 *   => ~28 GB. Run it on a server with at least 32 GB.
 *
 * Usage
 *   run hacking.ts
 *   run hacking.ts --interval 5000 --dry-run
 */

import type { NS } from "../defs.d";

const RAM_NEEDED = 28;

export async function main(ns: NS): Promise<void> {
  ns.clearLog();
  ns.disableLog("ALL");

  const args = ns.args.map(String);
  const dryRun = args.includes("--dry-run");
  const interval = Number(flagOr(args, "--interval", 1000));

  const core = await ns.dynamicImport("./core.ts");
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
    await installBackdoors(ns, core, dryRun);
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

/** Install a backdoor on every rooted server we are allowed to. */
/** Install backdoors on every rooted server we can reach. */
async function installBackdoors(ns: NS, core: any, dryRun: boolean): Promise<void> {
  const level = ns.getHackingLevel();
  for (const host of core.rootedServers(ns)) {
    if (host === "home") continue;
    if (ns.getServer(host).backdoorInstalled) continue;
    if (ns.getServerRequiredHackingLevel(host) > level) continue;
    if (dryRun) {
      ns.print(`[dry-run] would install a backdoor on ${host}`);
      continue;
    }
    // installBackdoor works on the server the script is running on.
    ns.singularity.connect(host);
    await ns.singularity.installBackdoor();
    ns.print(`backdoor on ${host}`);
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


