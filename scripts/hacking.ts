/**
 * hacking.ts
 * ============================================================================
 * Automates the whole hacking pipeline:
 *   1. Buy every port-opening program on the darkweb (never create one).
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
 *   purchaseProgram 2 | purchaseTor 2
 *   getDarkwebPrograms 0.5 | getDarkwebProgramCost 0.5
 *   => ~35 GB (29 GB of hacking calls + 6.5 GB of core.ts helpers). Run it on a
 *      server with at least 35 GB.
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
import * as logger from "./logger.ts";

const RAM_NEEDED = 35;

export async function main(ns: NS): Promise<void> {
  ns.clearLog();
  ns.disableLog("ALL");

  const args = ns.args.map(String);
  const dryRun = args.includes("--dry-run");
  const interval = flagOr(args, "--interval", 1000);
  const noBackdoor = args.includes("--no-backdoor");
  const backdoorDaemon = args.includes("--backdoor-daemon");

  const loops = core.maxLoops(args);

  const host = ns.getHostname();
  if (core.tryCall(() => ns.getServerMaxRam(host), 0) < RAM_NEEDED) {
    logger.tlog(ns, `hacking.ts needs ${RAM_NEEDED} GB; ${host} has ${ns.getServerMaxRam(host)} GB.`);
    return;
  }

  logger.log(ns, "=== hacking module ===");

  for (let loop = 0; loop < loops; ++loop) {
    // Every step runs inside guard(): a server that vanished mid-scan, a darkweb
    // call made before TOR is affordable, or a singularity function locked out by
    // the current BitNode logs one line and the loop carries on. The script never
    // dies, it just does less.
    await guard(ns, "program shop", () => ensurePrograms(ns, core, dryRun, loop));
    const rooted = (await guard(ns, "root sweep", () => rootNetwork(ns, core, dryRun)) as string[]) ?? [];
    if (!noBackdoor) await guard(ns, "backdoors", () => installBackdoors(ns, core, dryRun, backdoorDaemon));
    await guard(ns, "home upgrades", () => upgradeHome(ns, dryRun));

    const target = (await guard(ns, "target selection", () => pickTarget(ns, rooted)) as string | null) ?? null;
    if (target) await guard(ns, `hack cycle on ${target}`, () => cycle(ns, target, core, dryRun));
    else logger.log(ns, "No hackable server yet - grinding hacking level.");

    await ns.sleep(interval);
  }
}

/**
 * Run one step of the loop and turn any exception into a log line.
 *
 * Bitburner kills a script outright when main() throws, which is the worst
 * possible outcome for a long-running automation: the process is gone and has to
 * be started again by hand. Returning null lets the caller decide what to do
 * with the missing value.
 */
async function guard(ns: NS, label: string, fn: () => unknown): Promise<unknown> {
  try {
    return await fn();
  } catch (err) {
    logger.log(ns, `${label} failed: ${msg(err)}`);
    return null;
  }
}

/** ns.getServer() that returns null instead of throwing for a vanished host. */
function safeServer(ns: NS, host: string): any {
  try {
    return ns.getServer(host);
  } catch {
    return null;
  }
}

/** Short, printable form of whatever the game threw. */
function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function flagOr(args: string[], name: string, fallback: number): number {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? Number(args[i + 1]) : fallback;
}

/**
 * Buy every program we are missing from the darkweb.
 *
 * ns.singularity.createProgram() is deliberately never called. In
 * src/Singularity.ts it does not "make" a program: it calls Player.startWork()
 * with a CreateProgramWork and (focus defaults to true) Player.startFocusing(),
 * i.e. it takes over the player's work slot and opens the Work page. That
 * cancels the company job / faction work / crime the other modules are running
 * and switches Bladeburner automation off. Buying is instant and costs money
 * only.
 *
 * Every call here can throw, so each one is wrapped:
 *   - singularity functions are locked outside BitNode 4 without Source-File 4
 *     (helpers.checkSingularityAccess throws);
 *   - getDarkwebProgramCost() throws for a program the darkweb does not sell
 *     (NUKE.exe is not on it) and returns -1 before TOR is bought.
 * The module therefore degrades to "use whatever we already have" instead of
 * crashing.
 */
function ensurePrograms(ns: NS, core: any, dryRun: boolean, loop: number): void {
  const owned = core.ownedPrograms(ns);
  const missing = core.DARKWEB_PROGRAMS.filter((p: string) => !owned.has(p));
  if (missing.length === 0) return;

  if (!core.subsystemAvailable(ns, "singularity")) {
    logger.log(ns, 
      `cannot shop on the darkweb: singularity needs Source-File 4 (bitnode ${core.bitnode(ns)})`,
    );
    return;
  }

  if (dryRun) {
    for (const program of missing) logger.log(ns, `[dry-run] would buy ${program}`);
    return;
  }

  // purchaseTor() returns true when we already own the router, false when the
  // 100k is out of reach. Without it the darkweb is unreachable.
  if (!core.tryCall(() => ns.singularity.purchaseTor(), false)) {
    logger.log(ns, "cannot shop on the darkweb: the TOR router costs 100k and we cannot afford it");
    return;
  }

  for (const program of missing) {
    // cost < 0 -> not sold here / no TOR, cost === 0 -> we already own it.
    const cost = core.tryCall(() => ns.singularity.getDarkwebProgramCost(program), -1);
    if (cost < 0) {
      logger.log(ns, `skipping ${program}: not sold on the darkweb`);
      continue;
    }
    if (cost === 0) continue;

    const cash = core.money(ns);
    // Keep a 20% buffer so a purchase never leaves us broke.
    if (cash < cost * 1.2) {
      logger.log(ns, `skipping ${program}: ${core.fmt(cost)} but we only have ${core.fmt(cash)}`);
      continue;
    }

    if (core.tryCall(() => ns.singularity.purchaseProgram(program), false)) {
      logger.log(ns, `bought ${program} for ${core.fmt(cost)}`);
    } else {
      logger.log(ns, `could not buy ${program}`);
    }
  }

  // NUKE.exe is the one program the darkweb never sells, so say it once and move
  // on: ns.nuke() returns false without it, which is a soft failure.
  if (loop === 0 && !owned.has("NUKE.exe")) {
    logger.log(ns, "NUKE.exe is not sold on the darkweb - it has to be created or found; nuke() will fail until we have it");
  }
}

/** Root every server we can; returns the rooted list. */
function rootNetwork(ns: NS, core: any, dryRun: boolean): string[] {
  const candidates = core.rootableServers(ns);
  const rooted = core.rootedServers(ns);

  for (const host of candidates) {
    if (dryRun) {
      logger.log(ns, `[dry-run] could root ${host} (${ns.getServerNumPortsRequired(host)} ports)`);
      continue;
    }
    // A server can disappear (or move) between the scan and the nuke, and
    // ns.nuke()/ns.brutessh() return false rather than throwing when we lack the
    // program or the ports. Either way, one bad host must not stop the sweep.
    try {
      if (core.rootServer(ns, host)) {
        rooted.push(host);
        logger.log(ns, `rooted ${host}`);
      }
    } catch (err) {
      logger.log(ns, `rooting ${host} failed: ${msg(err)}`);
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
 *   2. The rooted list also contains every server we own (home, cloud servers).
 *      All of them are purchasedByPlayer and can never be backdoored, so they
 *      have to be filtered out before we try. core.rootedServers() additionally
 *      drops hacknet nodes, which are not Server objects at all.
 */
function backdoorBlocker(ns: NS, host: string, allowDaemon: boolean): string | null {
  // getServer() throws for a host that is no longer on the network, so it is
  // wrapped: no server info means we cannot safely backdoor it.
  const server = safeServer(ns, host);
  if (!server) return "not reachable from our network";
  if (host === "home") return "home is your own computer";
  if (host === "darkweb") return "the darkweb cannot be backdoored";
  if (host.startsWith("hacknet-")) return "hacknet node, not a real server";
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
  // connect() throws when singularity access is unavailable, so every call is
  // guarded: a failed connection only means we skip this backdoor.
  if (safeConnect(ns, host)) return true;

  let hops: string[] = [];
  try {
    hops = ns.scan(host);
  } catch {
    return false;
  }

  for (const hop of hops) {
    if (hop === "home" || safeServer(ns, hop)?.backdoorInstalled) {
      if (safeConnect(ns, hop) && safeConnect(ns, host)) return true;
    }
  }
  return false;
}

/** ns.singularity.connect() that returns false instead of throwing. */
function safeConnect(ns: NS, host: string): boolean {
  try {
    return ns.singularity.connect(host);
  } catch {
    return false;
  }
}

/** Install backdoors on every rooted foreign server we can actually reach. */
async function installBackdoors(ns: NS, core: any, dryRun: boolean, allowDaemon: boolean): Promise<void> {
  for (const host of core.rootedServers(ns)) {
    const blocker = backdoorBlocker(ns, host, allowDaemon);
    if (blocker) {
      // "already installed" is the boring case, do not spam the log with it.
      if (blocker !== "backdoor already installed") logger.log(ns, `skipping backdoor on ${host}: ${blocker}`);
      continue;
    }

    if (dryRun) {
      logger.log(ns, `[dry-run] would install a backdoor on ${host}`);
      continue;
    }

    // installBackdoor() has no target argument: it acts on the server we are
    // connected to, so connect() must succeed before we call it.
    if (!connectTo(ns, host)) {
      logger.log(ns, `skipping backdoor on ${host}: not reachable from our network position`);
      continue;
    }

    try {
      await ns.singularity.installBackdoor();
      logger.log(ns, `backdoor installed on ${host}`);
    } catch (err) {
      logger.log(ns, `backdoor on ${host} failed: ${msg(err)}`);
    }
  }
}

/** Buy home RAM/cores when the cost is a small fraction of our money. */
function upgradeHome(ns: NS, dryRun: boolean): void {
  // Locked out of singularity functions in this BitNode: nothing to do.
  if (!core.subsystemAvailable(ns, "singularity")) return;

  const cash = core.money(ns);

  const ramCost = core.tryCall(() => ns.singularity.getUpgradeHomeRamCost(), Infinity);
  if (ramCost > 0 && cash > ramCost * 4) {
    if (dryRun) logger.log(ns, `[dry-run] would upgrade home RAM for ${core.fmt(ramCost)}`);
    else if (core.tryCall(() => ns.singularity.upgradeHomeRam(), false)) {
      logger.log(ns, `home RAM now ${core.tryCall(() => ns.getServerMaxRam("home"), 0)} GB`);
    }
  }

  const coreCost = core.tryCall(() => ns.singularity.getUpgradeHomeCoresCost(), Infinity);
  if (coreCost > 0 && cash > coreCost * 6) {
    if (dryRun) logger.log(ns, `[dry-run] would upgrade home cores for ${core.fmt(coreCost)}`);
    else if (core.tryCall(() => ns.singularity.upgradeHomeCores(), false)) logger.log(ns, "home cores upgraded");
  }
}

/** Pick the server with the best expected money per second. */
function pickTarget(ns: NS, rooted: string[]): string | null {
  const level = ns.getHackingLevel();
  let best: string | null = null;
  let bestScore = 0;

  for (const host of rooted) {
    if (host === "home") continue;
    // Defensive: core.rootedServers() already drops hacknet nodes, but a caller
    // can hand us any list. Hacknet nodes report root access, yet they are not
    // Server objects, so every stat call on them throws:
    //   "getServerRequiredHackingLevel: Cannot be executed on hacknet-server-0.
    //    The server must not be a hacknet server."
    if (core.isHacknetServer(host)) continue;

    // A server can go offline between the BFS scan and this read, so the whole
    // stat read is wrapped: one unreachable host is skipped, not fatal.
    const stats = core.tryCall(
      () => ({
        required: ns.getServerRequiredHackingLevel(host),
        maxMoney: ns.getServerMaxMoney(host),
        growth: ns.getServerGrowth(host),
        chance: ns.hackAnalyze(host),
      }),
      null,
    );
    if (!stats) continue;
    if (stats.required > level) continue;
    if (stats.maxMoney <= 0) continue;
    if (stats.chance <= 0) continue;

    const score = stats.maxMoney * stats.chance * stats.growth;
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
  const cores = safeServer(ns, target)?.cpuCores ?? 1;

  // Every stat here can throw if the server vanished between pickTarget() and
  // this call, so each read is wrapped and a server with no money is skipped.
  const maxMoney = core.tryCall(() => ns.getServerMaxMoney(target), 0);
  if (maxMoney <= 0) {
    logger.log(ns, `${target} has no money to farm - skipping`);
    return;
  }
  const minSec = core.tryCall(() => ns.getServerMinSecurityLevel(target), 1);
  const curSec = core.tryCall(() => ns.getServerSecurityLevel(target), 1);
  const curMoney = core.tryCall(() => ns.getServerMoneyAvailable(target), 0);

  if (dryRun) {
    logger.log(ns, 
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
    logger.log(ns, `hacked ${target} with ${t} threads -> ${core.fmt(gained)}`);
  }
}


