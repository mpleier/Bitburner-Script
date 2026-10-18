/**
 * contractRunner.ts
 * ============================================================================
 * Automated Coding Contract solver for Bitburner.
 *
 * What it does
 *   1. BFS-scans the network from `home` to find every reachable server.
 *   2. Lists every *.cct file on each server.
 *   3. Gains root access (open ports with the programs you own, then NUKE.exe).
 *   4. Solves the contract with the solvers in contracts.ts and submits it.
 *
 * RAM cost (GB), straight from the official RamCostGenerator:
 *   scan 0.2 | ls 0.2 | getContractType 5 | getData 5 | attempt 10
 *   nuke 1 | brutessh 1 | ftpcrack 1 | relaysmtp 1 | httpworm 1 | sqlinject 1
 *   dynamicImport 0  -> contracts.ts itself costs 0 RAM
 *   => ~25.4 GB worst case. If the current server cannot hold that, the script
 *      copies itself to the biggest server you already have root on and runs there.
 *
 * Usage
 *   node contractRunner.ts                          # solve everything reachable
 *   node contractRunner.ts --dry-run                # print answers, submit nothing
 *   node contractRunner.ts --host CSEC              # only one server
 *   node contractRunner.ts --selftest               # verify the solvers, then exit
 *   node contractRunner.ts --loop --interval 30000  # keep rescanning
 *   node contractRunner.ts --max 50                 # stop after N contracts
 */

type Solvers = {
  solve: (type: string, data: unknown) => unknown;
  selfTest: () => string[];
  supportedTypes: () => string[];
};

/** Worst-case RAM the script needs (see header). */
const RAM_NEEDED = 26;

export async function main(ns: NS): Promise<void> {
  ns.clearLog();
  ns.disableLog("ALL");

  const args = ns.args.map(String);
  const dryRun = args.includes("--dry-run");
  const loop = args.includes("--loop");
  const onlyHost = flagValue(args, "--host");
  const interval = Number(flagValue(args, "--interval") ?? 30000);
  const maxContracts = Number(flagValue(args, "--max") ?? 1000);

  // contracts.ts is dynamically imported: 0 GB RAM.
  if (!ns.ls(ns.hostname, "contracts.ts").length) {
    ns.tprint("Error: contracts.ts must be on the same server as contractRunner.ts");
    return;
  }
  const solvers: Solvers = await ns.dynamicImport("./contracts.ts");

  if (args.includes("--selftest")) {
    const failures = solvers.selfTest();
    ns.tprint(failures.length ? `Solver self-test FAILED:\n${failures.join("\n")}` : "Solver self-test: all passed");
    return;
  }

  // A 26 GB script will not fit on a 8 GB home server early on.
  if (ns.getServerMaxRam(ns.hostname) < RAM_NEEDED) {
    const host = richestRootedServer(ns, RAM_NEEDED);
    if (host && host !== ns.hostname) {
      ns.copy("./contracts.ts", host);
      ns.copy("./contractRunner.ts", host);
      ns.exec("./contractRunner.ts", host, 1, ...args);
      ns.tprint(`Relocated to ${host} (needs ${RAM_NEEDED} GB, ${host} has ${ns.getServerMaxRam(host)} GB)`);
      return;
    }
    ns.tprint(`Not enough RAM on ${ns.hostname} (${ns.getServerMaxRam(ns.hostname)} GB < ${RAM_NEEDED} GB) and no rooted server is big enough.`);
    return;
  }

  const supported = new Set(solvers.supportedTypes());
  const allTypes = ns.codingcontract.getContractTypes();
  const unsupportedTypes = allTypes.filter((t) => !supported.has(t));
  if (unsupportedTypes.length) ns.log(`No solver for: ${unsupportedTypes.join(", ")}`);

  let round = 0;
  while (true) {
    round++;
    const hosts = onlyHost ? [onlyHost] : discover(ns);
    ns.log(`Round ${round}: ${hosts.length} servers reachable`);

    let found = 0;
    let solved = 0;
    let failed = 0;
    let skippedUnsupported = 0;
    let skippedNoRoot = 0;

    for (const host of hosts) {
      if (found >= maxContracts) break;

      const files = ns.ls(host, ".cct");
      if (files.length === 0) continue;

      // Only bother opening ports if there is actually something to solve here.
      const solvableHere = files.filter((f) => supported.has(ns.codingcontract.getContractType(f, host)));
      if (solvableHere.length === 0) {
        skippedUnsupported += files.length;
        continue;
      }

      if (!dryRun && !gainRoot(ns, host)) {
        ns.log(`[skip] ${host}: cannot gain root (${files.length} contracts)`);
        skippedNoRoot += files.length;
        continue;
      }

      for (const fn of solvableHere) {
        if (found >= maxContracts) break;
        found++;

        const type = ns.codingcontract.getContractType(fn, host);
        const data = ns.codingcontract.getData(fn, host);

        let answer: unknown;
        try {
          answer = solvers.solve(type, data);
        } catch (err) {
          failed++;
          ns.log(`[error] ${host}/${fn} (${type}): ${err instanceof Error ? err.message : String(err)}`);
          continue;
        }

        if (dryRun) {
          ns.log(`[dry] ${host}/${fn} (${type}) -> ${fmt(answer)}`);
          continue;
        }

        const reward = ns.codingcontract.attempt(answer, fn, host);
        if (reward) {
          solved++;
          ns.log(`[solved] ${host}/${fn} (${type}) -> ${fmt(answer)} | ${reward}`);
        } else {
          failed++;
          ns.log(`[failed] ${host}/${fn} (${type}) -> ${fmt(answer)}`);
        }
      }
    }

    ns.tprint(
      `Round ${round}: ${found} contracts | ${solved} solved | ${failed} failed | ` +
        `${skippedUnsupported} unsupported | ${skippedNoRoot} unreachable`,
    );

    if (!loop) break;
    await ns.sleep(interval);
  }
}
