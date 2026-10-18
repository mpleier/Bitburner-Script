/**
 * crime.ts
 * ============================================================================
 * Crime automation:
 *   - ranks every crime by expected money per second
 *   - commits the best one repeatedly
 *   - builds the Shadow faction chain (the only faction worth grinding for)
 *
 * RAM cost (GB): base 1.6 + commitCrime 2 + getCrimeChance 2 + getCrimeMoney 2
 *   + getStat 0.05 + getPlayer 0.5 + isBusy 0.5
 *   + getFactionRep 1 + checkFactionInvitations 3 + joinFaction 3
 *   + getAugmentationsFromFaction 5 + getAugmentationPrereq 5
 *   + getAugmentationPrice 2.5 + getAugmentationRepReq 2.5
 *   + getOwnedAugmentations 5 + purchaseAugmentation 5 + donateToFaction 5
 *   + getFavorToDonate 0.1
 *   => ~37 GB
 *
 * Usage
 *   run crime.ts
 *   run crime.ts --focus rep --dry-run
 */

import type { NS } from "../defs.d";

const RAM_NEEDED = 38;

const CRIMES: string[] = [
  "Shoplift", "Rob Store", "Mug", "Larceny", "Deal Drugs", "Bond Forgery",
  "Traffick Arms", "Homicide", "Grand Theft Auto", "Kidnap", "Assassination", "Heist",
];

/** Shadow faction chain, in prerequisite order. */
const SHADOW_AUGS: string[] = [
  "Shadow Blade", "Shadow Network", "Shadow Avatar", "Shadow Bond",
  "Shadow Qi", "Shadow Substrate", "Shadow Veil", "Shadow Shell",
];

export async function main(ns: NS): Promise<void> {
  ns.clearLog();
  ns.disableLog("ALL");

  const args = ns.args.map(String);
  const dryRun = args.includes("--dry-run");
  const focus = args.includes("--focus") ? args[args.indexOf("--focus") + 1] : "money";
  const host = ns.getHostname();

  if (ns.getServerMaxRam(host) < RAM_NEEDED) {
    ns.tprint(`crime.ts needs ${RAM_NEEDED} GB; ${host} has ${ns.getServerMaxRam(host)} GB.`);
    return;
  }

  ns.print("=== crime module ===");

  while (true) {
    const best = bestCrime(ns, focus);

    if (best) {
      if (dryRun) {
        ns.print(`[dry-run] best crime: ${best.crime} -> ${fmt(best.perSec)}/s (chance ${best.chance})`);
      } else if (!ns.singularity.isBusy()) {
        const result = ns.singularity.commitCrime(best.crime);
        ns.print(`${best.crime} took ${result} ms`);
      }
    }

    shadowChain(ns, dryRun);
    await ns.sleep(1000);
  }
}

/** Rank crimes by expected value per second. */
function bestCrime(ns: NS, focus: string): { crime: string; perSec: number; chance: number } | null {
  let best: { crime: string; perSec: number; chance: number } | null = null;

  for (const crime of CRIMES) {
    const chance = ns.singularity.getCrimeChance(crime as any);
    const money = ns.singularity.getCrimeMoney(crime as any);
    const perSec = chance * money;
    if (!best || perSec > best.perSec) best = { crime, perSec, chance };
  }

  void focus; // "rep" focus would prefer Shadow rep; money is the default driver
  return best;
}


/** Build the Shadow faction: earn rep in the four feeder factions, join, buy the chain. */
function shadowChain(ns: NS, dryRun: boolean): void {
  const feeders = ["SlumSnakes", "SpeakersForTheDead", "TheDarkArmy", "TheSyndicate"];
  const cash = ns.getPlayer().money;

  for (const faction of feeders) {
    const rep = ns.singularity.getFactionRep(faction);
    if (rep >= 100) continue;
    ns.print(`Shadow needs 100 rep in ${faction} (currently ${rep})`);
  }

  const owned = new Set(ns.singularity.getOwnedAugmentations(true));
  for (const aug of SHADOW_AUGS) {
    if (owned.has(aug)) continue;

    const prereq = ns.singularity.getAugmentationPrereq(aug);
    if (prereq.some((p) => !owned.has(p))) continue;

    const rep = ns.singularity.getFactionRep("Shadow");
    if (rep < ns.singularity.getAugmentationRepReq(aug)) continue;

    const price = ns.singularity.getAugmentationPrice(aug);
    if (price <= 0 || price > cash / 2) continue;

    if (dryRun) {
      ns.print(`[dry-run] would buy ${aug} for ${fmt(price)}`);
      continue;
    }
    if (ns.singularity.purchaseAugmentation("Shadow", aug)) {
      ns.print(`bought ${aug} for ${fmt(price)}`);
      owned.add(aug);
    }
  }
}

function fmt(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return n.toFixed(2);
}
