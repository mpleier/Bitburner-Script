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
 *   getHackingLevel 0.05 | getPlayer 0.5 | scp 0.6 | exec 1.3 | sleep 0
 *   => ~6.5 GB for one planning pass over ~10 servers. Budget 12 GB.
 *
 * Usage
 *   run autobot.ts --install                 download everything, then run
 *   run autobot.ts                           orchestrate forever
 *   run autobot.ts --dry-run --loops 3       safe test run that terminates
 *   run autobot.ts --only hacking,hacknet    run a subset
 *   run autobot.ts --skip corporation        exclude a subset
 *   run autobot.ts --status                  print the dashboard and exit
 *   run autobot.ts --kill                    stop every module the bot started
 */

import type { NS } from "../defs.d";

const REPO = "mpleier/Bitburner-Script";
const DEFAULT_REF = "main";

/** RAM the orchestrator itself needs. */
const AUTOBOT_RAM = 12;

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
}

/**
 * The whole suite. RAM figures come from RamCostGenerator.ts and are repeated
 * in each module's header comment.
 */
const MODULES: Module[] = [
  { file: "hacking.ts",        ram: 28,  subsystem: "hacking",      priority: 1,  threads: 1, args: [], note: "root servers, backdoors, weaken/grow/hack, home RAM" },
  { file: "hacknet.ts",        ram: 8,   subsystem: "hacknet",      priority: 2,  threads: 1, args: [], note: "buy/upgrade hacknet nodes, spend hash" },
  { file: "contractRunner.ts", ram: 28,  subsystem: "contracts",    priority: 3,  threads: 1, args: ["--loop"], note: "find and solve every coding contract" },
  { file: "factions.ts",       ram: 34,  subsystem: "factions",     priority: 4,  threads: 1, args: [], note: "work for factions, donate, buy augmentations" },
  { file: "jobs.ts",           ram: 10,  subsystem: "jobs",         priority: 5,  threads: 1, args: [], note: "apply for the best-paying job" },
  { file: "crime.ts",          ram: 38,  subsystem: "crime",        priority: 6,  threads: 1, args: [], note: "commit the best crime, shadow-chain factions" },
  { file: "gang.ts",           ram: 28,  subsystem: "gang",         priority: 7,  threads: 1, args: [], note: "gang member task assignment + ascend" },
  { file: "bladeburner.ts",    ram: 92,  subsystem: "bladeburner",  priority: 8,  threads: 1, args: [], note: "Bladeburner contracts, ops, skill points" },
  { file: "corporation.ts",    ram: 421, subsystem: "corporation",  priority: 9,  threads: 1, args: [], note: "run a corporation (needs a big server)" },
  { file: "stock.ts",          ram: 36,  subsystem: "stock",        priority: 10, threads: 1, args: [], note: "tick-based stock trading" },
  { file: "stanek.ts",         ram: 17,  subsystem: "stanek",       priority: 11, threads: 1, args: [], note: "greedy Stanek fragment packing + charging" },
  { file: "sleeves.ts",        ram: 45,  subsystem: "sleeves",      priority: 12, threads: 1, args: [], note: "shock, sync, then stat-matched sleeve work" },
  { file: "go.ts",             ram: 50,  subsystem: "go",           priority: 13, threads: 1, args: [], note: "Bitburner Go: play optimally, collect rewards" },
  { file: "infiltration.ts",   ram: 18,  subsystem: "infiltration", priority: 14, threads: 1, args: [], note: "SP500 infiltration for materials" },
  { file: "darknet.ts",        ram: 26,  subsystem: "darknet",      priority: 15, threads: 1, args: [], note: "BN10 Darknet: harvest stasis links" },
  { file: "share.ts",          ram: 4,   subsystem: "share",        priority: 16, threads: 1, args: [], note: "fill leftover RAM with share() for faction work" },
];

/** Files every module needs next to it. */
const SUPPORT_FILES = ["core.ts", "types.ts", "contracts.ts"];

/** Files the installer downloads when --install is used. */
const SUITE_FILES = MODULES.map((m) => m.file).concat(SUPPORT_FILES, ["install.js"]);

export async function main(ns: NS): Promise<void> {
  ns.clearLog();
  ns.disableLog("ALL");

  const args = ns.args.map(String);
  const core = await ns.dynamicImport("./core.ts");

  const dryRun = core.hasFlag(args, "--dry-run");
  const interval = core.numOr(args, "--interval", 5000);
  const loops = core.hasFlag(args, "--status") ? 1 : core.maxLoops(args);
  const only = parseList(core.flag(args, "--only"));
  const skip = parseList(core.flag(args, "--skip"));
  const ref = core.flag(args, "--ref") ?? DEFAULT_REF;

  const host = ns.getHostname();
  if (ns.getServerMaxRam(host) < AUTOBOT_RAM) {
    ns.tprint(`autobot.ts needs ~${AUTOBOT_RAM} GB; ${host} has ${ns.getServerMaxRam(host)} GB.`);
    ns.tprint("Run it on home once home has 16 GB, or use --only hacking,hacknet.");
    return;
  }

  if (core.hasFlag(args, "--kill")) {
    killSuite(ns);
    ns.tprint("autobot: killed every module in the suite.");
    return;
  }

  if (core.hasFlag(args, "--install")) {
    await installSuite(ns, ref);
  }

  ns.print("=== autobot ===");
  ns.print(`bitnode ${core.bitnode(ns)} | money ${core.fmt(core.money(ns))} | hacking ${ns.getHackingLevel()}`);

  for (let loop = 0; loop < loops; ++loop) {
    const plan = makePlan(ns, core, only, skip);
    startPlan(ns, plan, dryRun);
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
      ns.print(`have ${file}`);
      continue;
    }
    if (!(await ns.wget(base + file, file, here))) {
      ns.print(`FAILED to download ${base}${file}`);
    } else {
      ns.print(`downloaded ${file} (${ref})`);
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
 * Decide which modules should run and where.
 *
 * Servers are filled in priority order: the module with the lowest priority
 * number claims the rooted server with the most free RAM that can hold it.
 */
function makePlan(ns: NS, core: any, only: string[], skip: string[]): Placement[] {
  const servers = (core.rootedServers(ns) as string[])
    .map((h: string) => ({ host: h, free: ns.getServerMaxRam(h) - ns.getServerUsedRam(h) }))
    .sort((a: any, b: any) => b.free - a.free);

  const placements: Placement[] = [];

  for (const module of MODULES) {
    if (only.length > 0 && !only.includes(module.subsystem)) continue;
    if (skip.includes(module.subsystem)) {
      placements.push({ module, host: null, reason: "excluded by --skip" });
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
function startPlan(ns: NS, plan: Placement[], dryRun: boolean): number {
  let started = 0;

  for (const p of plan) {
    if (!p.host) continue;
    if (ns.scriptRunning(p.module.file, p.host)) continue;

    if (dryRun) {
      ns.print(`[dry-run] would run ${p.module.file} on ${p.host} (${p.module.ram} GB)`);
      started += 1;
      continue;
    }

    ns.scp([p.module.file, "core.ts"], p.host, ns.getHostname());
    const pid = ns.exec(p.module.file, p.host, p.module.threads, ...p.module.args);
    if (pid === 0) {
      ns.print(`could not start ${p.module.file} on ${p.host}`);
    } else {
      ns.print(`started ${p.module.file} on ${p.host} (pid ${pid}, ${p.module.ram} GB)`);
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

  ns.print("");
  ns.print(`money ${core.fmt(core.money(ns))} | hacking ${ns.getHackingLevel()} | bn ${core.bitnode(ns)}`);
  ns.print(`running ${running.length} modules | blocked ${blocked.length}`);

  for (const p of running) {
    ns.print(`  ${pad(p.module.file, 18)} -> ${pad(p.host ?? "", 12)} ${p.module.ram} GB  ${p.module.note}`);
  }
  for (const p of blocked) {
    ns.print(`  ${pad(p.module.file, 18)}    skipped: ${p.reason}`);
  }

  const servers = core.rootedServers(ns) as string[];
  let used = 0;
  let max = 0;
  for (const h of servers) {
    used += ns.getServerUsedRam(h);
    max += ns.getServerMaxRam(h);
  }
  ns.print(`network RAM: ${used.toFixed(1)} / ${max.toFixed(1)} GB on ${servers.length} rooted servers`);
  ns.print("");
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

