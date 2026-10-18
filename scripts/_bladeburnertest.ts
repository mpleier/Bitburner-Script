/**
 * _bladeburnertest.ts
 * ============================================================================
 * Guard test for the "Bladeburner action cancelled because you started doing
 * something else" behaviour.
 *
 * src/Bladeburner/Bladeburner.ts -> Bladeburner.process() (paraphrased):
 *   if (Player.currentWork && !Player.hasAugmentation(AugmentationName.BladesSimulacrum, true)) {
 *     this.cancelAction();   // action reset, automation switched off, dialog shown
 *   }
 *
 * Run:  node mocksuite.mjs _bladeburnertest --verbose
 *       node mocksuite.mjs _bladeburnertest --blades-simulacrum --verbose
 */

import * as core from "./core.ts";
import * as logger from "./logger.ts";

/** core.ts helpers (11.3 GB) + Bladeburner/singularity calls this test makes: 19.35 GB worst case. */
const RAM_NEEDED = 20;

export async function main(ns: NS): Promise<void> {
  const here = ns.getHostname();
  if (ns.getServerMaxRam(here) < RAM_NEEDED) {
    logger.tlog(ns, `_bladeburnertest.ts needs ${RAM_NEEDED} GB; ${here} has ${ns.getServerMaxRam(here)} GB.`);
    return;
  }

  const failures: string[] = [];
  const expect = (cond: boolean, msg: string) => {
    if (!cond) failures.push(msg);
  };

  const simulacrum = core.hasBladesSimulacrum(ns);
  logger.log(ns, `BladesSimulacrum installed: ${simulacrum}`);
  logger.log(ns, `in Bladeburner: ${ns.bladeburner.inBladeburner()}`);

  /* 1. Idle player: nothing cancels a Bladeburner action. */
  expect(!ns.singularity.isBusy(), "mock should start with no currentWork");
  expect(!core.wouldCancelBladeburner(ns), "idle player must not cancel Bladeburner");

  /* 2. Faction work sets Player.currentWork, so it must cancel the action. */
  ns.singularity.workForFaction("CyberSec", "hacking");
  expect(ns.singularity.isBusy(), "workForFaction() must set Player.currentWork");
  expect(
    core.wouldCancelBladeburner(ns) === !simulacrum,
    "faction work should cancel Bladeburner only without BladesSimulacrum",
  );

  /* 3. The mock mirrors Bladeburner.process(): the action is gone. */
  ns.bladeburner.startAction("Operations", "Raid");
  const action = ns.bladeburner.getCurrentAction();
  if (simulacrum) {
    expect(action != null, "BladesSimulacrum should protect the running action");
  } else {
    expect(action == null, "player work should have reset the Bladeburner action");
  }

  /* 4. bladeburner.ts must not start an action while the player is working. */
  expect(core.wouldCancelBladeburner(ns) === !simulacrum,
    "wouldCancelBladeburner must be true only without BladesSimulacrum");

  /* 5. jobs.ts / factions.ts / crime.ts gate on core.workBladeburnerConflict(). */
  expect(core.workBladeburnerConflict(ns) === !simulacrum,
    "work + Bladeburner is a conflict unless BladesSimulacrum is installed");

  /* 6. Freeing the player's time removes the conflict. */
  ns.singularity.stopAction();
  expect(!ns.singularity.isBusy(), "stopAction() must clear the work slot");
  expect(!core.workBladeburnerConflict(ns), "no work and no action means no conflict");

  if (failures.length === 0) {
    logger.log(ns, "PASS: Bladeburner/work conflict guards behave like the real game");
  } else {
    for (const f of failures) logger.log(ns, `FAIL: ${f}`);
    throw new Error(`Bladeburner guard test failed (${failures.length} assertions)`);
  }
}