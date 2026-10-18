/**
 * core.ts
 * ============================================================================
 * Shared helpers for the Bitburner automation suite.
 *
 * RAM cost: 0 GB. Scripts pulled in with ns.dynamicImport() add nothing to a
 * script's RAM usage, so every helper here is free.
 *
 * Every module in scripts/ imports this file with:
 *   const core = await ns.dynamicImport("./core.ts");
 *
 * Flags understood by every module:
 *   --dry-run     make no state-changing calls, just report what would happen
 *   --verbose     extra logging
 *   --interval N  milliseconds between loops (default 1000)
 */

import type { NS } from "../defs.d";

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

/** Port openers: ns function name <-> program file name. */
export const PORT_OPENERS: Array<{ file: string; fn: string }> = [
  { file: "BruteSSH.exe", fn: "brutessh" },
  { file: "FTPCrack.exe", fn: "ftpcrack" },
  { file: "relaySMTP.exe", fn: "relaysmtp" },
  { file: "HTTPWorm.exe", fn: "httpworm" },
  { file: "SQLInject.exe", fn: "sqlinject" },
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
    const open = ns[asKey(p.fn)](host);
    if (!open) return false;
  }
  return ns.nuke(host);
}

/** Cast a known API name to the NS index type without losing safety elsewhere. */
function asKey(s: string): keyof NS {
  return s as keyof NS;
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
