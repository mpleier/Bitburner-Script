/**
 * hacknet.ts
 * ============================================================================
 * Buys and upgrades Hacknet Nodes, or Hacknet Servers when you have
 * Source-File 8, and spends hash on the useful hash upgrades.
 *
 * RAM cost (GB): base 1.6 + 12 hacknet calls * 0.5 + core.ts helpers = ~14.3 GB
 *
 * Usage
 *   run hacknet.ts
 *   run hacknet.ts --max-nodes 20 --spend-hashes
 */

// Bitburner injects its API typings as a global declaration file, so `NS`
// needs no import (globals.d.ts mirrors that for local `tsc` checks).

// core.ts is imported statically on purpose. Bitburner's RAM allocation is
// computed from the AST of the script and everything it *statically* imports;
// ns.dynamicImport() is invisible to that pass, so the API calls core.ts makes
// would not be paid for and the game would abort the script with a RAM error.
import * as core from "./core.ts";
import * as logger from "./logger.ts";
// spending-policy.ts makes no API calls, so importing it costs only the 1.6 GB
// base script cost, and it keeps every subsystem's slice of the bankroll in one
// place instead of each module inventing its own "spend a fifth of the money"
// rule.
import * as spending from "./spending-policy.ts";


/** GB of RAM Bitburner allocates for this script. */
const RAM_NEEDED = 24;

export async function main(ns: NS): Promise<void> {
  ns.clearLog();
  ns.disableLog("ALL");

  const args = ns.args.map(String);
  const dryRun = args.includes("--dry-run");
  const interval = Number(flagOr(args, "--interval", 2000));
  const maxNodes = Number(flagOr(args, "--max-nodes", 200));
  const spendHashes = !args.includes("--no-hashes");
  const loops = core.maxLoops(args);

  logger.log(ns, "=== hacknet module ===");

  for (let loop = 0; loop < loops; ++loop) {
    const cash = ns.getPlayer().money;
    let nodes = ns.hacknet.numNodes();
    const cap = Math.min(ns.hacknet.maxNumNodes(), maxNodes);

    /* Shared money budget: hacknet gets its own slice of the bankroll so buying
       200 nodes does not starve the gang, the corporation or the aug shop.
       `spent` is tracked locally because ns.getPlayer().money only moves when
       the game actually charges us (it never moves in --dry-run). */
    const budget = spending.allowance(cash, "hacknet");
    let spent = 0;
    const affordable = (cost: number) => cost > 0 && spent + cost <= budget;

    // 1. Buy nodes while the next one is affordable and still a small slice of
    //    the bankroll (the 3x rule keeps the ROI sane).
    while (nodes < cap) {
      const cost = ns.hacknet.getPurchaseNodeCost();
      if (!affordable(cost) || cash - spent <= cost * 3) break;
      if (!dryRun) ns.hacknet.purchaseNode();
      spent += cost;
      nodes += 1;
    }

    // 2. Upgrade every node. Only spend money when the upgrade is a
    //    small slice of the bankroll and the node is not maxed.
    for (let i = 0; i < nodes; ++i) {
      const stats = ns.hacknet.getNodeStats(i);
      if (!stats) continue;

      const levelCost = ns.hacknet.getLevelUpgradeCost(i, 1);
      if (affordable(levelCost) && levelCost < cash / 20 && stats.level < 1000) {
        if (!dryRun) ns.hacknet.upgradeLevel(i, 1);
        spent += levelCost;
      }

      const ramCost = ns.hacknet.getRamUpgradeCost(i, 1);
      if (affordable(ramCost) && ramCost < cash / 25 && stats.ram < 64) {
        if (!dryRun) ns.hacknet.upgradeRam(i, 1);
        spent += ramCost;
      }

      const coreCost = ns.hacknet.getCoreUpgradeCost(i, 1);
      if (affordable(coreCost) && coreCost < cash / 30 && stats.cores < 16) {
        if (!dryRun) ns.hacknet.upgradeCore(i, 1);
        spent += coreCost;
      }

      const cacheCost = ns.hacknet.getCacheUpgradeCost(i, 1);
      if (affordable(cacheCost) && cacheCost < cash / 30) {
        if (!dryRun) ns.hacknet.upgradeCache(i, 1);
        spent += cacheCost;
      }
    }

    // 3. Hacknet Servers: convert hash into research / money / security.
    if (spendHashes) {
      const hashes = ns.hacknet.numHashes();
      if (hashes > 0) {
        const upgrades = ns.hacknet.getHashUpgrades();
        for (const upg of upgrades) {
          const level = ns.hacknet.getHashUpgradeLevel(upg);
          if (level >= 10) continue;
          const cost = ns.hacknet.hashCost(upg, 1);
          if (cost > 0 && hashes >= cost * 2) {
            if (!dryRun) ns.hacknet.spendHashes(upg);
            logger.log(ns, `spent ${cost} hash on ${upg} (level ${level + 1})`);
            break;
          }
        }
      }
    }

    logger.log(ns, `nodes: ${nodes}/${cap}, hash: ${ns.hacknet.numHashes()}/${ns.hacknet.hashCapacity()}`);
    await ns.sleep(interval);
  }
}

function flagOr(args: string[], name: string, fallback: number): number {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? Number(args[i + 1]) : fallback;
}
