/**
 * ascend.ts
 * ============================================================================
 * Progression module: decides when installing augmentations is worth a reset,
 * and which bitnode to enter next.
 *
 * Why a module for this at all? Installing augmentations is a soft reset. It
 * wipes money, servers, hacknet nodes, the corporation and every script except
 * the ones on home. Doing it for one NeuroFlux Governor is a terrible trade;
 * doing it for eight at once is not. bitnode-policy.ts encodes that rule.
 *
 * The module never resets unless it is explicitly asked to:
 *   - by default it only reports what it would do
 *   - --ascend arms it, and it installs once the batch threshold is met
 *
 * It also writes state_ascend.json so the scheduler and the other modules can
 * see the plan, and claims a lock (state_ascend_lock.json) so two scripts can
 * never trigger a reset in the same tick.
 *
 * RAM cost (GB): base 1.6
 *   + core.ts 11.9 (getResetInfo, hasRootAccess, scan, getPlayer, ...)
 *   + getOwnedAugmentations 5 | installAugmentations 5 | isBusy 0.5
 *   + bladeburner.getCurrentAction 1 | rm 0.6 | write/read 0
 *   => 16.95 GB; RAM_NEEDED below is 17 GB. `npm run ram` recomputes it.
 *
 * Usage
 *   run ascend.ts
 *   run ascend.ts --ascend
 *   run ascend.ts --ascend --batch 8
 *   run ascend.ts --dry-run --loops 3
 */

// Bitburner injects its API typings as a global declaration file, so `NS`
// needs no import (globals.d.ts mirrors that for local `tsc` checks).

import * as core from "./core.ts";
import * as logger from "./logger.ts";
import * as state from "./state.ts";
import * as bitnodes from "./bitnode-policy.ts";
import * as spending from "./spending-policy.ts";

const RAM_NEEDED = 17;

/** Augmentations that are owned but sitting in the install queue. */
function queuedAugmentations(ns: NS): string[] {
  const installed = core.tryCall(() => ns.singularity.getOwnedAugmentations(false), [] as string[]);
  const all = core.tryCall(() => ns.singularity.getOwnedAugmentations(true), [] as string[]);
  const have = new Set(installed);
  return all.filter((aug) => !have.has(aug));
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  const args = ns.args.map(String);
  const dryRun = core.hasFlag(args, "--dry-run");
  const armed = core.hasFlag(args, "--ascend");
  const interval = core.numOr(args, "--interval", 5000);
  const loops = core.maxLoops(args);
  const host = ns.getHostname();

  if (ns.getServerMaxRam(host) < RAM_NEEDED) {
    logger.tlog(ns, `ascend.ts needs ${RAM_NEEDED} GB; ${host} has ${ns.getServerMaxRam(host)} GB.`);
    return;
  }

  const owned = core.ownedSourceFiles(ns);
  const threshold = core.numOr(args, "--batch", bitnodes.ascendThreshold(owned));

  logger.log(ns, "=== ascend module ===");
  logger.log(ns, `bitnode ${core.bitnode(ns)} | ${owned.length} source files | install batch threshold ${threshold}`);

  for (let loop = 0; loop < loops; ++loop) {
    const queued = queuedAugmentations(ns);
    const next = bitnodes.nextBitnode(owned, "any", core.bitnode(ns));
    const money = core.money(ns);
    const augsBudget = spending.allowance(money, "augs");

    const plan = {
      queued: queued.length,
      queuedNames: queued.slice(0, 20),
      threshold,
      armed,
      ready: bitnodes.shouldAscend(queued.length, threshold),
      nextBitnode: next ? next.id : null,
      nextBitnodeName: next ? next.name : null,
      augsBudget,
    };

    state.writeState(ns, "ascend", plan, Math.max(interval * 6, 60000));

    logger.log(ns,
      `queued ${queued.length} augmentation(s) (threshold ${threshold}) | ` +
      `budget ${core.fmt(augsBudget)} | ` +
      (next ? `next bitnode BN${next.id} ${next.name}` : "no bitnode left to enter"),
    );

    if (!plan.ready) {
      if (loop + 1 < loops) await ns.sleep(interval);
      continue;
    }

    if (!armed) {
      logger.log(ns, "batch is ready, but ascend.ts is not armed - pass --ascend to install them");
      if (loop + 1 < loops) await ns.sleep(interval);
      continue;
    }

    // A reset cancels everything, so make sure nothing is mid-action first.
    if (core.workBladeburnerConflict(ns)) {
      logger.log(ns, "a Bladeburner action is running; installing augmentations would cancel it. Waiting.");
      if (loop + 1 < loops) await ns.sleep(interval);
      continue;
    }

    const lock = state.claim(ns, "ascend_lock", Math.max(interval * 4, 30000));
    if (!lock.ok) {
      logger.log(ns, `another script holds the ascend lock: ${lock.reason}`);
      if (loop + 1 < loops) await ns.sleep(interval);
      continue;
    }

    if (dryRun) {
      logger.log(ns, `[dry-run] would install ${queued.length} augmentations and soft reset`);
    } else {
      logger.log(ns, `installing ${queued.length} augmentations - the game resets`);
      try {
        ns.singularity.installAugmentations("autobot.ts");
      } catch (err) {
        logger.log(ns, `installAugmentations failed: ${String(err)}`);
      }
    }

    state.release(ns, "ascend_lock");
    return; // installAugmentations resets the game; there is nothing left to loop over
  }
}
