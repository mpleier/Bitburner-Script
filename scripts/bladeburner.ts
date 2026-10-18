/**
 * bladeburner.ts
 * ============================================================================
 * Bladeburner automation (BitNode 4 / Source-File 4):
 *   - joins the division
 *   - spends skill points in the order that pays off fastest
 *   - picks the action with the best expected rank per point of stamina
 *   - keeps action levels/teams at the maximum that still succeeds
 *   - moves to the city with the most chaos (operations scale with chaos)
 *   - regenerates stamina when it runs low
 *
 * RAM cost (GB), BladeburnerApiBase = 4:
 *   base 1.6 | joinBladeburnerDivision 4 | getRank 4 | getSkillPoints 4
 *   getSkillLevel 4 | getSkillUpgradeCost 4 | upgradeSkill 4
 *   getNextBlackOp 2 | getBlackOpRank 2 | getActionCountRemaining 4
 *   getActionEstimatedSuccessChance 4 | getActionRankGain 4 | getActionRepGain 4
 *   getActionTime 4 | getActionCurrentLevel 4 | getActionMaxLevel 4
 *   setActionLevel 4 | getTeamSize 4 | setTeamSize 4 | getStamina 4
 *   startAction 4 | getCurrentAction 1 | getCity 4 | getCityChaos 4
 *   switchCity 4 | getBonusTime 0 | nextUpdate 0 | getPlayer 0.5
 *   => ~92 GB (the Bladeburner API is one of the priciest in the game)
 *
 * Usage
 *   run bladeburner.ts
 *   run bladeburner.ts --dry-run --city auto
 */

import type { NS, BladeburnerActionName } from "../defs.d";
import type { BladeburnerActionType, BladeburnerSkillName, CityName } from "./types";

const RAM_NEEDED = 92;

/** Stamina each action type costs, straight from the game constants. */
const STAMINA_COST: Record<BladeburnerActionType, number> = {
  General: 7.5,
  Contracts: 10,
  Operations: 7.5,
  "Black Operations": 10,
};

/** Skill upgrade order: stamina and success chance first. */
const SKILL_PRIORITY: BladeburnerSkillName[] = [
  "Blade's Intuition",
  "Cloak",
  "Cyber's Edge",
  "Evasive System",
  "Datamancer",
  "Hands of Midas",
  "Hyperdrive",
  "Overclock",
  "Reaper",
  "Short-Circuit",
  "Digital Observer",
  "Tracer",
];

/** All Bladeburner cities, as the API expects them. */
const CITIES: CityName[] = ["Aevum", "Chongqing", "Ishima", "New Tokyo", "Sector-12"];

export async function main(ns: NS): Promise<void> {
  ns.clearLog();
  ns.disableLog("ALL");

  const args = ns.args.map(String);
  const core = await ns.dynamicImport("./core.ts");
  const dryRun = args.includes("--dry-run");
  const loops = core.maxLoops(args);
  const host = ns.getHostname();

  if (ns.getServerMaxRam(host) < RAM_NEEDED) {
    ns.tprint(`bladeburner.ts needs ${RAM_NEEDED} GB; ${host} has ${ns.getServerMaxRam(host)} GB.`);
    return;
  }

  if (!core.subsystemAvailable(ns, "bladeburner")) {
    ns.tprint("Bladeburner is disabled in this bitnode.");
    return;
  }

  ns.print("=== bladeburner module ===");

  for (let loop = 0; loop < loops; ++loop) {
    if (!ns.bladeburner.inBladeburner()) {
      if (dryRun) ns.print("[dry-run] would join the Bladeburner division");
      else if (ns.bladeburner.joinBladeburnerDivision()) ns.print("joined Bladeburner");
      else {
        ns.print("cannot join Bladeburner yet (needs SF4 / rank 100 rep path)");
        return;
      }
      await ns.sleep(1000);
      continue;
    }

    upgradeSkills(ns, dryRun);
    moveCity(ns, dryRun);

    const action = ns.bladeburner.getCurrentAction();
    if (!action) {
      const choice = bestAction(ns);
      if (choice) {
        if (dryRun) {
          ns.print(`[dry-run] would start ${choice.type} "${choice.name}" (score ${choice.score.toFixed(3)})`);
        } else {
          ns.bladeburner.startAction(choice.type, choice.name);
          ns.print(`started ${choice.type} "${choice.name}"`);
        }
      }
    }

    ns.print(
      `rank ${ns.bladeburner.getRank()} | stamina ${ns.bladeburner.getStamina()[0].toFixed(1)}/` +
        `${ns.bladeburner.getStamina()[1]} | skill points ${ns.bladeburner.getSkillPoints()}`,
    );

    await ns.bladeburner.nextUpdate();
  }
}

/** Spend skill points following the priority list, one level at a time. */
function upgradeSkills(ns: NS, dryRun: boolean): void {
  const points = ns.bladeburner.getSkillPoints();
  if (points <= 0) return;

  for (const skill of SKILL_PRIORITY) {
    const cost = ns.bladeburner.getSkillUpgradeCost(skill);
    if (cost <= 0 || cost > points) continue;

    if (dryRun) {
      ns.print(`[dry-run] would upgrade ${skill} (level ${ns.bladeburner.getSkillLevel(skill)}, cost ${cost})`);
      continue;
    }
    if (ns.bladeburner.upgradeSkill(skill)) {
      ns.print(`upgraded ${skill} to level ${ns.bladeburner.getSkillLevel(skill)}`);
      break; // skill points are scarce; one upgrade per cycle
    }
  }
}

/** Operations scale with city chaos, so always be where the chaos is. */
function moveCity(ns: NS, dryRun: boolean): void {
  const current = ns.bladeburner.getCity();

  let best: CityName = current;
  let bestChaos = -1;
  for (const city of CITIES) {
    const chaos = ns.bladeburner.getCityChaos(city);
    if (chaos > bestChaos) {
      bestChaos = chaos;
      best = city;
    }
  }

  if (best === current) return;

  if (dryRun) {
    ns.print(`[dry-run] would move from ${current} to ${best} (chaos ${bestChaos.toFixed(2)})`);
    return;
  }
  if (ns.bladeburner.switchCity(best)) ns.print(`moved to ${best}`);
}

/**
 * Score every available action as
 *   expected rank gain per stamina, with a small bonus for reputation
 * and a penalty for actions we cannot level up any further.
 */
function bestAction(
  ns: NS,
): { type: BladeburnerActionType; name: BladeburnerActionName; score: number } | null {
  const rank = ns.bladeburner.getRank();
  const stamina = ns.bladeburner.getStamina()[0];
  const candidates: Array<{ type: BladeburnerActionType; name: BladeburnerActionName }> = [];

  for (const name of ns.bladeburner.getGeneralActionNames()) candidates.push({ type: "General", name });
  for (const name of ns.bladeburner.getOperationNames()) candidates.push({ type: "Operations", name });
  for (const name of ns.bladeburner.getContractNames()) candidates.push({ type: "Contracts", name });

  const nextOp = ns.bladeburner.getNextBlackOp();
  if (nextOp && rank >= nextOp.rank) {
    candidates.push({ type: "Black Operations", name: nextOp.name });
  }

  let best: { type: BladeburnerActionType; name: BladeburnerActionName; score: number } | null = null;

  for (const c of candidates) {
    const remaining = ns.bladeburner.getActionCountRemaining(c.type, c.name);
    if (remaining <= 0) continue;

    const chance = ns.bladeburner.getActionEstimatedSuccessChance(c.type, c.name)[0];
    if (chance <= 0) continue;

    const rankGain = ns.bladeburner.getActionRankGain(c.type, c.name);
    const rankLoss = ns.bladeburner.getActionRankLoss(c.type, c.name);
    const repGain = ns.bladeburner.getActionRepGain(c.type, c.name);
    const cost = STAMINA_COST[c.type] ?? 7.5;

    if (stamina < cost) {
      // Not enough stamina: only the regeneration chamber makes sense.
      if (c.name === "Hyperbolic Regeneration Chamber") {
        return { type: c.type, name: c.name, score: 1 };
      }
      continue;
    }

    const expected = chance * rankGain - (1 - chance) * Math.abs(rankLoss);
    const score = (expected + repGain * 0.5) / cost;

    if (!best || score > best.score) best = { type: c.type, name: c.name, score };
  }

  return best;
}