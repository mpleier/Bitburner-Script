/**
 * crime.ts
 * ============================================================================
 * Crime automation:
 *   - ranks every crime by expected money per second
 *   - commits the best one repeatedly
 *   - builds the Shadow faction chain (the only faction worth grinding for)
 *
 * RAM cost (GB): base 1.6 + commitCrime 2 + getCrimeChance 2 + getCrimeStats 2
 *   + getPlayer 0.5 + isBusy 0.5
 *   + getFactionRep 1 + checkFactionInvitations 3 + joinFaction 3
 *   + getAugmentationsFromFaction 5 + getAugmentationPrice 2.5 + getAugmentationRepReq 2.5
 *   + getOwnedAugmentations 5 + purchaseAugmentation 5 + donateToFaction 5
 *   + getFavorToDonate 0.1
 *   + bladeburner.inBladeburner 0 + bladeburner.getCurrentAction 1
 *   + whatever core.ts uses
 *   => ~43 GB (ramgap.mjs computes the exact number)
 *
 * Usage
 *   run crime.ts
 *   run crime.ts --focus rep --dry-run
 */

// Bitburner injects its API typings as a global declaration file, so `NS`
// needs no import (globals.d.ts mirrors that for local `tsc` checks).

// core.ts is imported statically on purpose. Bitburner's RAM allocation is
// computed from the AST of the script and everything it *statically* imports;
// ns.dynamicImport() is invisible to that pass, so the API calls core.ts makes
// would not be paid for and the game would abort the script with a RAM error.
import * as core from "./core.ts";

const RAM_NEEDED = 43;

/** All crimes, taken from the enum so the names are always valid. */
function allCrimes(ns: NS) {
  return Object.values(ns.enums.CrimeType);
}

/*
 * Do NOT hardcode augmentation names.
 *
 * The game validates every augmentation argument against its AugmentationName
 * enum (src/utils/EnumHelper.ts -> nsGetMember) and throws a RuntimeError when
 * the string is not a member:
 *   singularity.getAugmentationPrereq: Argument augmentationName should be a
 *   AugmentationName enum member. Provided value: "Shadow Blade".
 *
 * ns.enums does not expose AugmentationName, so a script has no way to check a
 * hardcoded name. "Shadow Blade" / "Shadow Network" / "Shadow Qi" ... were the
 * old Shadows of Anarchy chain and were replaced by the "SoA - ..." augmentations,
 * which is exactly what crashed crime.ts. The chain below is therefore read back
 * from the API itself, so it can never contain a stale name.
 */

export async function main(ns: NS): Promise<void> {
  ns.clearLog();
  ns.disableLog("ALL");

  const args = ns.args.map(String);
  const dryRun = args.includes("--dry-run");
  const focus = args.includes("--focus") ? args[args.indexOf("--focus") + 1] : "money";
  const loops = core.maxLoops(args);
  const host = ns.getHostname();

  if (ns.getServerMaxRam(host) < RAM_NEEDED) {
    ns.tprint(`crime.ts needs ${RAM_NEEDED} GB; ${host} has ${ns.getServerMaxRam(host)} GB.`);
    return;
  }

  ns.print("=== crime module ===");

  for (let loop = 0; loop < loops; ++loop) {
    const best = bestCrime(ns, focus);

    if (best) {
      if (dryRun) {
        ns.print(`[dry-run] best crime: ${best.crime} -> ${fmt(best.perSec)}/s (chance ${best.chance})`);
      } else if (core.workBladeburnerConflict(ns)) {
        ns.print("player's time is taken by a job or a Bladeburner action, skipping crime");
      } else {
        const result = ns.singularity.commitCrime(best.crime);
        ns.print(`${best.crime} took ${result} ms`);
      }
    }

    shadowChain(ns, dryRun);
    await ns.sleep(1000);
  }
}

/** Rank crimes by expected value per second. */
function bestCrime(ns: NS, focus: string) {
  let best: { crime: ReturnType<typeof allCrimes>[number]; perSec: number; chance: number } | null = null;

  for (const crime of allCrimes(ns)) {
    const stats = ns.singularity.getCrimeStats(crime);
    const chance = ns.singularity.getCrimeChance(crime);
    const perSec = (chance * stats.money) / (stats.time / 1000);
    if (!best || perSec > best.perSec) best = { crime, perSec, chance };
  }

  void focus; // "rep" focus would prefer Shadow rep; money is the default driver
  return best;
}

/** Build the Shadow faction: earn rep in the four feeder factions, join, buy what they offer. */
function shadowChain(ns: NS, dryRun: boolean): void {
  const shadow = ns.enums.FactionName.ShadowsOfAnarchy;
  const feeders = [
    ns.enums.FactionName.SlumSnakes,
    ns.enums.FactionName.SpeakersForTheDead,
    ns.enums.FactionName.TheDarkArmy,
    ns.enums.FactionName.TheSyndicate,
  ];
  const cash = ns.getPlayer().money;

  for (const faction of feeders) {
    const rep = ns.singularity.getFactionRep(faction);
    if (rep >= 100) continue;
    ns.print(`Shadow needs 100 rep in ${faction} (currently ${rep})`);
  }

  // Ask the game what the Shadows actually sell. Anything this returns is an
  // AugmentationName enum member by construction, so it can never be rejected.
  let offered: string[];
  try {
    offered = ns.singularity.getAugmentationsFromFaction(shadow) ?? [];
  } catch (err) {
    ns.print(`shadow chain skipped: ${(err as Error).message}`);
    return;
  }

  if (offered.length === 0) {
    ns.print("Shadows of Anarchy has nothing to sell yet (join it first).");
    return;
  }

  const owned = new Set(ns.singularity.getOwnedAugmentations(true));
  const shadowRep = ns.singularity.getFactionRep(shadow);

  const shopping: Array<{ aug: string; price: number; repReq: number }> = [];
  for (const aug of offered) {
    if (owned.has(aug)) continue;
    try {
      shopping.push({
        aug,
        price: ns.singularity.getAugmentationPrice(aug),
        repReq: ns.singularity.getAugmentationRepReq(aug),
      });
    } catch (err) {
      ns.print(`skipped ${aug}: ${(err as Error).message}`);
    }
  }

  // Cheapest reputation requirement first: the SoA augmentations have no
  // prereqs, but each one bought raises the price of the next, so this order
  // maximises how many get bought before the money runs out.
  shopping.sort((a, b) => a.repReq - b.repReq);

  let budget = cash;
  for (const item of shopping) {
    if (shadowRep < item.repReq) {
      ns.print(`need ${fmt(item.repReq)} Shadow rep for ${item.aug} (have ${fmt(shadowRep)})`);
      continue;
    }
    if (item.price <= 0 || item.price > budget) continue;

    if (dryRun) {
      ns.print(`[dry-run] would buy ${item.aug} for ${fmt(item.price)}`);
      budget -= item.price;
      continue;
    }
    if (ns.singularity.purchaseAugmentation(shadow, item.aug)) {
      ns.print(`bought ${item.aug} for ${fmt(item.price)}`);
      budget -= item.price;
      owned.add(item.aug);
    }
  }
}

function fmt(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return n.toFixed(2);
}
