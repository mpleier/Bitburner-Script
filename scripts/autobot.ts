/**
 * autobot.ts
 * ============================================================================
 * The orchestrator for the Bitburner automation suite.
 *
 * It does four things:
 *   1. Installs the suite. `--install` wget's every file from GitHub onto home.
 *   2. Decides which subsystems are actually usable right now (gang needs
 *      Source-File 2, bladeburner SF6, sleeves SF10, stanek SF13, go SF14,
 *      stock SF8, corporation SF3, darknet only exists in BitNode 15).
 *   3. Places each module on the biggest rooted server that can hold it,
 *      copying core.ts alongside it.
 *   4. Keeps them running and prints a status dashboard every --interval ms.
 *
 * RAM cost (GB), from the official RamCostGenerator:
 *   base 1.6 | scan 0.2 | ls 0.2 | getServer 2 | getHostname 0.05
 *   getServerMaxRam 0.05 | getServerUsedRam 0.05 | hasRootAccess 0.05
 *   getHackingLevel 0.05 | getPlayer 0.5 | getMoneySources 0.5 | kill 0.2
 *   scp 0.6 | exec 1.3 | sleep 0
 *   => 8.35 GB of its own calls, 15.15 GB with core.ts. Budget 16 GB.
 *
 * Usage
 *   run autobot.ts --install                 download everything, then run
 *   run autobot.ts                           orchestrate forever
 *   run autobot.ts --dry-run --loops 3       safe test run that terminates
 *   run autobot.ts --only hacking,hacknet    run a subset
 *   run autobot.ts --skip corporation        exclude a subset
 *   run autobot.ts --no-casino             keep the blackjack bot off
 *   run autobot.ts --status                  print the dashboard and exit
 *   run autobot.ts --kill                    stop every module the bot started
 */

// Bitburner injects its API typings as a global declaration file, so `NS`
// needs no import (globals.d.ts mirrors that for local `tsc` checks).

// core.ts is imported statically on purpose. Bitburner's RAM allocation is
// computed from the AST of the script and everything it *statically* imports;
// ns.dynamicImport() is invisible to that pass, so the API calls core.ts makes
// would not be paid for and the game would abort the script with a RAM error.
import * as core from "./core.ts";
import * as logger from "./logger.ts";
// casino-policy.ts makes no API calls at all, so importing it costs 0 GB and
// keeps the casino's ban threshold in one place.
import * as policy from "./casino-policy.ts";

const REPO = "mpleier/Bitburner-Script";
const DEFAULT_REF = "main";

/** RAM the orchestrator itself needs (15.15 GB per `npm run ram`). Budget 16 GB. */
const AUTOBOT_RAM = 16;

interface Module {
  /** Script filename. */
  file: string;
  /** GB of RAM the module needs (see its header comment). */
  ram: number;
  /** Key passed to core.subsystemAvailable(). */
  subsystem: string;
  /** Lower priority = placed first, so it gets the fattest server. */
  priority: number;
  /** Threads to start it with. */
  threads: number;
  /** Extra flags forwarded to the module. */
  args: string[];
  /** One-line description shown in the dashboard. */
  note: string;
  /** Modules with optOut: true run by default and are disabled with --no-<subsystem>. */
  optOut?: boolean;
}

/**
 * The whole suite. RAM figures are the *real* allocation Bitburner computes for
 * each file (its own ns calls plus the 11.3 GB core.ts is statically imported
 * by every module). `npm run ram` regenerates them from RamCostGenerator.ts.
 */
const MODULES: Module[] = [
  { file: "hacking.ts",        ram: 35,  subsystem: "hacking",      priority: 1,  threads: 1, args: [], note: "root servers, backdoors, weaken/grow/hack, home RAM" },
  { file: "hacknet.ts",        ram: 21,  subsystem: "hacknet",      priority: 2,  threads: 1, args: [], note: "buy/upgrade hacknet nodes, spend hash" },
  { file: "contractRunner.ts", ram: 29,  subsystem: "contracts",    priority: 3,  threads: 1, args: ["--loop"], note: "find and solve every coding contract" },
  { file: "factions.ts",       ram: 55,  subsystem: "factions",     priority: 4,  threads: 1, args: [], note: "work for factions, donate, buy augmentations" },
  { file: "jobs.ts",           ram: 24,  subsystem: "jobs",         priority: 5,  threads: 1, args: [], note: "apply for the best-paying job" },
  { file: "crime.ts",          ram: 43,  subsystem: "crime",        priority: 6,  threads: 1, args: [], note: "commit the best crime, shadow-chain factions" },
  { file: "gang.ts",           ram: 46,  subsystem: "gang",         priority: 7,  threads: 1, args: [], note: "gang member task assignment + ascend" },
  { file: "bladeburner.ts",    ram: 78,  subsystem: "bladeburner",  priority: 8,  threads: 1, args: [], note: "Bladeburner contracts, ops, skill points" },
  { file: "corporation.ts",    ram: 462, subsystem: "corporation",  priority: 9,  threads: 1, args: [], note: "run a corporation (needs a big server)" },
  { file: "stock.ts",          ram: 45,  subsystem: "stock",        priority: 10, threads: 1, args: [], note: "tick-based stock trading" },
  { file: "stanek.ts",         ram: 26,  subsystem: "stanek",       priority: 11, threads: 1, args: [], note: "greedy Stanek fragment packing + charging" },
  { file: "sleeves.ts",        ram: 48,  subsystem: "sleeves",      priority: 12, threads: 1, args: [], note: "shock, sync, then stat-matched sleeve work" },
  { file: "go.ts",             ram: 60,  subsystem: "go",           priority: 13, threads: 1, args: [], note: "Bitburner Go: play optimally, collect rewards" },
  { file: "infiltration.ts",   ram: 27,  subsystem: "infiltration", priority: 14, threads: 1, args: [], note: "SP500 infiltration for materials" },
  { file: "darknet.ts",        ram: 26,  subsystem: "darknet",      priority: 15, threads: 1, args: [], note: "BN10 Darknet: harvest stasis links" },
  { file: "share.ts",          ram: 6,   subsystem: "share",        priority: 16, threads: 1, args: [], note: "fill leftover RAM with share() for faction work" },
  { file: "casino.ts",         ram: 35,  subsystem: "casino",       priority: 17, threads: 1, args: [], optOut: true, note: "blackjack save-scumming through the browser UI (disable with --no-casino)" },
];

/**
 * A module that drives the browser UI needs the player's focus. Modules that
 * take focus (faction work, a job, crimes, a Bladeburner action, `share()`)
 * replace the casino page with the work page, so they must not run at the same
 * time. `sleeves.ts`, `go.ts` and `infiltration.ts` are safe: they work through
 * the API without touching the player's work slot.
 */
const UI_FOCUS_CONFLICTS: Record<string, string[]> = {
  casino: ["crime", "jobs", "factions", "bladeburner", "share"],
};

/** Files every module needs next to it. */
const SUPPORT_FILES = ["core.ts", "logger.ts", "types.ts", "contracts.ts", "casino-policy.ts"];

/**
 * A module that exits straight away (karma too high, not enough money for a
 * corporation, no RAM, ...) would otherwise be restarted on every interval and
 * print the same line forever. After a couple of quick exits it is left alone
 * for COOLDOWN loops, then retried - and the wait doubles each time it fails
 * again, up to MAX_COOLDOWN_LOOPS, so a module that is blocked for months stops
 * costing log space.
 */
const QUICK_EXIT_LIMIT = 2;
const COOLDOWN_LOOPS = 12;
const MAX_COOLDOWN_LOOPS = 120;

/** Per-module restart bookkeeping used by the cooldown above. */
interface Track {
  host: string;
  /** How many consecutive intervals this script was found not running. */
  exits: number;
  /** Loop number before which the module must not be re-started. */
  mutedUntil: number;
}

/** Files the installer downloads when --install is used. */
const SUITE_FILES = MODULES.map((m) => m.file).concat(SUPPORT_FILES, ["install.js"]);

export async function main(ns: NS): Promise<void> {
  ns.clearLog();
  ns.disableLog("ALL");

  const args = ns.args.map(String);

  const dryRun = core.hasFlag(args, "--dry-run");
  const interval = core.numOr(args, "--interval", 5000);
  const loops = core.hasFlag(args, "--status") ? 1 : core.maxLoops(args);
  const only = parseList(core.flag(args, "--only"));
  const skip = parseList(core.flag(args, "--skip"));
  const ref = core.flag(args, "--ref") ?? DEFAULT_REF;
  const useCooldown = !core.hasFlag(args, "--no-cooldown");

  /* Opt-out subsystems: on by default, off when --no-<subsystem> is passed. */
  const optOut = new Set(
    MODULES.filter((m) => m.optOut && core.hasFlag(args, `--no-${m.subsystem}`)).map((m) => m.subsystem),
  );

  const host = ns.getHostname();
  if (ns.getServerMaxRam(host) < AUTOBOT_RAM) {
    logger.tlog(ns, `autobot.ts needs ~${AUTOBOT_RAM} GB; ${host} has ${ns.getServerMaxRam(host)} GB.`);
    logger.tlog(ns, "Run it on home once home has 16 GB, or use --only hacking,hacknet.");
    return;
  }

  if (core.hasFlag(args, "--kill")) {
    killSuite(ns);
    logger.tlog(ns, "autobot: killed every module in the suite.");
    return;
  }

  /* `--logs [N]` dumps the tail of the log file instead of running anything. */
  if (core.hasFlag(args, "--logs")) {
    const n = core.numOr(args, "--logs", 40);
    const text = logger.tail(ns, n);
    logger.tlog(ns, text || `log ${logger.logFile(ns)} is empty on ${host} - run a module first.`);
    return;
  }

  if (core.hasFlag(args, "--install")) {
    await installSuite(ns, ref);
  }

  logger.log(ns, "=== autobot ===");
  logger.log(ns, `bitnode ${core.bitnode(ns)} | money ${core.fmt(core.money(ns))} | hacking ${ns.getHackingLevel()}`);

  const tracked = new Map<string, Track>();

  for (let loop = 0; loop < loops; ++loop) {
    const muted = useCooldown ? mutedModules(ns, tracked, loop) : new Set<string>();
    const banned = casinoBanned(ns);
    if (banned) {
      if (loop === 0) logger.log(ns, "casino: the house has kicked us out, casino.ts stays off");
      stopBannedCasino(ns);
    }
    const plan = makePlan(ns, core, only, skip, muted, optOut, banned);
    startPlan(ns, plan, dryRun, tracked);
    dashboard(ns, core, plan);

    if (loop + 1 < loops) await ns.sleep(interval);
  }
}

/* -------------------------------------------------------------------------- */
/*  Installation                                                              */
/* -------------------------------------------------------------------------- */

/** wget every file of the suite onto the server the installer is on. */
async function installSuite(ns: NS, ref: string): Promise<void> {
  const base = `https://raw.githubusercontent.com/${REPO}/${ref}/scripts/`;
  const here = ns.getHostname();
  const have = new Set(ns.ls(here));

  for (const file of SUITE_FILES) {
    if (have.has(file)) {
      logger.log(ns, `have ${file}`);
      continue;
    }
    if (!(await ns.wget(base + file, file, here))) {
      logger.log(ns, `FAILED to download ${base}${file}`);
    } else {
      logger.log(ns, `downloaded ${file} (${ref})`);
    }
  }
}

/* -------------------------------------------------------------------------- */
/*  Planning                                                                  */
/* -------------------------------------------------------------------------- */

interface Placement {
  module: Module;
  host: string | null;
  reason: string;
}

/**
 * Modules that have exited QUICK_EXIT_LIMIT times in a row are muted for a
 * growing number of loops. Returns the set of files that must not be started
 * this loop.
 */
function mutedModules(ns: NS, tracked: Map<string, Track>, loop: number): Set<string> {
  const muted = new Set<string>();

  for (const [file, t] of tracked) {
    if (ns.scriptRunning(file, t.host)) {
      // It is alive: forget the strikes and any cooldown it is sitting out.
      t.exits = 0;
      t.mutedUntil = 0;
      continue;
    }

    t.exits += 1;
    if (t.exits < QUICK_EXIT_LIMIT) continue;

    // Only start a new cooldown when the previous one has just run out, so the
    // wait escalates 12 -> 24 -> 48 -> 96 -> 120 loops instead of being reset
    // every interval.
    if (t.mutedUntil <= loop) {
      const wave = Math.floor((t.exits - QUICK_EXIT_LIMIT) / COOLDOWN_LOOPS) + 1;
      const cooldown = Math.min(COOLDOWN_LOOPS * wave, MAX_COOLDOWN_LOOPS);
      t.mutedUntil = loop + cooldown;
      logger.log(ns,
        `${file} exited ${t.exits}x in a row on ${t.host}; ` +
        `skipping it for ${cooldown} loops (cooldown wave ${wave})`);
    }

    if (t.mutedUntil > loop) muted.add(file);
  }

  return muted;
}

/* -------------------------------------------------------------------------- */
/*  The casino                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The house throws us out for cheating once the winnings pass its limit, and
 * casino.ts writes casino_banned.txt when it happens. Blackjack has no API, so
 * that note plus the game's own winnings counter is how the orchestrator knows
 * the casino is closed for this save. Without it casino.ts would be restarted
 * every interval and print the same kick-out line forever.
 */
function casinoBanned(ns: NS): boolean {
  const winnings = core.tryCall(() => Number(ns.getMoneySources().sinceInstall.casino) || 0, 0);
  if (policy.isBannedByWinnings(winnings)) return true;

  for (const host of core.rootedServers(ns)) {
    if (core.tryCall(() => ns.ls(host).includes(policy.CASINO_BAN_MARKER), false)) return true;
  }
  return false;
}

/** Kill a casino run the house has already thrown out of. */
function stopBannedCasino(ns: NS): void {
  for (const host of reachable(ns)) {
    if (!ns.hasRootAccess(host)) continue;
    if (!core.tryCall(() => ns.scriptRunning("casino.ts", host), false)) continue;
    ns.kill("casino.ts", host);
    logger.log(ns, `casino.ts was kicked out of the casino; killed it on ${host}`);
  }
}

/**
 * Decide which modules should run and where.
 *
 * Servers are filled in priority order: the module with the lowest priority
 * number claims the rooted server with the most free RAM that can hold it.
 */
function makePlan(
  ns: NS,
  core: any,
  only: string[],
  skip: string[],
  muted: Set<string>,
  optOut: Set<string>,
  banned: boolean,
): Placement[] {
  // scriptHosts() (not rootedServers()) so hacknet nodes are available as script
  // hosts: they have RAM, and RAM used by scripts on them raises hash gain.
  const servers = (core.scriptHosts(ns) as string[])
    .map((h: string) => ({ host: h, free: core.tryCall(() => ns.getServerMaxRam(h) - ns.getServerUsedRam(h), 0) }))
    .sort((a: any, b: any) => b.free - a.free);

  /*
   * A UI driver only owns the screen if it is actually going to run: not turned
   * off, not excluded, unlocked in this bitnode, present on home and small enough
   * to fit on some rooted server. Only then do the modules that would steal the
   * player's focus have to stay idle.
   */
  const wouldRun = (module: Module) =>
    !optOut.has(module.subsystem) &&
    !skip.includes(module.subsystem) &&
    (only.length === 0 || only.includes(module.subsystem)) &&
    !muted.has(module.file) &&
    !(module.subsystem === "casino" && banned) &&
    core.subsystemAvailable(ns, module.subsystem) &&
    ns.ls(ns.getHostname()).includes(module.file) &&
    servers.some((server: any) => server.free >= module.ram);

  const focusBlocked = new Set<string>();
  for (const driver of MODULES) {
    const conflicts = UI_FOCUS_CONFLICTS[driver.subsystem];
    if (!conflicts || !wouldRun(driver)) continue;
    for (const blocked of conflicts) focusBlocked.add(blocked);
  }

  const placements: Placement[] = [];

  for (const module of MODULES) {
    if (only.length > 0 && !only.includes(module.subsystem)) continue;
    if (skip.includes(module.subsystem)) {
      placements.push({ module, host: null, reason: "excluded by --skip" });
      continue;
    }

    // A banned casino is dead for the rest of the save: do not restart it, and
    // do not let it mute the modules that conflict with its focus.
    if (module.subsystem === "casino" && banned) {
      placements.push({ module, host: null, reason: "the casino kicked us out for cheating" });
      continue;
    }

    if (module.optOut && optOut.has(module.subsystem)) {
      placements.push({ module, host: null, reason: `disabled by --no-${module.subsystem}` });
      continue;
    }

    if (focusBlocked.has(module.subsystem)) {
      placements.push({ module, host: null, reason: "focus conflict: the casino drives the UI" });
      continue;
    }

    if (muted.has(module.file)) {
      placements.push({ module, host: null, reason: "cooldown: it keeps exiting immediately" });
      continue;
    }

    if (!core.subsystemAvailable(ns, module.subsystem)) {
      placements.push({ module, host: null, reason: "not available in this bitnode" });
      continue;
    }

    if (!ns.ls(ns.getHostname()).includes(module.file)) {
      placements.push({ module, host: null, reason: `missing ${module.file} (use --install)` });
      continue;
    }

    const need = module.ram * module.threads;
    const target = servers.find((s: any) => s.free >= need);
    if (!target) {
      placements.push({ module, host: null, reason: `no rooted server with ${need} GB free` });
      continue;
    }

    target.free -= need;
    placements.push({ module, host: target.host, reason: "" });
  }

  return placements;
}

/** Copy the files and start the scripts. Returns how many were started. */
function startPlan(ns: NS, plan: Placement[], dryRun: boolean, tracked: Map<string, Track>): number {
  let started = 0;

  for (const p of plan) {
    if (!p.host) continue;

    if (ns.scriptRunning(p.module.file, p.host)) {
      // Keep the entry alive so mutedModules() can notice a later exit.
      if (!tracked.has(p.module.file)) tracked.set(p.module.file, { host: p.host, exits: 0, mutedUntil: 0 });
      continue;
    }

    if (dryRun) {
      logger.log(ns, `[dry-run] would run ${p.module.file} on ${p.host} (${p.module.ram} GB)`);
      started += 1;
      continue;
    }

    ns.scp([p.module.file, ...SUPPORT_FILES], p.host, ns.getHostname());
    const pid = ns.exec(p.module.file, p.host, p.module.threads, ...p.module.args);
    if (pid === 0) {
      logger.log(ns, `could not start ${p.module.file} on ${p.host}`);
    } else {
      logger.log(ns, `started ${p.module.file} on ${p.host} (pid ${pid}, ${p.module.ram} GB)`);
      // Keep the strike count: this module has still exited quickly on every
      // previous loop, and that is what the cooldown is built from. Resetting
      // it here would make the cooldown unreachable.
      const prev = tracked.get(p.module.file);
      tracked.set(p.module.file, {
        host: p.host,
        exits: prev ? prev.exits : 0,
        mutedUntil: prev ? prev.mutedUntil : 0,
      });
      started += 1;
    }
  }

  return started;
}

/** Kill every script the suite knows about, on every rooted server. */
function killSuite(ns: NS): void {
  for (const host of reachable(ns)) {
    if (!ns.hasRootAccess(host)) continue;
    for (const file of MODULES.map((m) => m.file)) ns.kill(file, host);
  }
}

/** All servers reachable from home (BFS). */
function reachable(ns: NS): string[] {
  const seen = new Set<string>();
  const queue = [ns.getHostname()];
  while (queue.length > 0) {
    const h = queue.shift() as string;
    if (seen.has(h)) continue;
    seen.add(h);
    for (const n of ns.scan(h)) if (!seen.has(n)) queue.push(n);
  }
  return [...seen];
}


/* -------------------------------------------------------------------------- */
/*  Dashboard                                                                 */
/* -------------------------------------------------------------------------- */

function dashboard(ns: NS, core: any, plan: Placement[]): void {
  const running = plan.filter((p) => p.host && ns.scriptRunning(p.module.file, p.host));
  const blocked = plan.filter((p) => !p.host);

  logger.log(ns, "");
  logger.log(ns, `money ${core.fmt(core.money(ns))} | hacking ${ns.getHackingLevel()} | bn ${core.bitnode(ns)}`);
  logger.log(ns, `running ${running.length} modules | blocked ${blocked.length}`);

  for (const p of running) {
    logger.log(ns, `  ${pad(p.module.file, 18)} -> ${pad(p.host ?? "", 12)} ${p.module.ram} GB  ${p.module.note}`);
  }
  for (const p of blocked) {
    logger.log(ns, `  ${pad(p.module.file, 18)}    skipped: ${p.reason}`);
  }

  const servers = core.rootedServers(ns) as string[];
  let used = 0;
  let max = 0;
  for (const h of servers) {
    used += ns.getServerUsedRam(h);
    max += ns.getServerMaxRam(h);
  }
  logger.log(ns, `network RAM: ${used.toFixed(1)} / ${max.toFixed(1)} GB on ${servers.length} rooted servers`);
  logger.log(ns, "");
}

/** Right-pad a string to width. */
function pad(s: string, width: number): string {
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

/** "--only hacking,stock" -> ["hacking", "stock"]. */
function parseList(v: string | undefined): string[] {
  if (!v) return [];
  return v.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

