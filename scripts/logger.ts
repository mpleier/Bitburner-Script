/**
 * logger.ts
 * ============================================================================
 * Every module appends its output to a text file on the server it runs on
 * instead of flooding the terminal.
 *
 * RAM cost (GB), straight from RamCostGenerator.ts:
 *   write 0 | read 0 | getHostname 0.05  =>  0.05 GB
 * A static import of this file therefore adds only 0.05 GB to a module's
 * budget, which is why it is a separate file instead of living in core.ts
 * (core.ts costs ~9.7 GB and contractRunner.ts/share.ts deliberately avoid it).
 *
 * Two constraints from the game:
 *   - ns.write() only accepts .txt, .json and .css (defs.d.ts -> write(),
 *     src/Paths/TextFilePath.ts). "autobot.log" is an invalid path.
 *   - ns.write() always targets the server the script is running on
 *     (ctx.workerScript.getServer()), so each rooted server keeps its own
 *     copy of the log. Read it in the game terminal with:
 *       cat autobot_log.txt
 *
 * Flags understood by every module:
 *   --log <file>   log file name (".txt" is added if missing)
 *   --verbose      mirror the log to the terminal as well
 *   --print        alias for --verbose
 *   --no-log       keep everything on the terminal only
 */

// Bitburner injects its API typings as a global declaration file, so `NS`
// needs no import (globals.d.ts mirrors that for local `tsc` checks).

/** Default log file, on whatever server the script is running on. */
export const LOG_FILE = "autobot_log.txt";

/** Characters kept in the log; older lines are dropped once it grows past this. */
export const LOG_LIMIT = 60_000;

/** Rough size of the file we have written so far, used to decide when to trim. */
let trackedChars = 0;
let writesSinceTrim = 0;

function hasFlag(ns: NS, name: string): boolean {
  return (ns.args ?? []).some((a) => String(a) === name);
}

/** The log file this script writes to, honouring `--log <file>`. */
export function logFile(ns: NS): string {
  const args = (ns.args ?? []).map(String);
  const i = args.indexOf("--log");
  const raw = i >= 0 && i + 1 < args.length ? args[i + 1] : LOG_FILE;
  // ns.write() rejects anything that is not a text file or a script.
  return /\.(txt|json|css)$/i.test(raw) ? raw : raw + ".txt";
}

/** "2026-10-18 14:03:07" - Date is available inside the Netscript sandbox. */
function stamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function join(parts: unknown[]): string {
  return parts.map((p) => (p === null || p === undefined ? "" : String(p))).join(" ");
}

/** Drop the oldest lines so the log never grows without bound. */
export function trimLog(ns: NS): void {
  const file = logFile(ns);
  try {
    const all = ns.read(file);
    if (all.length > LOG_LIMIT) {
      ns.write(file, all.slice(all.length - LOG_LIMIT), "w");
      trackedChars = LOG_LIMIT;
    }
  } catch {
    trackedChars = 0;
  }
}

/**
 * Append one line to the log file. Never throws: if the write fails the line
 * is printed to the terminal instead, so a script never dies over logging.
 */
export function log(ns: NS, ...parts: unknown[]): void {
  const text = join(parts);

  if (hasFlag(ns, "--no-log")) {
    ns.print(text);
    return;
  }

  const file = logFile(ns);
  const line = `[${stamp()}] ${ns.getHostname()} ${text}\n`;

  try {
    ns.write(file, line, "a");
    trackedChars += line.length;
    writesSinceTrim += 1;
    if (trackedChars > LOG_LIMIT || writesSinceTrim >= 200) {
      trimLog(ns);
      writesSinceTrim = 0;
    }
  } catch (err) {
    ns.print(`could not write ${file}: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (hasFlag(ns, "--verbose") || hasFlag(ns, "--print")) ns.print(text);
}

/** Log *and* tprint: for milestones and fatal problems the player must see. */
export function tlog(ns: NS, ...parts: unknown[]): void {
  const text = join(parts);
  log(ns, text);
  ns.tprint(text);
}

/** The last `lines` entries of the log as a string ("" when there is none). */
export function tail(ns: NS, lines = 40): string {
  try {
    return ns
      .read(logFile(ns))
      .split("\n")
      .filter((l) => l.trim())
      .slice(-lines)
      .join("\n");
  } catch {
    return "";
  }
}

/** How many characters the log currently holds (best effort). */
export function logSize(ns: NS): number {
  try {
    return ns.read(logFile(ns)).length;
  } catch {
    return 0;
  }
}
