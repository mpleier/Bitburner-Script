/**
 * hacknet.ts
 * ============================================================================
 * Buys and upgrades Hacknet Nodes, or Hacknet Servers when you have
 * Source-File 8, and spends hash on the useful hash upgrades.
 *
 * RAM cost (GB): base 1.6 + 12 hacknet calls * 0.5 = ~7.6 GB
 *
 * Usage
 *   run hacknet.ts
 *   run hacknet.ts --max-nodes 20 --spend-hashes
 */

import type { NS } from "../defs.d";

export async function main(ns: NS): Promise<void> {
  ns.clearLog();
  ns.disableLog("ALL");

  const args = ns.args.map(String);
  const dryRun = args.includes("--dry-run");
  const interval = Number(flagOr(args, "--interval", 2000));
  const maxNodes = Number(flagOr(args, "--max-nodes", 200));
  const spendHashes = !args.includes("--no-hashes");

  ns.print("=== hacknet module ===");

  while (true) {
    const cash = ns.getPlayer().money;
    const nodes = ns.hacknet.numNodes();
    const cap = Math.min(ns.hacknet.maxNumNodes(), maxNodes);

    // 1. Buy nodes while the next one is cheap relative to our bankroll.
    while (nodes < cap) {
      const cost = ns.hacknet.getPurchaseNodeCost();
      if (cost <= 0 || cash > cost * 3) {
        if (!dryRun) ns.hacknet.purchaseNode();
        nodes += 1;
      } else break;
    }

    // 2. Upgrade every node. Only spend money when the upgrade is a
    //    small slice of the bankroll and the node is not maxed.
    for (let i = 0; i < nodes; ++i) {
      const stats = ns.hacknet.getNodeStats(i);

      const levelCost = ns.hacknet.getLevelUpgradeCost(i, 1);
      if (levelCost > 0 && levelCost < cash / 20 && stats.level < 1000) {
        if (!dryRun) ns.hacknet.upgradeLevel(i, 1);
      }

      const ramCost = ns.hacknet.getRamUpgradeCost(i, 1);
      if (ramCost > 0 && ramCost < cash / 25 && stats.ram < 64) {
        if (!dryRun) ns.hacknet.upgradeRam(i, 1);
      }

      const coreCost = ns.hacknet.getCoreUpgradeCost(i, 1);
      if (coreCost > 0 && coreCost < cash / 30 && stats.core < 16) {
        if (!dryRun) ns.hacknet.upgradeCore(i, 1);
      }

      const cacheCost = ns.hacknet.getCacheUpgradeCost(i, 1);
      if (cacheCost > 0 && cacheCost < cash / 30) {
        if (!dryRun) ns.hacknet.upgradeCache(i, 1);
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
            ns.print(`spent ${cost} hash on ${upg} (level ${level + 1})`);
            break;
          }
        }
      }
    }

    ns.print(`nodes: ${nodes}/${cap}, hash: ${ns.hacknet.numHashes()}/${ns.hacknet.hashCapacity()}`);
    await ns.sleep(interval);
  }
}

function flagOr(args: string[], name: string, fallback: number): number {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? Number(args[i + 1]) : fallback;
}
