/**
 * infiltration.ts
 * ============================================================================
 * Infiltration advisor. The game has no API to *perform* an infiltration (it
 * is a minigame you have to play by hand), so this module does the useful part
 * automatically: it scores every location in the world against your current
 * stats and tells you which one is worth the time, and which clearance level
 * you should aim for.
 *
 * RAM cost (GB):
 *   base 1.6 | getPossibleLocations 0 | getInfiltration 15
 *   getPlayer 0.5 | getStat 0.05 | getServerMaxRam 0.05 | getHostname 0.05
 *   => ~18 GB
 *
 * Usage
 *   run infiltration.ts
 *   run infiltration.ts --top 10 --rep-only
 */

// Bitburner injects its API typings as a global declaration file, so `NS`
// needs no import (globals.d.ts mirrors that for local `tsc` checks).

const RAM_NEEDED = 18;

export async function main(ns: NS): Promise<void> {
  ns.clearLog();
  ns.disableLog("ALL");

  const args = ns.args.map(String);
  const core = await ns.dynamicImport("./core.ts");
  const loops = core.maxLoops(args);
  const top = core.numOr(args, "--top", 10);
  const repOnly = args.includes("--rep-only");
  const host = ns.getHostname();

  if (ns.getServerMaxRam(host) < RAM_NEEDED) {
    ns.print(`infiltration.ts needs ${RAM_NEEDED} GB; ${host} has ${ns.getServerMaxRam(host)} GB.`);
    return;
  }

  ns.print("=== infiltration module ===");

  for (let loop = 0; loop < loops; ++loop) {
    const stats = core.stats(ns);
    const locations = ns.infiltration.getPossibleLocations();

    const scored: Array<{ name: string; city: string; value: number; difficulty: number; reward: any; doable: boolean }> = [];

    for (const loc of locations) {
      const data = ns.infiltration.getInfiltration(loc.name);
      const reward = data.reward;

      const value = repOnly
        ? reward.tradeRep * 1000 + reward.SoARep * 20000
        : reward.sellCash + reward.tradeRep * 1000 + reward.SoARep * 20000;

      // Infiltration difficulty is dominated by the security level, which you
      // beat with dexterity/agility/strength; clearance level needs intelligence.
      const doable =
        data.startingSecurityLevel <= stats.dexterity + stats.agility &&
        data.maxClearanceLevel <= stats.intelligence;

      scored.push({
        name: loc.name,
        city: loc.city,
        value: value / Math.max(1, data.difficulty),
        difficulty: data.difficulty,
        reward,
        doable,
      });
    }

    scored.sort(
      (a, b) => (Number(b.doable) - Number(a.doable)) || (b.value - a.value),
    );

    ns.print(`--- best infiltration targets (${scored.length} locations) ---`);
    for (let i = 0; i < Math.min(top, scored.length); ++i) {
      const s = scored[i];
      ns.print(
        `${i + 1}. ${s.name} (${s.city}) | value ${core.fmt(s.value)} | difficulty ${s.difficulty} | ` +
          `rep ${s.reward.tradeRep} | cash ${core.fmt(s.reward.sellCash)} | SoA ${s.reward.SoARep} | ` +
          `${s.doable ? "doable" : "stats too low"}`,
      );
    }

    await ns.sleep(30000);
  }
}