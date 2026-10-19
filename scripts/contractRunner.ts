/**
 * contractRunner.ts
 * ============================================================================
 * Automated Coding Contract solver for Bitburner.
 *
 * What it does
 *   1. BFS-scans the network from `home` to find every reachable server.
 *   2. Lists every *.cct file on each server.
 *   3. Solves and submits every contract it can. The Coding Contract API does NOT
 *      require admin rights, so contracts on servers you cannot root are still solved.
 *      Pass --open-ports to additionally open ports + NUKE those servers.
 *   4. Solves the contract with the solvers in contracts.ts and submits it.
 *
 * RAM cost (GB), straight from the official RamCostGenerator:
 *   base 1.6 | scan 0.2 | ls 0.2 | getHostname 0.05 | getServer 2
 *   getServerMaxRam 0.05 | getContractType 5 | getData 5 | getNumTriesRemaining 2
 *   attempt 10 | nuke 0.05 | brutessh 0.05 | ftpcrack 0.05 | relaysmtp 0.05
 *   httpworm 0.05 | sqlinject 0.05 | exec 1.3 | scp 0.6 | sleep/print/tprint 0
 *   dynamicImport 0  -> contracts.ts itself costs 0 RAM
 *   => ~29 GB worst case. If the current server cannot hold that, the script
 *      copies itself to the biggest server you already have root on and runs there.
 *
 * Usage
 *   node contractRunner.ts                          # solve everything reachable
 *   node contractRunner.ts --dry-run                # print answers, submit nothing
 *   node contractRunner.ts --host CSEC              # only one server
 *   node contractRunner.ts --selftest               # verify the solvers, then exit
 *   node contractRunner.ts --loop --interval 30000  # keep rescanning
 *   node contractRunner.ts --max 50                 # stop after N contracts
 *   node contractRunner.ts --open-ports             # also open ports + NUKE for hacking
 *
 * Output
 *   Everything is appended to the log file (autobot_log.txt, or --log <file>) on
 *   the server the script runs on; nothing is tprinted. Read it with:
 *     run install.js --logs 30
 *   or, from the game terminal on that server:
 *     cat autobot_log.txt
 *   --verbose mirrors the log to the terminal as well. The only terminal lines
 *   are the one-time "contracts.ts missing" / "not enough RAM" warnings and the
 *   result of an explicit --selftest, so an autobot-driven restart of this
 *   module never spams the console.
 */

/**
 * Type-only import: erased by the transpiler, so it is safe both in-game
 * (where `NS` is provided globally) and for local `tsc` checks.
 */
// Bitburner injects its API typings as a global declaration file, so `NS`
// needs no import (globals.d.ts mirrors that for local `tsc` checks).

type Solvers = {
  solve: (type: string, data: unknown) => unknown;
  selfTest: () => string[];
  supportedTypes: () => string[];
};

import * as logger from "./logger.ts";

/** Worst-case RAM the script needs (see header). */
const RAM_NEEDED = 29;



export async function main(ns: NS): Promise<void> {
  ns.clearLog();
  ns.disableLog("ALL");

  const args = ns.args.map(String);
  const dryRun = args.includes("--dry-run");
  const loop = args.includes("--loop");
  const onlyHost = flagValue(args, "--host");
  const interval = Number(flagValue(args, "--interval") ?? 30000);
  const maxContracts = Number(flagValue(args, "--max") ?? 1000);
  const openPorts = args.includes("--open-ports");

  const currentServer = ns.getHostname();

  // contracts.ts is dynamically imported: 0 GB RAM.
  if (!ns.ls(currentServer, "contracts.ts").length) {
    logger.tlogOnce(ns, "Error: contracts.ts must be on the same server as contractRunner.ts");
    return;
  }
  const solvers: Solvers = await ns.dynamicImport("./contracts.ts");

  if (args.includes("--selftest")) {
    const failures = solvers.selfTest();
    logger.tlog(ns, failures.length ? `Solver self-test FAILED:\n${failures.join("\n")}` : "Solver self-test: all passed");
    return;
  }

  // A 26 GB script will not fit on a 8 GB home server early on.
  if (ns.getServerMaxRam(currentServer) < RAM_NEEDED) {
    const host = richestRootedServer(ns, RAM_NEEDED);
    if (host && host !== currentServer) {
      ns.scp("contracts.ts", host);
      ns.scp("contractRunner.ts", host);
      ns.exec("contractRunner.ts", host, 1, ...args);
      logger.tlogOnce(ns, `Relocated to ${host} (needs ${RAM_NEEDED} GB, ${host} has ${ns.getServerMaxRam(host)} GB)`);
      return;
    }
    logger.tlogOnce(ns, `Not enough RAM on ${currentServer} (${ns.getServerMaxRam(currentServer)} GB < ${RAM_NEEDED} GB) and no rooted server is big enough.`);
    return;
  }

  const supported = new Set(solvers.supportedTypes());
  const allTypes = ns.codingcontract.getContractTypes();
  const unsupportedTypes = allTypes.filter((t) => !supported.has(t));
  if (unsupportedTypes.length) logger.log(ns, `No solver for: ${unsupportedTypes.join(", ")}`);

  let round = 0;
  while (true) {
    round++;
    const hosts = onlyHost ? [onlyHost] : discover(ns);
    logger.log(ns, `Round ${round}: ${hosts.length} servers reachable`);

    let found = 0;
    let solved = 0;
    let failed = 0;
    let skippedUnsupported = 0;
    let rootFailed = 0;

    for (const host of hosts) {
      if (found >= maxContracts) break;

      const files = ns.ls(host, ".cct");
      if (files.length === 0) continue;

      const contracts: Array<{ fn: string; type: string }> = [];
      for (const fn of files) {
        const type = ns.codingcontract.getContractType(fn, host);
        if (supported.has(type)) contracts.push({ fn, type });
        else skippedUnsupported++;
      }
      if (contracts.length === 0) continue;

      // Root is NOT required by the Coding Contract API, so we solve contracts on
      // servers we cannot root. Only open ports when the user asked for it.
      if (openPorts && !gainRoot(ns, host)) {
        rootFailed++;
        logger.log(ns, `[root] ${host}: could not gain root (${contracts.length} contracts)`);
      }

      for (const { fn, type } of contracts) {
        if (found >= maxContracts) break;
        found++;
        const tries = ns.codingcontract.getNumTriesRemaining(fn, host);
        if (tries <= 0) {
          logger.log(ns, `[skip] ${host}/${fn}: no attempts left`);
          continue;
        }


        const data = ns.codingcontract.getData(fn, host);

        let answer: unknown;
        try {
          answer = solvers.solve(type, data);
        } catch (err) {
          failed++;
          logger.log(ns, `[error] ${host}/${fn} (${type}): ${err instanceof Error ? err.message : String(err)}`);
          continue;
        }

        if (dryRun) {
          logger.log(ns, `[dry] ${host}/${fn} (${type}) -> ${fmt(answer)}`);
          continue;
        }

        const reward = ns.codingcontract.attempt(answer, fn, host);
        if (reward) {
          solved++;
          logger.log(ns, `[solved] ${host}/${fn} (${type}) -> ${fmt(answer)} | ${reward}`);
        } else {
          failed++;
          logger.log(ns, `[failed] ${host}/${fn} (${type}) -> ${fmt(answer)}`);
        }
      }
    }

    logger.log(ns,
      `Round ${round}: ${found} contracts | ${solved} solved | ${failed} failed | ` +
        `${skippedUnsupported} unsupported | ${rootFailed} not rootable`,
    );

    if (!loop) break;
    await ns.sleep(interval);
  }
}

// ============================================================================
// Helpers
// ============================================================================

/** BFS from home over ns.scan() -> every server we can reach. */
function discover(ns: NS): string[] {
  const seen = new Set<string>();
  const queue: string[] = ["home"];

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

/** ns.getServer() that returns null instead of throwing for an unreachable host. */
function getServerSafe(ns: NS, host: string): any {
  try {
    return ns.getServer(host);
  } catch {
    return null;
  }
}

/**
 * Open as many ports as the programs you own allow, then NUKE.exe.
 * Returns true when the server ends up with root access.
 * Note: NUKE needs *all* required ports open, and ports that are already open
 * count towards that requirement.
 */
function gainRoot(ns: NS, host: string): boolean {
  if (host === "home") return true;

  // Hacknet nodes report admin rights but are not Server objects: brutessh(),
  // nuke() and friends all throw on them ("The server must not be a hacknet
  // server"), so there is nothing to do here.
  if (host.startsWith("hacknet-server-") || host.startsWith("hacknet-node-")) return false;

  const server = getServerSafe(ns, host);
  if (!server) return false;
  if (server.hasAdminRights) return true;

  const required = server.numOpenPortsRequired ?? 0;
  const openers: Array<[boolean, string, (h: string) => boolean]> = [
    [server.sshPortOpen, "BruteSSH.exe", (h) => ns.brutessh(h)],
    [server.ftpPortOpen, "FTPCrack.exe", (h) => ns.ftpcrack(h)],
    [server.smtpPortOpen, "relaySMTP.exe", (h) => ns.relaysmtp(h)],
    [server.httpPortOpen, "HTTPWorm.exe", (h) => ns.httpworm(h)],
    [server.sqlPortOpen, "SQLInject.exe", (h) => ns.sqlinject(h)],
  ];

  let openPorts = 0;
  for (const [isOpen, program, run] of openers) {
    if (isOpen) {
      openPorts++;
      continue;
    }
    // Each opener can throw (no singularity access, server went offline).
    let opened = false;
    try {
      opened = run(host);
    } catch (err) {
      logger.log(ns, `[root] ${host}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!opened) {
      logger.log(ns, `[root] ${host}: do not own ${program}`);
      continue;
    }
    openPorts++;
  }

  if (openPorts < required) return false;
  try {
    return ns.nuke(host);
  } catch (err) {
    logger.log(ns, `[root] ${host}: nuke failed (${err instanceof Error ? err.message : String(err)})`);
    return false;
  }
}

/** Biggest server we already have root on that can hold `ram` GB. */
function richestRootedServer(ns: NS, ram: number): string | null {
  let best: string | null = null;
  let bestRam = 0;
  for (const host of discover(ns)) {
    const server = getServerSafe(ns, host);
    if (!server) continue;
    if (server.hasAdminRights && server.maxRam >= ram && server.maxRam > bestRam) {
      best = host;
      bestRam = server.maxRam;
    }
  }
  return best;
}

/** Compact, readable rendering of an answer for the log. */
function fmt(answer: unknown): string {
  if (answer === null || answer === undefined) return "null";
  if (typeof answer === "bigint") return `${answer}n`;
  if (typeof answer === "string") return answer.length > 60 ? `${answer.slice(0, 60)}…` : answer;
  const s = JSON.stringify(answer, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  return s.length > 80 ? `${s.slice(0, 80)}…` : s;
}

/** `--name value` -> value, or undefined when the flag is absent. */
function flagValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

