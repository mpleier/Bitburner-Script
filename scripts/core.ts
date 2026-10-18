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
 * this file add ~2.85 GB to every module that imports it.
 *
 * Flags understood by every module:
 *   --dry-run     make no state-changing calls, just report what would happen
 *   --verbose     extra logging
 *   --interval N  milliseconds between loops (default 1000)
 */

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
  const free = ns.getServerMaxRam(host) - ns.getServerUsedRam(host);
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

/** Every reachable server we already have root on. */
export function rootedServers(ns: NS): string[] {
  return discover(ns).filter((h) => ns.hasRootAccess(h));
}

/** Biggest rooted server that can hold `ram` GB, or null. */
export function bestRootedServer(ns: NS, ram: number): string | null {
  let best: string | null = null;
  let bestFree = 0;
  for (const host of rootedServers(ns)) {
    const free = ns.getServerMaxRam(host) - ns.getServerUsedRam(host);
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
  if (ns.hasRootAccess(host)) return true;
  const owned = ownedPrograms(ns);
  const needed = ns.getServerNumPortsRequired(host);
  if (portsWeCanOpen(ns, owned) < needed) return false;

  if (dryRun) return true;

  for (const p of PORT_OPENERS) {
    if (!owned.has(p.file)) continue;
    if (!p.open(ns, host)) return false;
  }
  return ns.nuke(host);
}

/** Servers we could root right now (level + programs), not yet rooted. */
export function rootableServers(ns: NS): string[] {
  const owned = ownedPrograms(ns);
  const level = ns.getHackingLevel();
  return discover(ns).filter(
    (h) =>
      !ns.hasRootAccess(h) &&
      ns.getServerRequiredHackingLevel(h) <= level &&
      ns.getServerNumPortsRequired(h) <= portsWeCanOpen(ns, owned),
  );
}

/** Copy a file to every rooted server that has room for it. */
export function distribute(ns: NS, files: string[], minRam = 8): void {
  for (const host of rootedServers(ns)) {
    if (ns.getServerMaxRam(host) < minRam) continue;
    ns.scp(files, host, "home");
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
