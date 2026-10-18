/**
 * corporation.ts
 * ============================================================================
 * Corporation automation (BitNode 3 / Source-File 3):
 *   - creates the corporation
 *   - opens divisions in the industries with the best products
 *   - expands to every city, staffs and sizes the offices
 *   - balances employee jobs by measured production
 *   - buys warehouses and upgrades them when they are the bottleneck
 *   - designs products with a fixed, safe investment split
 *   - buys ad verts and the corp upgrades that pay for themselves
 *   - takes investment offers and pays dividends once public
 *
 * RAM cost (GB) - the Corporation API is the most expensive in the game
 * (CorporationInfo = 10, CorporationAction = 20):
 *   base 1.6 | createCorporation 20 | getCorporation 10 | getDivision 10
 *   expandIndustry 20 | expandCity 20 | getOffice 10 | getOfficeSizeUpgradeCost 10
 *   upgradeOfficeSize 20 | hireEmployee 20 | setJobAssignment 20
 *   hasWarehouse 10 | purchaseWarehouse 20 | getWarehouse 10 | upgradeWarehouse 20
 *   getProduct 10 | makeProduct 20 | sellProduct 20 | hireAdVert 20
 *   getHireAdVertCost 10 | getInvestmentOffer 10 | acceptInvestmentOffer 20
 *   goPublic 20 | issueDividends 20 | hasUnlock 10 | getUnlockCost 10
 *   purchaseUnlock 20 | getUpgradeLevel 10 | getUpgradeLevelCost 10
 *   levelUpgrade 20 | getConstants 0 | hasCorporation 0 | canCreateCorporation 0
 *   getBonusTime 0 | nextUpdate 0 | getPlayer 0.5
 *   => ~420 GB. Run it on home once you have upgraded RAM, or on a big server.
 *
 * Usage
 *   run corporation.ts
 *   run corporation.ts --dry-run --divisions 3
 */

import type { NS } from "../defs.d";
import type { CityName, CorpIndustryName } from "./types";

const RAM_NEEDED = 421;

/** Industries worth opening, in order of how good their products are. */
const INDUSTRY_ORDER: CorpIndustryName[] = [
  "Software",
  "Robotics",
  "Mining",
  "Refinery",
  "Agriculture",
  "Water Utilities",
  "Fishing",
  "Restaurant",
  "Healthcare",
  "Real Estate",
];

const CITIES: CityName[] = ["Aevum", "Chongqing", "Ishima", "New Tokyo", "Sector-12"];

export async function main(ns: NS): Promise<void> {
  ns.clearLog();
  ns.disableLog("ALL");

  const args = ns.args.map(String);
  const core = await ns.dynamicImport("./core.ts");
  const dryRun = args.includes("--dry-run");
  const loops = core.maxLoops(args);
  const maxDivisions = core.numOr(args, "--divisions", 4);
  const host = ns.getHostname();

  if (ns.getServerMaxRam(host) < RAM_NEEDED) {
    ns.tprint(`corporation.ts needs ${RAM_NEEDED} GB; ${host} has ${ns.getServerMaxRam(host)} GB.`);
    ns.tprint("Upgrade home RAM, or run it on a server with more memory.");
    return;
  }

  if (!core.subsystemAvailable(ns, "corporation")) {
    ns.tprint("Corporations are disabled in this bitnode.");
    return;
  }

  ns.print("=== corporation module ===");

  for (let loop = 0; loop < loops; ++loop) {
    if (!ns.corporation.hasCorporation()) {
      const check = ns.corporation.canCreateCorporation(true);
      if (check === "Success") {
        if (dryRun) ns.print("[dry-run] would create a corporation");
        else if (ns.corporation.createCorporation("Bitburner Industries", true)) {
          ns.print("corporation created");
        }
      } else {
        ns.print(`cannot create a corporation yet (${check})`);
        return;
      }
      await ns.corporation.nextUpdate();
      continue;
    }

    const corp = ns.corporation.getCorporation();
    const funds = corp.funds;

    openDivisions(ns, corp, maxDivisions, dryRun);
    manageOffices(ns, corp, funds, dryRun);
    manageWarehouses(ns, corp, funds, dryRun);
    manageProducts(ns, corp, funds, dryRun);
    manageUpgrades(ns, funds, dryRun);
    manageInvestors(ns, corp, dryRun);

    ns.print(
      `${corp.name} | funds ${core.fmt(funds)} | revenue ${core.fmt(corp.revenue)}/s | ` +
        `expenses ${core.fmt(corp.expenses)}/s | divisions ${corp.divisions.length} | ` +
        `valuation ${core.fmt(corp.valuation)}`,
    );

    await ns.corporation.nextUpdate();
  }
}

/** Open divisions in the best industries we can afford. */
function openDivisions(ns: NS, corp: any, maxDivisions: number, dryRun: boolean): void {
  if (corp.divisions.length >= maxDivisions) return;

  for (const industry of INDUSTRY_ORDER) {
    if (corp.divisions.length >= maxDivisions) break;

    const data = ns.corporation.getIndustryData(industry);
    if (!data) continue;
    if (data.startingCost > corp.funds / 2) continue;

    const name = industry;
    if (corp.divisions.includes(name)) continue;

    if (dryRun) {
      ns.print(`[dry-run] would open ${industry} (cost ${money0(data.startingCost)})`);
      continue;
    }
    try {
      ns.corporation.expandIndustry(industry, name);
      ns.print(`opened division ${industry}`);
    } catch (e) {
      ns.print(`could not open ${industry}: ${String(e)}`);
    }
  }
}

/** Expand to every city, hire, size and balance every office. */
function manageOffices(ns: NS, corp: any, funds: number, dryRun: boolean): void {
  for (const division of corp.divisions) {
    const div = ns.corporation.getDivision(division);

    for (const city of CITIES) {
      if (!div.cities.includes(city)) {
        if (dryRun) {
          ns.print(`[dry-run] would expand ${division} to ${city}`);
          continue;
        }
        try {
          ns.corporation.expandCity(division, city);
        } catch {
          continue; // not enough funds this cycle
        }
      }

      const office = ns.corporation.getOffice(division, city);
      if (!office) continue;

      // Grow the office when the upgrade is cheap compared to our funds.
      const upgradeCost = ns.corporation.getOfficeSizeUpgradeCost(division, city, 2);
      if (upgradeCost > 0 && upgradeCost < funds / 10) {
        if (dryRun) ns.print(`[dry-run] would grow ${division}/${city} office for ${money0(upgradeCost)}`);
        else ns.corporation.upgradeOfficeSize(division, city, 2);
      }

      // Hire until the office is full.
      if (office.numEmployees < office.size) {
        if (dryRun) ns.print(`[dry-run] would hire ${office.size - office.numEmployees} in ${division}/${city}`);
        else for (let i = 0; i < office.size - office.numEmployees; ++i) ns.corporation.hireEmployee(division, city);
      }

      balanceJobs(ns, division, city, office, dryRun);
    }
  }
}

/**
 * Distribute employees across jobs in proportion to the production each job
 * is actually generating, so no position is left empty.
 */
function balanceJobs(ns: NS, division: string, city: CityName, office: any, dryRun: boolean): void {
  // "Unassigned" is a valid position key but setJobAssignment rejects it,
  // so we only balance the real job types.
  const jobs = ns.corporation
    .getConstants()
    .employeePositions.filter((j) => j !== "Unassigned");
  const prod = office.employeeProductionByJob;

  const weights = jobs.map((j) => Math.max(0.0001, prod[j] ?? 0));
  const total = weights.reduce((a, b) => a + b, 0);
  const size = office.size;

  const targets = weights.map((w) => Math.max(1, Math.round((w / total) * size)));
  let sum = targets.reduce((a, b) => a + b, 0);

  // Trim from the least productive jobs until we hit the office size.
  while (sum > size) {
    let idx = 0;
    for (let i = 1; i < targets.length; ++i) if (targets[i] < targets[idx]) idx = i;
    if (targets[idx] <= 0) break;
    targets[idx] -= 1;
    sum -= 1;
  }

  for (let i = 0; i < jobs.length; ++i) {
    if ((office.employeeJobs[jobs[i]] ?? 0) === targets[i]) continue;
    if (dryRun) {
      ns.print(`[dry-run] ${division}/${city}: ${jobs[i]} -> ${targets[i]} employees`);
      continue;
    }
    ns.corporation.setJobAssignment(division, city, jobs[i], targets[i]);
  }
}

/** Warehouses: buy one per division/city, upgrade when space is the limit. */
function manageWarehouses(ns: NS, corp: any, funds: number, dryRun: boolean): void {
  for (const division of corp.divisions) {
    const div = ns.corporation.getDivision(division);
    for (const city of div.cities) {
      if (!ns.corporation.hasWarehouse(division, city)) {
        if (dryRun) {
          ns.print(`[dry-run] would buy a warehouse for ${division} in ${city}`);
          continue;
        }
        try {
          ns.corporation.purchaseWarehouse(division, city);
        } catch {
          continue;
        }
      }

      const wh = ns.corporation.getWarehouse(division, city);
      const free = wh.size - wh.sizeUsed;
      const cost = ns.corporation.getUpgradeWarehouseCost(division, city, 1);

      if (cost > 0 && free < wh.size * 0.2 && cost < funds / 10) {
        if (dryRun) ns.print(`[dry-run] would upgrade ${division}/${city} warehouse for ${money0(cost)}`);
        else ns.corporation.upgradeWarehouse(division, city, 1);
      }
    }
  }
}

/** Design products with a conservative design/marketing split, then sell at market price. */
function manageProducts(ns: NS, corp: any, funds: number, dryRun: boolean): void {
  for (const division of corp.divisions) {
    const div = ns.corporation.getDivision(division);
    if (!div.makesProducts) continue;

    const city = div.cities[0];
    if (!city) continue;

    if (div.products.length < div.maxProducts) {
      const budget = Math.min(funds / 20, 1e9);
      if (budget > 1000) {
        const name = `${division} Product ${div.products.length + 1}`;
        if (dryRun) {
          ns.print(`[dry-run] would design ${name} (${money0(budget)} design, ${money0(budget)} marketing)`);
        } else {
          try {
            ns.corporation.makeProduct(division, city, name, budget, budget);
            ns.print(`designed ${name}`);
          } catch {
            /* not enough materials / research yet */
          }
        }
      }
    }

    for (const product of div.products) {
      const p = ns.corporation.getProduct(division, city, product);
      if (!p) continue;

      // Ad verts raise awareness/popularity, which is pure profit.
      const adCost = ns.corporation.getHireAdVertCost(division);
      if (adCost > 0 && adCost < funds / 15) {
        if (dryRun) ns.print(`[dry-run] would hire an ad vert for ${division} (${money0(adCost)})`);
        else ns.corporation.hireAdVert(division);
      }

      void p;
    }
  }
}

/** Buy the corp unlocks and level the upgrades when they are cheap. */
function manageUpgrades(ns: NS, funds: number, dryRun: boolean): void {
  const constants = ns.corporation.getConstants();

  for (const unlock of constants.unlockNames) {
    if (ns.corporation.hasUnlock(unlock)) continue;
    const cost = ns.corporation.getUnlockCost(unlock);
    if (cost <= 0 || cost > funds / 10) continue;

    if (dryRun) {
      ns.print(`[dry-run] would unlock ${unlock} for ${money0(cost)}`);
      continue;
    }
    try {
      ns.corporation.purchaseUnlock(unlock);
      ns.print(`unlocked ${unlock}`);
    } catch {
      /* ignore */
    }
  }

  for (const upgrade of constants.upgradeNames) {
    const cost = ns.corporation.getUpgradeLevelCost(upgrade);
    const level = ns.corporation.getUpgradeLevel(upgrade);
    if (cost <= 0 || cost > funds / 12 || level >= 10) continue;

    if (dryRun) {
      ns.print(`[dry-run] would level ${upgrade} (${level} -> ${level + 1}) for ${money0(cost)}`);
      continue;
    }
    try {
      ns.corporation.levelUpgrade(upgrade);
    } catch {
      /* ignore */
    }
  }
}

/** Take investment offers, go public, and pay out dividends. */
function manageInvestors(ns: NS, corp: any, dryRun: boolean): void {
  const offer = ns.corporation.getInvestmentOffer();
  if (offer.funds > 0 && offer.round <= 4) {
    if (dryRun) {
      ns.print(`[dry-run] would accept investment offer: ${money0(offer.funds)} for ${offer.shares} shares`);
    } else if (ns.corporation.acceptInvestmentOffer()) {
      ns.print(`accepted investment of ${money0(offer.funds)}`);
    }
  }

  if (!corp.public && corp.valuation > 1e9) {
    if (dryRun) {
      ns.print("[dry-run] would go public");
    } else if (ns.corporation.goPublic(1_000_000)) {
      ns.print("corporation is public");
      ns.corporation.issueDividends(0.5);
    }
  }
}

function money0(n: number): string {
  if (n >= 1e12) return (n / 1e12).toFixed(2) + "T";
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return n.toFixed(0);
}