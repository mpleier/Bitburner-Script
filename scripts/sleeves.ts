/**
 * sleeves.ts
 * ============================================================================
 * Sleeve automation (BitNode 10 / Source-File 10):
 *   - synchronises sleeves whose sync is low (sync multiplies every gain)
 *   - recovers from shock when it is high
 *   - assigns each sleeve the task that best matches its strongest stat:
 *       hacking  -> university class / faction hacking work
 *       strength -> gym, then assault crimes
 *       charisma -> sales / promotion jobs
 *       otherwise-> the crime whose stat weights they have most of
 *
 * RAM cost (GB), SleeveBase = 4:
 *   base 1.6 | getNumSleeves 4 | getSleeve 4 | getTask 4 | setToIdle 4
 *   setToShockRecovery 4 | setToSynchronize 4 | setToCommitCrime 4
 *   setToFactionWork 4 | setToCompanyWork 4 | setToUniversityCourse 4
 *   setToGymWorkout 4
 *   + getPlayer 0.5 | getStat 0.05 | getServerMaxRam 0.05 | getHostname 0.05
 *   => ~45 GB for three sleeves
 *
 * Usage
 *   run sleeves.ts
 *   run sleeves.ts --dry-run --sync-target 80
 */

import type { NS } from "../defs.d";
import type { CrimeType, GymType, SleevePerson } from "./types";

const RAM_NEEDED = 45;

/** Crimes keyed by the stat they lean on most (real CrimeType names). */
const CRIMES_BY_STAT: Record<string, CrimeType> = {
  hacking: "Bond Forgery",
  strength: "Homicide",
  defense: "Shoplift",
  dexterity: "Larceny",
  agility: "Kidnap",
  charisma: "Grand Theft Auto",
  intelligence: "Traffick Arms",
};

/** Gym stat names accepted by setToGymWorkout. */
const GYM_STAT: Record<string, GymType> = {
  strength: "str",
  defense: "def",
  dexterity: "dex",
  agility: "agi",
};

export async function main(ns: NS): Promise<void> {
  ns.clearLog();
  ns.disableLog("ALL");

  const args = ns.args.map(String);
  const core = await ns.dynamicImport("./core.ts");
  const dryRun = args.includes("--dry-run");
  const loops = core.maxLoops(args);
  const syncTarget = core.numOr(args, "--sync-target", 80);
  const host = ns.getHostname();

  if (ns.getServerMaxRam(host) < RAM_NEEDED) {
    ns.print(`sleeves.ts needs ${RAM_NEEDED} GB; ${host} has ${ns.getServerMaxRam(host)} GB.`);
    return;
  }

  if (!core.subsystemAvailable(ns, "sleeves")) {
    ns.print("Sleeves need Source-File 10 (or BitNode 10). Skipping.");
    return;
  }

  const count = ns.sleeve.getNumSleeves();
  if (count === 0) {
    ns.print("No sleeves - nothing to do.");
    return;
  }

  ns.print(`=== sleeves module (${count} sleeves) ===`);

  for (let loop = 0; loop < loops; ++loop) {
    for (let i = 0; i < count; ++i) {
      const sleeve = ns.sleeve.getSleeve(i);
      const task = ns.sleeve.getTask(i);

      // Shock eats most of the experience a sleeve contributes.
      if (sleeve.shock > 20) {
        if (dryRun) ns.print(`[dry-run] sleeve ${i}: shock recovery (shock ${sleeve.shock})`);
        else ns.sleeve.setToShockRecovery(i);
        continue;
      }

      // Low sync means the sleeve is barely contributing - synchronise it.
      if (sleeve.sync < syncTarget) {
        if (dryRun) ns.print(`[dry-run] sleeve ${i}: synchronize (sync ${sleeve.sync})`);
        else ns.sleeve.setToSynchronize(i);
        continue;
      }

      if (task) continue; // already busy

      assign(ns, i, sleeve, dryRun);
    }

    for (let i = 0; i < count; ++i) {
      const s = ns.sleeve.getSleeve(i);
      const t = ns.sleeve.getTask(i);
      ns.print(
        `sleeve ${i}: sync ${s.sync} shock ${s.shock} | ` +
          `hack ${Math.floor(s.skills.hacking)} str ${Math.floor(s.skills.strength)} ` +
          `cha ${Math.floor(s.skills.charisma)} | ` +
          `task ${t?.type ?? "idle"} | bonus ${s.storedCycles} cycles`,
      );
    }

    await ns.sleep(5000);
  }
}

/** Give an idle sleeve the task that fits its strongest stat. */
function assign(ns: NS, index: number, sleeve: SleevePerson, dryRun: boolean): void {
  const stats: Array<[string, number]> = [
    ["hacking", sleeve.skills.hacking],
    ["strength", sleeve.skills.strength],
    ["defense", sleeve.skills.defense],
    ["dexterity", sleeve.skills.dexterity],
    ["agility", sleeve.skills.agility],
    ["charisma", sleeve.skills.charisma],
    ["intelligence", sleeve.skills.intelligence],
  ];
  stats.sort((a, b) => b[1] - a[1]);
  const bestStat = stats[0][0];

  let done = false;

  if (bestStat === "hacking") {
    done = dryRun
      ? true
      : ns.sleeve.setToUniversityCourse(index, "ZB Institute of Technology", "Computer Science");
  } else if (GYM_STAT[bestStat]) {
    done = dryRun
      ? true
      : ns.sleeve.setToGymWorkout(index, "Crush Fitness Gym", GYM_STAT[bestStat]);
  } else if (bestStat === "charisma") {
    const companies = Object.values(ns.enums.CompanyName);
    done = companies.length > 0 && (dryRun || ns.sleeve.setToCompanyWork(index, companies[0]));
  }

  if (!done) {
    const crime = CRIMES_BY_STAT[bestStat] ?? "Homicide";
    done = dryRun ? true : ns.sleeve.setToCommitCrime(index, crime);
  }

  if (dryRun) ns.print(`[dry-run] sleeve ${index} would be given a ${bestStat} task`);
  else if (done) ns.print(`sleeve ${index} assigned to a ${bestStat} task`);
}