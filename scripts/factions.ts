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
 *   + core.ts helpers: inBladeburner 0, getCurrentAction 1
 *     (getOwnedAugmentations and isBusy are already listed above)
 *   => 55 GB (ramgap.mjs computes the exact number)
 *
 * Bladeburner note: workForFaction() sets Player.currentWork, which cancels a
 * running Bladeburner action unless BladesSimulacrum is installed.
 *
 * Usage
 *   run factions.ts
 *   run factions.ts --install-augs --interval 5000
 */

// Bitburner injects its API typings as a global declaration file, so `NS`
// needs no import (globals.d.ts mirrors that for local `tsc` checks).

// core.ts is imported statically on purpose. Bitburner's RAM allocation is
// computed from the AST of the script and everything it *statically* imports;
// ns.dynamicImport() is invisible to that pass, so the API calls core.ts makes
// would not be paid for and the game would abort the script with a RAM error.
import * as core from "./core.ts";

const RAM_NEEDED = 55;

/** Every faction name, taken from the enum so the spelling is always right. */
function allFactions(ns: NS) {
  return Object.values(ns.enums.FactionName);
}

type Faction = ReturnType<typeof allFactions>[number];

export async function main(ns: NS): Promise<void> {
  ns.clearLog();
  ns.disableLog("ALL");

  const args = ns.args.map(String);
  const dryRun = args.includes("--dry-run");
  const installAugs = args.includes("--install-augs");
  const interval = Number(flagOr(args, "--interval", 1000));
  const loops = core.maxLoops(args);
  const host = ns.getHostname();

  if (ns.getServerMaxRam(host) < RAM_NEEDED) {
    ns.tprint(`factions.ts needs ${RAM_NEEDED} GB; ${host} has ${ns.getServerMaxRam(host)} GB.`);
    return;
  }

  const joined = new Set<Faction>();
  ns.print("=== faction module ===");

  for (let loop = 0; loop < loops; ++loop) {
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

    // 2. Track any faction we already have reputation with.
    for (const faction of allFactions(ns)) {
      if (ns.singularity.getFactionRep(faction) > 0) joined.add(faction);
    }

    // 2. Work for the faction with the best favor gain.
    const best = bestFactionToWork(ns, joined);
    if (best) {
      const workType = pickWorkType(ns, best.faction);
      if (dryRun) ns.print(`[dry-run] would work ${workType} for ${best.faction}`);
      else if (core.workBladeburnerConflict(ns)) ns.print("Bladeburner action running - skipping faction work");
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
function bestFactionToWork(ns: NS, joined: Set<Faction>) {
  let best: { faction: Faction; gain: number } | null = null;
  for (const faction of joined) {
    const gain = ns.singularity.getFactionFavorGain(faction);
    if (!best || gain > best.gain) best = { faction, gain };
  }
  return best;
}

/** Pick the work type that matches our best stat. */
function pickWorkType(ns: NS, faction: Faction) {
  const types = ns.singularity.getFactionWorkTypes(faction);
  if (types.length === 0) return ns.enums.FactionWorkType.hacking;

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
function donate(ns: NS, joined: Set<Faction>, dryRun: boolean): void {
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
function buyAugmentations(ns: NS, joined: Set<Faction>, dryRun: boolean): void {
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

