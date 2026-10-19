/**
 * state.ts
 * ============================================================================
 * Shared, timestamped state files for the automation suite.
 *
 * Why this exists: every module in the suite is restarted by autobot.ts on
 * every interval, and a module that exits immediately (karma too high, no
 * money for a corporation, casino already banned) would otherwise be restarted
 * forever. A state file makes "what happened last time" survive the restart,
 * and the `expiresAt` guard makes sure a note left behind by a run from three
 * bitnodes ago cannot keep a subsystem switched off.
 *
 * Every file written here has the same shape:
 *
 *   { "at": 1730000000000, "pid": 42, "expiresAt": 1730000060000, "value": ... }
 *
 *   at        - ms timestamp when the record was written
 *   pid       - ns.pid of the script that wrote it (who owns the claim)
 *   expiresAt - ms timestamp after which the record is meaningless
 *   value     - whatever the module wants to remember
 *
 * RAM cost (GB), from the official RamCostGenerator:
 *   write 0 | read 0 | rm 0.6
 *   => 0.6 GB, which is why this file is safe to import everywhere.
 *
 * Note on scope: ns.write()/ns.read() always act on the server the script is
 * running on (ctx.workerScript.getServer()). A state file therefore lives on
 * one server. autobot.ts is the only module that sees the whole suite, so it
 * writes the coordination files on home and scp's them to every server it
 * places a module on - that is how a module on n0006 learns what home decided.
 *
 * Usage
 *   import * as state from "./state.ts";
 *   state.writeState(ns, "crime", { best: "Homicide" }, 60000);
 *   const best = state.readFresh(ns, "crime");   // null when missing or stale
 */

// Bitburner injects its API typings as a global declaration file, so `NS`
// needs no import (globals.d.ts mirrors that for local `tsc` checks).

/** Prefix of every state file, so they are easy to spot with `ls *.json`. */
export const STATE_PREFIX = "state_";

/** How long a record is considered valid when the caller does not say. */
export const DEFAULT_TTL_MS = 60_000;

/** The shape every state file has. */
export interface StateRecord {
  /** ms timestamp when the record was written */
  at: number;
  /** ns.pid of the script that wrote it */
  pid: number;
  /** ms timestamp after which the record is meaningless */
  expiresAt: number;
  /** whatever the module wants to remember */
  value: unknown;
}

/** "crime" -> "state_crime.json". Anything unsafe is turned into "_". */
export function stateFile(name: string): string {
  return `${STATE_PREFIX}${name}`.replace(/[^a-zA-Z0-9_-]/g, "_") + ".json";
}

/**
 * Write a record. Returns the record that was written, or null if the write
 * failed (ns.write() throws on an invalid path, which cannot happen here
 * because stateFile() always ends in .json).
 */
export function writeState(ns: NS, name: string, value: unknown, ttlMs = DEFAULT_TTL_MS): StateRecord | null {
  const at = Date.now();
  const record: StateRecord = {
    at,
    pid: Number(ns.pid ?? 0),
    expiresAt: at + Math.max(0, ttlMs),
    value,
  };
  try {
    ns.write(stateFile(name), JSON.stringify(record) + "\n", "w");
    return record;
  } catch {
    return null;
  }
}

/**
 * Read a record, or null when the file is missing or unreadable.
 *
 * A file that is not in the {at, pid, expiresAt, value} shape is still usable:
 * it is wrapped so that `expiresAt` is 0, i.e. treated as expired. That keeps
 * hand-written or legacy files from being mistaken for a live claim.
 */
export function readState(ns: NS, name: string): StateRecord | null {
  let raw = "";
  try {
    raw = ns.read(stateFile(name));
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (parsed === null || typeof parsed !== "object") return null;

  const obj = parsed as Record<string, unknown>;
  if (typeof obj.at === "number") {
    return {
      at: obj.at,
      pid: Number(obj.pid ?? 0),
      expiresAt: Number(obj.expiresAt ?? 0),
      value: obj.value,
    };
  }

  // Not our format: keep the payload but treat it as expired.
  return { at: 0, pid: 0, expiresAt: 0, value: obj };
}

/** True when there is no record, or the record's expiresAt has passed. */
export function isStale(ns: NS, name: string, nowMs = Date.now()): boolean {
  const record = readState(ns, name);
  return record === null || record.expiresAt <= nowMs;
}

/** The stored value, or null when the record is missing or stale. */
export function readFresh(ns: NS, name: string, nowMs = Date.now()): unknown | null {
  const record = readState(ns, name);
  if (!record || record.expiresAt <= nowMs) return null;
  return record.value;
}

/** Delete a state file. Returns true if ns.rm() succeeded. */
export function removeState(ns: NS, name: string): boolean {
  try {
    return ns.rm(stateFile(name));
  } catch {
    return false;
  }
}

/**
 * Try to take a lock for `name`.
 *
 * A claim succeeds when nobody holds it, when the holder's claim has expired,
 * or when we are the holder (in which case the claim is refreshed). It fails
 * when another live pid owns it.
 */
export function claim(
  ns: NS,
  name: string,
  ttlMs = DEFAULT_TTL_MS,
  nowMs = Date.now(),
): { ok: boolean; reason: string } {
  const record = readState(ns, name);
  const pid = Number(ns.pid ?? 0);

  if (!record) {
    writeState(ns, name, { claimedBy: pid }, ttlMs);
    return { ok: true, reason: "no previous claim" };
  }

  if (record.expiresAt <= nowMs) {
    writeState(ns, name, { claimedBy: pid }, ttlMs);
    return { ok: true, reason: "previous claim expired" };
  }

  if (record.pid === pid) {
    writeState(ns, name, { claimedBy: pid }, ttlMs);
    return { ok: true, reason: "claim already ours" };
  }

  return { ok: false, reason: `held by pid ${record.pid} until ${new Date(record.expiresAt).toISOString()}` };
}

/** Give up a lock. */
export function release(ns: NS, name: string): void {
  removeState(ns, name);
}

/**
 * Read a coordination file as an object, or null when it is missing or stale.
 *
 * autobot.ts publishes state_focus.json; every module reads it to find out
 * whether the scheduler granted it the player's attention.
 */
export function readObject(ns: NS, name: string, nowMs = Date.now()): Record<string, unknown> | null {
  const value = readFresh(ns, name, nowMs);
  if (value === null || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}
