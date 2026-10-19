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
 *   => ~455 GB. Run it on home once you have upgraded RAM, or on a big server.
 *
 * Usage
 *   run corporation.ts
 *   run corporation.ts --dry-run --divisions 3
 */

// Bitburner injects its API typings as a global declaration file, so `NS`
// needs no import (globals.d.ts mirrors that for local `tsc` checks).
import type { CityName, CorpIndustryName } from "./types";

// core.ts is imported statically on purpose. Bitburner's RAM allocation is
// computed from the AST of the script and everything it *statically* imports;
// ns.dynamicImport() is invisible to that pass, so the API calls core.ts makes
// would not be paid for and the game would abort the script with a RAM error.
import * as core from "./core.ts";
import * as logger from "./logger.ts";
// spending-policy.ts makes no API calls, so importing it costs only the 1.6 GB
// base script cost. Seeding a corporation is the single largest purchase the
// suite ever makes, so it is checked against the shared budget rather than
// simply "can we pay it".
import * as spending from "./spending-policy.ts";


const RAM_NEEDED = 462;

/**
 * Cost of creating a corporation, straight from the game source
 * (src/Corporation/helpers.ts -> costOfCreatingCorporation):
 *   - self-funded:  $150b
 *   - re-creating a seed-funded corp after a reset: $50b
 *
 * canCreateCorporation() only checks SF3 / BitNode / "corp already exists".
 * It does NOT look at your money, so it happily returns "Success" while
 * createCorporation() returns false because you cannot pay the $150b. That is
 * the "failed even though canCreateCorporation said Success" case.
 */
const SELF_FUND_COST = 150_000_000_000;

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
  const dryRun = args.includes("--dry-run");
  const loops = core.maxLoops(args);
  const maxDivisions = core.numOr(args, "--divisions", 4);
  const host = ns.getHostname();

  if (ns.getServerMaxRam(host) < RAM_NEEDED) {
    logger.tlog(ns, `corporation.ts needs ${RAM_NEEDED} GB; ${host} has ${ns.getServerMaxRam(host)} GB.`);
    logger.tlog(ns, "Upgrade home RAM, or run it on a server with more memory.");
    return;
  }

  if (!core.subsystemAvailable(ns, "corporation")) {
    logger.tlog(ns, "Corporations are disabled in this bitnode.");
    return;
  }

  logger.log(ns, "=== corporation module ===");

  for (let loop = 0; loop < loops; ++loop) {
    if (!ns.corporation.hasCorporation()) {
      const check = ns.corporation.canCreateCorporation(true);
      if (check !== "Success") {
        logger.tlogOnce(ns, `corporation.ts: cannot create a corporation (${check}). Exiting.`);
        return;
      }

      // canCreateCorporation() says "Success" as soon as you own SF3, but
      // createCorporation() still needs $150b. Check it ourselves, otherwise the
      // module exits every interval with a message that looks like a bug.
      const cash = core.money(ns);
      /* Seeding the corp is a $150b hit. The shared budget in spending-policy.ts
         caps how much of the bankroll any one subsystem may touch, so we only
         self-fund when the corp slice still covers the cost - i.e. when starting
         a corporation does not leave the gang, hacknet and the aug shop broke. */
      const seedBudget = spending.allowance(cash, "corporation");
      if (cash < SELF_FUND_COST || seedBudget < SELF_FUND_COST) {
        logger.tlogOnce(ns,
          `corporation.ts: creating a corporation costs ${core.fmt(SELF_FUND_COST)}, ` +
          `you have ${core.fmt(cash)} but the corp budget is only ${core.fmt(seedBudget)}. ` +
          "Seed money (createCorporation(name, false)) is only allowed in BitNode 3. " +
          "Keep earning, then re-run this module.",
        );
        return;
      }

      if (dryRun) {
        logger.log(ns, "[dry-run] would create a corporation");
        // There is nothing to manage without a corporation, and every
        // Corporation API except hasCorporation/canCreateCorporation -
        // nextUpdate included - throws "Must own a corporation."
        return;
      }

      if (!ns.corporation.createCorporation("Bitburner Industries", true)) {
        logger.tlogOnce(ns,
          "corporation.ts: createCorporation() returned false. The game wrote the " +
          "reason to this script's log - run `tail corporation.ts` to see it. Exiting.",
        );
        return;
      }
      logger.log(ns, "corporation created");
    }

    // From here on a corporation is guaranteed to exist, so the rest of the
    // Corporation API is safe to call.
    if (!ns.corporation.hasCorporation()) continue;

    const corp = ns.corporation.getCorporation();
    const funds = corp.funds;

    /* Each manager returns what it did this cycle; the detail lines are only
       printed with --verbose so the terminal gets one line per update. */
    const opened = openDivisions(ns, corp, maxDivisions, dryRun);
    const offices = manageOffices(ns, corp, funds, dryRun);
    const warehouses = manageWarehouses(ns, corp, funds, dryRun);
    const products = manageProducts(ns, corp, funds, dryRun);
    const upgrades = manageUpgrades(ns, funds, dryRun);
    const investors = manageInvestors(ns, corp, dryRun);

    const done: string[] = [];
    if (opened) done.push(`${opened} division${opened > 1 ? "s" : ""}`);
    if (offices.cities) done.push(`${offices.cities} city office${offices.cities > 1 ? "s" : ""}`);
    if (offices.grows) done.push(`${offices.grows} office expansion${offices.grows > 1 ? "s" : ""}`);
    if (offices.hires) done.push(`${offices.hires} hire${offices.hires > 1 ? "s" : ""}`);
    if (offices.jobs) done.push(`${offices.jobs} job rebalance${offices.jobs > 1 ? "s" : ""}`);
    if (warehouses.bought) done.push(`${warehouses.bought} warehouse${warehouses.bought > 1 ? "s" : ""}`);
    if (warehouses.upgraded) done.push(`${warehouses.upgraded} warehouse upgrade${warehouses.upgraded > 1 ? "s" : ""}`);
    if (products.designs) done.push(`${products.designs} product design${products.designs > 1 ? "s" : ""}`);
    if (products.adverts) done.push(`${products.adverts} ad vert${products.adverts > 1 ? "s" : ""}`);
    if (upgrades.unlocks) done.push(`${upgrades.unlocks} unlock${upgrades.unlocks > 1 ? "s" : ""}`);
    if (upgrades.levels) done.push(`${upgrades.levels} upgrade level${upgrades.levels > 1 ? "s" : ""}`);
    if (investors.offers) done.push(`${investors.offers} investment offer${investors.offers > 1 ? "s" : ""}`);

    logger.log(ns,
      `${corp.name} | funds ${core.fmt(funds)} | revenue ${core.fmt(corp.revenue)}/s | ` +
        `expenses ${core.fmt(corp.expenses)}/s | divisions ${corp.divisions.length} | ` +
        `valuation ${core.fmt(corp.valuation)}` +
        (done.length ? ` | this cycle: ${done.join(", ")}` : ""),
    );

    await ns.corporation.nextUpdate();
  }
}

/** Open divisions in the best industries we can afford. Returns how many. */
function openDivisions(ns: NS, corp: any, maxDivisions: number, dryRun: boolean): number {
  if (corp.divisions.length >= maxDivisions) return 0;

  let opened = 0;

  for (const industry of INDUSTRY_ORDER) {
    if (corp.divisions.length + opened >= maxDivisions) break;

    const data = ns.corporation.getIndustryData(industry);
    if (!data) continue;
    if (data.startingCost > corp.funds / 2) continue;

    const name = industry;
    if (corp.divisions.includes(name)) continue;

    if (dryRun) {
      if (logger.verbose(ns)) {
        logger.log(ns, `[dry-run] would open ${industry} (cost ${money0(data.startingCost)})`);
      }
      opened += 1;
      continue;
    }
    try {
      ns.corporation.expandIndustry(industry, name);
      opened += 1;
      if (logger.verbose(ns)) logger.log(ns, `opened division ${industry}`);
    } catch (e) {
      logger.log(ns, `could not open ${industry}: ${String(e)}`);
    }
  }

  return opened;
}

/** Expand to every city, hire, size and balance every office. */
function manageOffices(
  ns: NS,
  corp: any,
  funds: number,
  dryRun: boolean,
): { cities: number; grows: number; hires: number; jobs: number } {
  const tally = { cities: 0, grows: 0, hires: 0, jobs: 0 };

  for (const division of corp.divisions) {
    const div = ns.corporation.getDivision(division);

    for (const city of CITIES) {
      if (!div.cities.includes(city)) {
        if (dryRun) {
          if (logger.verbose(ns)) logger.log(ns, `[dry-run] would expand ${division} to ${city}`);
          tally.cities += 1;
          continue;
        }
        try {
          ns.corporation.expandCity(division, city);
          tally.cities += 1;
        } catch {
          continue; // not enough funds this cycle
        }
      }

      const office = ns.corporation.getOffice(division, city);
      if (!office) continue;

      // Grow the office when the upgrade is cheap compared to our funds.
      const upgradeCost = ns.corporation.getOfficeSizeUpgradeCost(division, city, 2);
      if (upgradeCost > 0 && upgradeCost < funds / 10) {
        if (dryRun) {
          if (logger.verbose(ns)) {
            logger.log(ns, `[dry-run] would grow ${division}/${city} office for ${money0(upgradeCost)}`);
          }
        } else {
          ns.corporation.upgradeOfficeSize(division, city, 2);
        }
        tally.grows += 1;
      }

      // Hire until the office is full.
      if (office.numEmployees < office.size) {
        const openings = office.size - office.numEmployees;
        if (dryRun) {
          if (logger.verbose(ns)) {
            logger.log(ns, `[dry-run] would hire ${openings} in ${division}/${city}`);
          }
        } else {
          for (let i = 0; i < openings; ++i) ns.corporation.hireEmployee(division, city);
        }
        tally.hires += openings;
      }

      tally.jobs += balanceJobs(ns, division, city, office, dryRun);
    }
  }

  return tally;
}

/**
 * Distribute employees across jobs in proportion to the production each job
 * is actually generating, so no position is left empty.
 */
function balanceJobs(ns: NS, division: string, city: CityName, office: any, dryRun: boolean): number {
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

  let changes = 0;
  for (let i = 0; i < jobs.length; ++i) {
    if ((office.employeeJobs[jobs[i]] ?? 0) === targets[i]) continue;
    if (dryRun) {
      if (logger.verbose(ns)) {
        logger.log(ns, `[dry-run] ${division}/${city}: ${jobs[i]} -> ${targets[i]} employees`);
      }
      changes += 1;
      continue;
    }
    ns.corporation.setJobAssignment(division, city, jobs[i], targets[i]);
    changes += 1;
  }

  return changes;
}

/** Warehouses: buy one per division/city, upgrade when space is the limit. */
function manageWarehouses(
  ns: NS,
  corp: any,
  funds: number,
  dryRun: boolean,
): { bought: number; upgraded: number } {
  const tally = { bought: 0, upgraded: 0 };

  for (const division of corp.divisions) {
    const div = ns.corporation.getDivision(division);
    for (const city of div.cities) {
      if (!ns.corporation.hasWarehouse(division, city)) {
        if (dryRun) {
          if (logger.verbose(ns)) {
            logger.log(ns, `[dry-run] would buy a warehouse for ${division} in ${city}`);
          }
          tally.bought += 1;
          continue;
        }
        try {
          ns.corporation.purchaseWarehouse(division, city);
          tally.bought += 1;
        } catch {
          continue;
        }
      }

      const wh = ns.corporation.getWarehouse(division, city);
      const free = wh.size - wh.sizeUsed;
      const cost = ns.corporation.getUpgradeWarehouseCost(division, city, 1);

      if (cost > 0 && free < wh.size * 0.2 && cost < funds / 10) {
        if (dryRun) {
          if (logger.verbose(ns)) {
            logger.log(ns, `[dry-run] would upgrade ${division}/${city} warehouse for ${money0(cost)}`);
          }
        } else {
          ns.corporation.upgradeWarehouse(division, city, 1);
        }
        tally.upgraded += 1;
      }
    }
  }

  return tally;
}

/** Design products with a conservative design/marketing split, then sell at market price. */
function manageProducts(
  ns: NS,
  corp: any,
  funds: number,
  dryRun: boolean,
): { designs: number; adverts: number } {
  const tally = { designs: 0, adverts: 0 };

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
          if (logger.verbose(ns)) {
            logger.log(ns, `[dry-run] would design ${name} (${money0(budget)} design, ${money0(budget)} marketing)`);
          }
          tally.designs += 1;
        } else {
          try {
            ns.corporation.makeProduct(division, city, name, budget, budget);
            tally.designs += 1;
            if (logger.verbose(ns)) logger.log(ns, `designed ${name}`);
          } catch {
            /* not enough materials / research yet */
          }
        }
      }
    }

    // Ad verts are per division, not per product, so one check is enough.
    const adCost = ns.corporation.getHireAdVertCost(division);
    if (adCost > 0 && adCost < funds / 15) {
      if (dryRun) {
        if (logger.verbose(ns)) {
          logger.log(ns, `[dry-run] would hire an ad vert for ${division} (${money0(adCost)})`);
        }
      } else {
        ns.corporation.hireAdVert(division);
      }
      tally.adverts += 1;
    }
  }

  return tally;
}

/** Buy the corp unlocks and level the upgrades when they are cheap. */
function manageUpgrades(ns: NS, funds: number, dryRun: boolean): { unlocks: number; levels: number } {
  const constants = ns.corporation.getConstants();
  const tally = { unlocks: 0, levels: 0 };

  for (const unlock of constants.unlockNames) {
    if (ns.corporation.hasUnlock(unlock)) continue;
    const cost = ns.corporation.getUnlockCost(unlock);
    if (cost <= 0 || cost > funds / 10) continue;

    if (dryRun) {
      if (logger.verbose(ns)) logger.log(ns, `[dry-run] would unlock ${unlock} for ${money0(cost)}`);
      tally.unlocks += 1;
      continue;
    }
    try {
      ns.corporation.purchaseUnlock(unlock);
      tally.unlocks += 1;
      if (logger.verbose(ns)) logger.log(ns, `unlocked ${unlock}`);
    } catch {
      /* ignore */
    }
  }

  for (const upgrade of constants.upgradeNames) {
    const cost = ns.corporation.getUpgradeLevelCost(upgrade);
    const level = ns.corporation.getUpgradeLevel(upgrade);
    if (cost <= 0 || cost > funds / 12 || level >= 10) continue;

    if (dryRun) {
      if (logger.verbose(ns)) {
        logger.log(ns, `[dry-run] would level ${upgrade} (${level} -> ${level + 1}) for ${money0(cost)}`);
      }
      tally.levels += 1;
      continue;
    }
    try {
      ns.corporation.levelUpgrade(upgrade);
      tally.levels += 1;
    } catch {
      /* ignore */
    }
  }

  return tally;
}

/** Take investment offers, go public, and pay out dividends. */
function manageInvestors(ns: NS, corp: any, dryRun: boolean): { offers: number } {
  const tally = { offers: 0 };

  const offer = ns.corporation.getInvestmentOffer();
  if (offer.funds > 0 && offer.round <= 4) {
    if (dryRun) {
      if (logger.verbose(ns)) {
        logger.log(ns, `[dry-run] would accept investment offer: ${money0(offer.funds)} for ${offer.shares} shares`);
      }
      tally.offers += 1;
    } else if (ns.corporation.acceptInvestmentOffer()) {
      tally.offers += 1;
      logger.log(ns, `accepted investment of ${money0(offer.funds)}`);
    }
  }

  if (!corp.public && corp.valuation > 1e9) {
    if (dryRun) {
      if (logger.verbose(ns)) logger.log(ns, "[dry-run] would go public");
    } else if (ns.corporation.goPublic(1_000_000)) {
      // A one-off milestone, so it stays in the log without --verbose.
      logger.log(ns, "corporation is public");
      ns.corporation.issueDividends(0.5);
    }
  }

  return tally;
}

function money0(n: number): string {
  if (n >= 1e12) return (n / 1e12).toFixed(2) + "T";
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return n.toFixed(0);
}