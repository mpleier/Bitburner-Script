/**
 * core.ts
 * ============================================================================
 * Shared helpers for the Bitburner automation suite.
 *
 * How this file is paid for:
 * Bitburner reserves RAM *statically* - it walks the AST of the script being run
 * plus every script it *statically* imports (src/Script/RamCalculations.ts) -
 * but it charges RAM *dynamically*, the first time each ns function is actually
 * called (src/Netscript/APIWrapper.ts -> helpers.updateDynamicRam).
 *
 * A module pulled in with ns.dynamicImport() is invisible to the static pass, so
 * the API calls it makes would be charged against an allocation that never
 * reserved them, and the game would abort the script with:
 *   "Dynamic RAM usage calculated to be greater than RAM allocation."
 *
 * core.ts calls the API, so every module imports it with
 *   import * as core from "./core.ts";
 * which makes those calls visible to the static pass. The distinct API calls in
 * this file add ~9.7 GB (11.3 GB including the 1.6 GB base) to every module that
 * imports it - the Bladeburner/work-conflict helpers alone account for 6.5 GB of
 * that (getOwnedAugmentations 5 GB, getCurrentAction 1 GB, isBusy 0.5 GB).
 *
 * Flags understood by every module:
 *   --dry-run     make no state-changing calls, just report what would happen
 *   --verbose     extra logging (also mirrors the log file to the terminal)
 *   --interval N  milliseconds between loops (default 1000)
 *
 * Output goes to a log file, not the terminal - see logger.ts:
 *   --log <file>  log file name (default autobot_log.txt, .txt is added)
 *   --no-log      print to the terminal instead of the log file
 *   --print       alias for --verbose
 */

import * as state from "./state.ts";

// Bitburner injects its API typings as a global declaration file, so `NS`
// needs no import (globals.d.ts mirrors that for local `tsc` checks).

/** Programs the suite wants on `home`. */
export const PROGRAMS: string[] = [
  "NUKE.exe",
  "BruteSSH.exe",
  "FTPCrack.exe",
  "relaySMTP.exe",
  "HTTPWorm.exe",
  "SQLInject.exe",
  "DeepscanV1.exe",
  "DeepscanV2.exe",
  "AutoLink.exe",
  "ServerProfiler.exe",
  "Formulas.exe",
];

/**
 * The programs the darkweb actually sells, in the order we buy them: the five
 * port openers first (they unlock servers), then the utilities.
 *
 * NUKE.exe is deliberately absent - the darkweb does not sell it, and the suite
 * never calls ns.singularity.createProgram(): that starts a real work session on
 * the player, which cancels any job/faction work/crime in progress and breaks
 * Bladeburner automation. ns.nuke() simply returns false when we do not have
 * NUKE.exe, so missing it is a soft failure, not a crash.
 */
export const DARKWEB_PROGRAMS: string[] = [
  "BruteSSH.exe",
  "FTPCrack.exe",
  "relaySMTP.exe",
  "HTTPWorm.exe",
  "SQLInject.exe",
  "DeepscanV1.exe",
  "ServerProfiler.exe",
  "AutoLink.exe",
  "DeepscanV2.exe",
  "Formulas.exe",
];

/** Port openers: program file name <-> the ns call that opens that port. */
export const PORT_OPENERS: Array<{ file: string; open: (ns: NS, host: string) => boolean }> = [
  { file: "BruteSSH.exe", open: (ns, host) => ns.brutessh(host) },
  { file: "FTPCrack.exe", open: (ns, host) => ns.ftpcrack(host) },
  { file: "relaySMTP.exe", open: (ns, host) => ns.relaysmtp(host) },
  { file: "HTTPWorm.exe", open: (ns, host) => ns.httpworm(host) },
  { file: "SQLInject.exe", open: (ns, host) => ns.sqlinject(host) },
];

/** `--name value` -> value, or undefined when the flag is absent. */
export function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

/** `--flag` -> true. */
export function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

/** Number of threads a script can run with on `host` (1 GB per thread). */
export function availableThreads(ns: NS, host: string): number {
  const free = tryCall(() => ns.getServerMaxRam(host) - ns.getServerUsedRam(host), 1);
  return Math.max(1, Math.floor(free));
}

/** BFS from home over ns.scan(); returns every reachable hostname. */
export function discover(ns: NS): string[] {
  const seen = new Set<string>();
  const queue = ["home"];
  while (queue.length > 0) {
    const host = queue.shift() as string;
    if (seen.has(host)) continue;
    seen.add(host);
    for (const next of ns.scan(host)) {
      if (!seen.has(next)) queue.push(next);
    }
  }
  return [...seen];
}

/**
 * Is `host` a hacknet node rather than a real server?
 *
 * Hacknet nodes are on the network and we own them, so ns.hasRootAccess()
 * returns true for them - but they are HacknetServer instances, not Server
 * instances. Every API that needs real server stats goes through
 * helpers.getNormalServer() (src/Netscript/Helpers.tsx), which throws for them:
 *
 *   getServerRequiredHackingLevel: Cannot be executed on hacknet-server-0.
 *   The server must not be a hacknet server.
 *
 * The hostname prefix test is the same one the game itself uses
 * (src/Cloud.ts: hostname.startsWith("hacknet-node-") || ...("hacknet-server-")).
 */
export function isHacknetServer(host: string): boolean {
  return host.startsWith("hacknet-server-") || host.startsWith("hacknet-node-");
}

/** ns.hasRootAccess() that returns false instead of throwing for a host that is
 * offline, isolated (darkweb before TOR) or otherwise not addressable. */
export function hasRoot(ns: NS, host: string): boolean {
  return tryCall(() => ns.hasRootAccess(host), false);
}

/**
 * Every reachable server we have root on that the hacking API can talk about.

 * Hacknet nodes are deliberately excluded: they are rooted, but rooting them is
 * meaningless and every stat call on them throws.
 */
export function rootedServers(ns: NS): string[] {
  return discover(ns).filter((h) => !isHacknetServer(h) && hasRoot(ns, h));
}

/**
 * Rooted hosts that can host scripts. Hacknet nodes count here: they have RAM,
 * scripts can run on them, and RAM consumed on a hacknet server increases its
 * hash production (formulas.hacknetServers.hashGainRate(level, ramUsed, maxRam, cores)).
 */
export function scriptHosts(ns: NS): string[] {
  return discover(ns).filter((h) => hasRoot(ns, h));
}

/** Biggest rooted server that can hold `ram` GB, or null. */
export function bestRootedServer(ns: NS, ram: number): string | null {
  let best: string | null = null;
  let bestFree = 0;
  for (const host of scriptHosts(ns)) {
    const free = tryCall(() => ns.getServerMaxRam(host) - ns.getServerUsedRam(host), 0);
    if (free >= ram && free > bestFree) {
      best = host;
      bestFree = free;
    }
  }
  return best;
}

/** Programs present on home. */
export function ownedPrograms(ns: NS): Set<string> {
  return new Set(ns.ls("home", ".exe"));
}

/** How many ports a server needs that we can already open. */
export function portsWeCanOpen(ns: NS, owned: Set<string>): number {
  let n = 0;
  for (const p of PORT_OPENERS) if (owned.has(p.file)) n += 1;
  return n;
}

/** Open every port we have a program for, then NUKE. Returns true on root. */
export function rootServer(ns: NS, host: string, dryRun = false): boolean {
  // Hacknet nodes are already "rooted" but are not servers: nuke() and the port
  // openers throw on them (helpers.getNormalServer).
  if (isHacknetServer(host)) return false;
  if (hasRoot(ns, host)) return true;
  const owned = ownedPrograms(ns);
  const needed = tryCall(() => ns.getServerNumPortsRequired(host), 99);
  if (portsWeCanOpen(ns, owned) < needed) return false;

  if (dryRun) return true;

  for (const p of PORT_OPENERS) {
    if (!owned.has(p.file)) continue;
    if (!tryCall(() => p.open(ns, host), false)) return false;
  }
  // nuke() returns false when NUKE.exe is missing or not enough ports are open.
  return tryCall(() => ns.nuke(host), false);
}

/** Servers we could root right now (level + programs), not yet rooted. */
export function rootableServers(ns: NS): string[] {
  const owned = ownedPrograms(ns);
  const level = ns.getHackingLevel();
  return discover(ns).filter(
    (h) =>
      // Hacknet nodes report root access already, but getServerNumPortsRequired
      // and getServerRequiredHackingLevel throw on them - filter them out first.
      !isHacknetServer(h) &&
      !hasRoot(ns, h) &&
      tryCall(() => ns.getServerRequiredHackingLevel(h), Infinity) <= level &&
      tryCall(() => ns.getServerNumPortsRequired(h), 99) <= portsWeCanOpen(ns, owned),
  );
}

/** Copy a file to every rooted server that has room for it. */
export function distribute(ns: NS, files: string[], minRam = 8): void {
  for (const host of scriptHosts(ns)) {
    if (tryCall(() => ns.getServerMaxRam(host), 0) < minRam) continue;
    tryCall(() => ns.scp(files, host, "home"), false);
  }
}

/** Player money. */
export function money(ns: NS): number {
  return ns.getPlayer().money;
}

/** Player stats. */
export function stats(ns: NS): Record<string, number> {
  const s = ns.getPlayer().skills;
  return {
    hacking: s.hacking,
    strength: s.strength,
    defense: s.defense,
    dexterity: s.dexterity,
    agility: s.agility,
    charisma: s.charisma,
    intelligence: s.intelligence,
  };
}

/** Compact money formatting without ns.format (0 GB anyway). */
export function fmt(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (n >= 1e12) return (n / 1e12).toFixed(2) + "T";
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return n.toFixed(2);
}

/** Safe call: returns fallback when the API is unavailable (BN locks, no access). */
export function tryCall<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** Milliseconds -> "1h 23m" style. */
export function fmtTime(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  if (s < 60) return s.toFixed(1) + "s";
  if (s < 3600) return (s / 60).toFixed(1) + "m";
  return (s / 3600).toFixed(2) + "h";
}

/**
 * `--loops N` -> stop the main loop after N iterations.
 * Without it the modules run forever (Infinity), which is what you want in
 * game; the test harness passes --loops 3 so every module terminates.
 */
export function maxLoops(args: string[]): number {
  const v = flag(args, "--loops");
  if (v === undefined) return Infinity;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : Infinity;
}

/** `--name value` -> Number(value), or `fallback` when absent/unparseable. */
export function numOr(args: string[], name: string, fallback: number): number {
  const v = flag(args, name);
  if (v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Do we own source file `n`, at least `level` deep? */
export function hasSF(ns: NS, n: number, level = 1): boolean {
  const info = tryCall(() => ns.getResetInfo(), null as any);
  if (!info || !info.ownedSF) return false;
  return (info.ownedSF.get(n) ?? 0) >= level;
}

/**
 * Bitnode numbers whose Source-File we already own.
 *
 * Bitnode n hands out Source-File n, so this list is exactly the set of bitnodes
 * the player has already destroyed - the input bitnode-policy.ts needs.
 */
export function ownedSourceFiles(ns: NS): number[] {
  const info = tryCall(() => ns.getResetInfo(), null as any);
  if (!info || !info.ownedSF) return [];
  const owned: number[] = [];
  for (const [n, level] of info.ownedSF as Map<number, number>) {
    if (level > 0) owned.push(n);
  }
  return owned;
}

/** Bitnode number, 1-based. */
export function bitnode(ns: NS): number {
  const info = tryCall(() => ns.getResetInfo(), null as any);
  return info && info.currentNode ? info.currentNode : 1;
}

/** Player karma. Gangs need karma <= -54000 outside BitNode 2. */
export function karma(ns: NS): number {
  const p = tryCall(() => ns.getPlayer(), null as any);
  return p && typeof p.karma === "number" ? p.karma : 0;
}

/**
 * Is this subsystem reachable in the current BitNode / source-file set?
 *
 * Mapping taken from the official BitNode list
 * (src/Documentation/doc/en/advanced/bitnodes.md):
 *   Gangs          BitNode 2   or Source-File 2
 *   Corporation    BitNode 3   or Source-File 3 (level 3 unlocks the full API)
 *   Bladeburner    BitNode 6/7 or Source-File 6/7
 *   Stanek's Gift  BitNode 13  or Source-File 13
 *   Sleeves        BitNode 10  or Source-File 10
 *   Darknet        BitNode 15  or Source-File 15
 *   Stock market   BitNode 8   or Source-File 8
 *   IPvGO          BitNode 14  or Source-File 14
 *   Singularity    BitNode 4   or Source-File 4
 */
export function subsystemAvailable(ns: NS, name: string): boolean {
  const p = tryCall(() => ns.getPlayer(), null as any);
  if (!p) return false;
  // The real property is `bitNodeOptions`; the old name is kept as a fallback.
  const flags: Record<string, boolean> = p.bitNodeOptions ?? p.bitnodeOptions ?? {};
  const bn = bitnode(ns);

  switch (name) {
    case "gang":
      return !flags.disableGang && (bn === 2 || hasSF(ns, 2));
    case "corporation":
      return !flags.disableCorporation && (bn === 3 || hasSF(ns, 3));
    case "bladeburner":
      return (
        !flags.disableBladeburner &&
        (bn === 6 || bn === 7 || hasSF(ns, 6) || hasSF(ns, 7))
      );
    case "stanek":
      return bn === 13 || hasSF(ns, 13);
    case "sleeves":
      return !flags.disableSleeveExpAndAugmentation && (bn === 10 || hasSF(ns, 10));
    case "darknet":
      return bn === 15 || bn === 10 || hasSF(ns, 15);
    case "stock":
      return !flags.disable4SData && (bn === 8 || hasSF(ns, 8));
    case "go":
      return bn === 14 || hasSF(ns, 14);
    case "hacknet":
      return !flags.disableHacknetServer;
    case "singularity":
      return bn === 4 || hasSF(ns, 4);
    case "infiltration":
      return true;
    default:
      return true;
  }
}


/* -------------------------------------------------------------------------- */
/*  Bladeburner / work conflict                                                */
/* -------------------------------------------------------------------------- */
/*
 * The game cancels a running Bladeburner action the instant the player has any
 * `currentWork` (company job, faction work, crime, class work, share) and does
 * not own the BladesSimulacrum augmentation:
 *
 *   // src/Bladeburner/Bladeburner.ts -> Bladeburner.process() (paraphrased)
 *   if (Player.currentWork && !Player.hasAugmentation(AugmentationName.BladesSimulacrum, true)) {
 *     this.cancelAction();   // action reset, automation switched off, dialog shown
 *   }
 *
 * `Player.currentWork` is set by company work, faction work, crimes, class work
 * and ns.share(). ns.singularity.isBusy() is slightly broader - it also reports
 * the Infiltration and BitVerse pages - so using it as the test is conservative.
 *
 * So a work-based subsystem and a Bladeburner operation cannot run at the same
 * time unless BladesSimulacrum is installed. These helpers let every module
 * check that before calling ns.workForCompany()/ns.share()/commitCrime().
 *
 * RAM: bladeburner.inBladeburner 0 GB, bladeburner.getCurrentAction 1 GB,
 *      singularity.isBusy 0.5 GB, singularity.getOwnedAugmentations 5 GB.
 */

/** Are we in the Bladeburner division at all? (cheap, never throws) */
export function inBladeburner(ns: NS): boolean {
  return tryCall(() => ns.bladeburner.inBladeburner(), false);
}

/** Is a Bladeburner action currently running? */
export function bladeburnerBusy(ns: NS): boolean {
  if (!inBladeburner(ns)) return false;
  return tryCall(() => ns.bladeburner.getCurrentAction(), null) != null;
}

/** Do we own BladesSimulacrum, which lets work and Bladeburner coexist? */
export function hasBladesSimulacrum(ns: NS): boolean {
  return tryCall(() => ns.singularity.getOwnedAugmentations(true), []).includes("BladesSimulacrum");
}

/**
 * Would the player's current work cancel a Bladeburner action?
 * Returns false when we are not in the division or when BladesSimulacrum
 * lets work and Bladeburner run at the same time.
 */
export function wouldCancelBladeburner(ns: NS): boolean {
  if (!inBladeburner(ns)) return false;
  if (hasBladesSimulacrum(ns)) return false;
  return tryCall(() => ns.singularity.isBusy(), false);
}

/**
 * Is the player's time already claimed by one side of the conflict?
 *
 * The rule is symmetric: starting a job/crime/share while a Bladeburner action
 * is running cancels that action, and starting a Bladeburner action while the
 * player is working cancels it too. Modules that want to take over the player's
 * time call this before workForCompany()/workForFaction()/commitCrime()/share().
 *
 * No extra RAM: it reuses the same four calls listed above.
 */
export function workBladeburnerConflict(ns: NS): boolean {
  if (!inBladeburner(ns)) return false;
  if (hasBladesSimulacrum(ns)) return false;
  return bladeburnerBusy(ns) || tryCall(() => ns.singularity.isBusy(), false);
}

/**
 * Default configuration for the whole suite. Every module reads it through
 * loadConfig(), so a value set once in autobot_config.json or with a CLI flag
 * reaches every script.
 */
export const DEFAULT_CONFIG: Record<string, number | boolean | string> = {
  // Scheduler
  interval: 10000,
  graceMs: 30000,
  maxAttempts: 3,
  attemptWindowMs: 900000,
  // Focus
  focusEnabled: true,
  // Spending
  reserveFraction: 0.25,
  // Progression
  ascendEnabled: false,
  ascendBatch: 5,
  // Subsystems
  gang: true,
  sleeves: true,
  bladeburner: true,
  corporation: true,
  stock: true,
  stanek: true,
  go: true,
  infiltration: false,
  darknet: true,
  casino: false,
  contracts: false,
  share: true,
  crime: true,
  jobs: true,
  factions: true,
  hacknet: true,
  hacking: true,
};

/**
 * Layered configuration: defaults < autobot_config.json < CLI arguments.
 *
 * CLI wins because it is the most immediate signal, and a flag that is not
 * recognised is still returned in `extra` so the caller can use it.
 */
export function loadConfig(ns: NS, args: string[]): Record<string, number | boolean | string> {
  const config: Record<string, number | boolean | string> = { ...DEFAULT_CONFIG };

  try {
    const raw = ns.read("autobot_config.json");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
            config[key] = value;
          }
        }
      }
    }
  } catch {
    // A malformed config file is ignored rather than crashing the scheduler.
  }

  const extra: Record<string, string> = {};

  for (const arg of args) {
    if (!arg.startsWith("--")) continue;
    const body = arg.slice(2);
    if (body === "") continue;

    const eq = body.indexOf("=");
    const key = eq === -1 ? body : body.slice(0, eq);
    const rawValue = eq === -1 ? "true" : body.slice(eq + 1);

    if (key in DEFAULT_CONFIG) {
      const numeric = Number(rawValue);
      if (!Number.isNaN(numeric)) {
        config[key] = numeric;
      } else if (rawValue === "true" || rawValue === "false") {
        config[key] = rawValue === "true";
      } else {
        config[key] = rawValue;
      }
    } else {
      extra[key] = rawValue;
    }
  }

  config.__extra = JSON.stringify(extra);
  return config;
}

/** Read one config value with a fallback. */
export function configValue(
  config: Record<string, number | boolean | string>,
  key: string,
  fallback: number | boolean | string,
): number | boolean | string {
  const value = config[key];
  return value === undefined ? fallback : value;
}

/** True when a boolean config flag is on. */
export function configOn(
  config: Record<string, number | boolean | string>,
  key: string,
  fallback = true,
): boolean {
  const value = config[key];
  if (value === undefined) return fallback;
  return value === true || value === 1 || value === "true";
}

/**
 * Ask the scheduler whether this activity currently has the player's focus.
 *
 * autobot.ts writes state_focus.json on home and scp's it to every server it
 * places a module on, so a module on n0006 can read the same decision home
 * made. When the file is missing or stale the module is allowed to run, which
 * keeps a scheduler hiccup from switching the whole suite off.
 */
export function focusAllowed(ns: NS, activity: string): boolean {
  const focus = state.readObject(ns, "focus");
  if (!focus) return true;

  const allowed = focus.allowed;
  if (!Array.isArray(allowed)) return true;
  if (allowed.map((value) => String(value)).includes(activity)) return true;

  const muted = Array.isArray(focus.muted) ? focus.muted : [];
  const entry = muted.find((item) => typeof item === "object" && String((item as Record<string, unknown>).activity) === activity);
  if (entry) focusMutedReason = String((entry as Record<string, unknown>).reason ?? "");

  return false;
}

/** The reason the last focusAllowed() call returned false, for module logging. */
let focusMutedReason = "";

export function focusMutedReasonOf(): string {
  return focusMutedReason;
}

