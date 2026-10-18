/**
 * factions.ts
 * ============================================================================
 * Faction automation:
 *   - joins every faction that invites you
 *   - works for the faction that gives the most favor per cycle
 *   - donates favor to factions that have augmentations you want
 *   - buys every augmentation you can afford whose prereqs + rep are met
 *   - installs augmentations only with --install-augs, because that resets
 *
 * RAM cost (GB): base 1.6
 *   checkFactionInvitations 3 | joinFaction 3 | workForFaction 3
 *   getFactionWorkTypes 1 | getFactionRep 1 | getFactionFavor 1
 *   getFactionFavorGain 0.75 | donateToFaction 5
 *   getOwnedAugmentations 5 | getAugmentationsFromFaction 5
 *   getAugmentationPrereq 5 | getAugmentationPrice 2.5 | getAugmentationRepReq 2.5
 *   purchaseAugmentation 5 | installAugmentations 5 | isBusy 0.5 | getPlayer 0.5
 *   getFavorToDonate 0.1
 *   => ~33 GB
 *
 * Usage
 *   run factions.ts
 *   run factions.ts --install-augs --interval 5000
 */

import type { NS } from "../defs.d";

const RAM_NEEDED = 34;

/** Every faction name, so we can iterate without a "list my factions" API. */
const ALL_FACTIONS: string[] = [
  "BitRunners", "TheBlackHand", "NiteSec", "CyberSec", "Netburners", "TianDiHui",
  "Aevum", "Chongqing", "Ishima", "NewTokyo", "Sector12", "Volhaven",
  "SlumSnakes", "SpeakersForTheDead", "TheDarkArmy", "TheSyndicate", "Silhouette",
  "Tetrads", "ECorp", "MegaCorp", "BachmanAndAssociates", "BladeIndustries",
  "NWO", "ClarkeIncorporated", "OmniTekIncorporated", "FourSigma",
  "KuaiGongInternational", "FulcrumSecretTechnologies", "Illuminati", "Daedalus",
  "TheCovenant", "Bladeburners", "ChurchOfTheMachineGod", "ShadowsOfAnarchy",
];

export async function main(ns: NS): Promise<void> {
  ns.clearLog();
  ns.disableLog("ALL");

  const args = ns.args.map(String);
  const dryRun = args.includes("--dry-run");
  const installAugs = args.includes("--install-augs");
  const interval = Number(flagOr(args, "--interval", 1000));
  const host = ns.getHostname();

  if (ns.getServerMaxRam(host) < RAM_NEEDED) {
    ns.tprint(`factions.ts needs ${RAM_NEEDED} GB; ${host} has ${ns.getServerMaxRam(host)} GB.`);
    return;
  }

  const joined = new Set<string>();
  ns.print("=== faction module ===");

  while (true) {
    // 1. Join every faction that invited us.
    for (const faction of ns.singularity.checkFactionInvitations()) {
      if (dryRun) {
        ns.print(`[dry-run] would join ${faction}`);
        joined.add(faction);
        continue;
      }
      if (ns.singularity.joinFaction(faction)) {
        ns.print(`joined ${faction}`);
        joined.add(faction);
      }
    }

    // 2. Work for the faction with the best favor gain.
    const best = bestFactionToWork(ns, joined);
    if (best) {
      const workType = pickWorkType(ns, best.faction);
      if (dryRun) ns.print(`[dry-run] would work ${workType} for ${best.faction}`);
      else if (!ns.singularity.isBusy()) ns.singularity.workForFaction(best.faction, workType);
    }

    // 3. Donate spare favor to factions that still have augs for us.
    donate(ns, joined, dryRun);

    // 4. Buy augmentations.
    buyAugmentations(ns, joined, dryRun);

    // 5. Install (this resets the run) - only when asked.
    if (installAugs && !dryRun) {
      const owned = ns.singularity.getOwnedAugmentations(true);
      if (owned.length > 0) {
        ns.print(`installing ${owned.length} augmentations - the run will reset`);
        ns.singularity.installAugmentations("autobot.ts");
        return;
      }
    }

    await ns.sleep(interval);
  }
}

/** The faction we belong to that gives the most favor per cycle. */
function bestFactionToWork(ns: NS, joined: Set<string>): { faction: string; gain: number } | null {
  let best: { faction: string; gain: number } | null = null;
  for (const faction of joined) {
    const gain = ns.singularity.getFactionFavorGain(faction);
    if (!best || gain > best.gain) best = { faction, gain };
  }
  return best;
}

/** Pick the work type that matches our best stat. */
function pickWorkType(ns: NS, faction: string): string {
  const types = ns.singularity.getFactionWorkTypes(faction);
  if (types.length === 0) return "hacking";

  const s = ns.getPlayer().skills;
  const score: Record<string, number> = {
    hacking: s.hacking,
    field: s.charisma,
    security: s.strength + s.defense,
  };

  let best = types[0];
  for (const t of types) if ((score[t] ?? 0) > (score[best] ?? 0)) best = t;
  return best;
}

/** Give favor away when a faction still has augmentations we want. */
function donate(ns: NS, joined: Set<string>, dryRun: boolean): void {
  const favorNeeded = ns.getFavorToDonate();
  if (favorNeeded <= 0) return;

  const owned = new Set(ns.singularity.getOwnedAugmentations(true));

  for (const faction of joined) {
    const favor = ns.singularity.getFactionFavor(faction);
    if (favor < favorNeeded * 100) continue; // keep a 100-rep buffer

    const augs = ns.singularity.getAugmentationsFromFaction(faction);
    const wanted = augs.filter((a) => !owned.has(a));
    if (wanted.length === 0) continue;

    if (dryRun) {
      ns.print(`[dry-run] would donate to ${faction} (favor ${favor})`);
      continue;
    }

    const amount = Math.floor(favor / favorNeeded / 2);
    if (amount > 0 && ns.singularity.donateToFaction(faction, amount)) {
      ns.print(`donated favor to ${faction}`);
    }
  }
}


/** Purchase every affordable augmentation whose prereqs and rep are met. */
function buyAugmentations(ns: NS, joined: Set<string>, dryRun: boolean): void {
  const cash = ns.getPlayer().money;
  const owned = new Set(ns.singularity.getOwnedAugmentations(true));

  for (const faction of joined) {
    const rep = ns.singularity.getFactionRep(faction);
    if (rep <= 0) continue;

    for (const aug of ns.singularity.getAugmentationsFromFaction(faction)) {
      if (owned.has(aug)) continue;

      const prereq = ns.singularity.getAugmentationPrereq(aug);
      if (prereq.some((p) => !owned.has(p))) continue;

      const reqRep = ns.singularity.getAugmentationRepReq(aug);
      if (rep < reqRep) continue;

      const price = ns.singularity.getAugmentationPrice(aug);
      if (price <= 0 || price > cash / 2) continue;

      if (dryRun) {
        ns.print(`[dry-run] would buy ${aug} from ${faction} for ${fmt(price)}`);
        continue;
      }
      if (ns.singularity.purchaseAugmentation(faction, aug)) {
        ns.print(`bought ${aug} for ${fmt(price)}`);
        owned.add(aug);
      }
    }
  }
}

function flagOr(args: string[], name: string, fallback: number): number {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? Number(args[i + 1]) : fallback;
}

function fmt(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return n.toFixed(2);
}

