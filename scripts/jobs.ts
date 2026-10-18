/**
 * jobs.ts
 * ============================================================================
 * Career automation:
 *   - walks every company and every job field
 *   - applies to the highest-ranked position each field will offer
 *   - keeps the company with the best favor gain as the current job
 *   - quits a job when a better-ranked one is available
 *
 * RAM cost (GB):
 *   base 1.6 | applyToCompany 1 | workForCompany 3 | getCompanyRep 1
 *   getCompanyFavor 1 | getCompanyFavorGain 1 | getCompanyPositions 1
 *   getCompanyPositionInfo 1 | quitJob 1 | isBusy 0.5 | getPlayer 0.5
 *   + core.ts helpers (inBladeburner 0, getCurrentAction 1, isBusy 0.5,
 *     getOwnedAugmentations 5) - already counted in the isBusy line
 *   + getHostname 0.05 | getServerMaxRam 0.05
 *   => 24 GB (ramgap.mjs computes the exact number)
 *
 * Bladeburner note: workForCompany() sets Player.currentWork, which cancels a
 * running Bladeburner action unless BladesSimulacrum is installed, so the module
 * checks core.workBladeburnerConflict() before taking over the player's time.
 *
 * Usage
 *   run jobs.ts
 *   run jobs.ts --dry-run --companies 10
 */

// Bitburner injects its API typings as a global declaration file, so `NS`
// needs no import (globals.d.ts mirrors that for local `tsc` checks).

// core.ts is imported statically on purpose. Bitburner's RAM allocation is
// computed from the AST of the script and everything it *statically* imports;
// ns.dynamicImport() is invisible to that pass, so the API calls core.ts makes
// would not be paid for and the game would abort the script with a RAM error.
import * as core from "./core.ts";
import * as logger from "./logger.ts";

const RAM_NEEDED = 24;

/** Types pulled from the enums so every name passed to the API is valid. */
type Company = ReturnType<typeof companies>[number];
type Field = ReturnType<typeof fields>[number];

function companies(ns: NS) {
  return Object.values(ns.enums.CompanyName);
}

function fields(ns: NS) {
  return Object.values(ns.enums.JobField);
}

/**
 * CompanyPositionInfo has no explicit rank, so we rank positions by the
 * reputation they demand: a higher requirement means a higher position.
 */
function positionScore(ns: NS, company: Company, position: string): number {
  const info = ns.singularity.getCompanyPositionInfo(company, position as any);
  return info.requiredReputation * 1000 + info.salary;
}

export async function main(ns: NS): Promise<void> {
  ns.clearLog();
  ns.disableLog("ALL");

  const args = ns.args.map(String);
  const dryRun = args.includes("--dry-run");
  const loops = core.maxLoops(args);
  const limit = core.numOr(args, "--companies", 25);
  const host = ns.getHostname();

  if (ns.getServerMaxRam(host) < RAM_NEEDED) {
    logger.tlog(ns, `jobs.ts needs ${RAM_NEEDED} GB; ${host} has ${ns.getServerMaxRam(host)} GB.`);
    return;
  }

  const allCompanies = companies(ns).slice(0, limit);
  const allFields = fields(ns);
  logger.log(ns, `=== jobs module (${allCompanies.length} companies) ===`);

  for (let loop = 0; loop < loops; ++loop) {
    const jobs = ns.getPlayer().jobs;

    // 1. Score every company we can actually get hired by.
    let best: { company: Company; score: number; gain: number } | null = null;

    for (const company of allCompanies) {
      const gain = ns.singularity.getCompanyFavorGain(company);
      if (gain <= 0) continue;
      const score = bestScoreFor(ns, company, allFields);
      if (score <= 0) continue;
      if (!best || gain > best.gain) best = { company, score, gain };
    }

    if (!best) {
      logger.log(ns, "No company will hire us yet - raise stats or join a faction first.");
      break;
    }

    // 2. Leave a current job if the new one is better.
    for (const company of allCompanies) {
      const position = jobs[company];
      if (!position) continue;
      if (positionScore(ns, company, position) < best.score) {
        if (dryRun) logger.log(ns, `[dry-run] would quit ${company}`);
        else ns.singularity.quitJob(company);
      }
    }

    // 3. Apply for the best position and work there.
    if (dryRun) {
      logger.log(ns, 
        `[dry-run] would work at ${best.company} (score ${best.score}, ` +
          `favor gain ${best.gain.toFixed(2)})`,
      );
    } else {
      const position = applyBest(ns, best.company, allFields);
      if (position) {
        if (core.workBladeburnerConflict(ns)) {
          logger.log(ns, `Bladeburner action running - not working at ${best.company} (it would cancel the action)`);
        } else if (!ns.singularity.isBusy()) {
          logger.log(ns, `working at ${best.company} as ${position}`);
          ns.singularity.workForCompany(best.company);
        }
      }
    }

    await ns.sleep(5000);
  }
}

/** The highest position score a company is willing to offer us right now. */
function bestScoreFor(ns: NS, company: Company, allFields: Field[]): number {
  let score = 0;
  for (const field of allFields) {
    const position = ns.singularity.applyToCompany(company, field);
    if (!position) continue;
    const s = positionScore(ns, company, position);
    if (s > score) score = s;
  }
  return score;
}

/** Apply across every field and keep the best offer. */
function applyBest(ns: NS, company: Company, allFields: Field[]): string | null {
  let bestPosition: string | null = null;
  let bestScore = 0;

  for (const field of allFields) {
    const position = ns.singularity.applyToCompany(company, field);
    if (!position) continue;
    const s = positionScore(ns, company, position);
    if (s > bestScore) {
      bestScore = s;
      bestPosition = position;
    }
  }

  return bestPosition;
}