/**
 * share.ts
 * ============================================================================
 * The classic "share" loop: run this on every server with spare RAM to farm
 * charisma XP and, with Augmentation 24 (Share Programmes), real money.
 *
 * RAM cost (GB): base 1.6 + share 2.4 = 4 GB per script instance,
 *                + 1 GB for the Bladeburner probe (inBladeburner 0, getCurrentAction 1)
 *                + 0.1 GB for the host checks  => 5.1 GB.
 *
 * Important: ns.share() sets Player.currentWork. Bladeburner.process() cancels a
 * running Bladeburner action whenever Player.currentWork is set and the player
 * does not own BladesSimulacrum, so share.ts must not steal the player's time
 * while an operation is in progress. If you do own BladesSimulacrum (or do not
 * care about the Bladeburner action), pass --ignore-bladeburner.
 *
 * Usage
 *   run share.ts 100
 *   run share.ts 100 --ignore-bladeburner
 */

// Bitburner injects its API typings as a global declaration file, so `NS`
// needs no import (globals.d.ts mirrors that for local `tsc` checks).

import * as logger from "./logger.ts";

/** RAM this script reserves: 1.6 base + share 2.4 + Bladeburner probe 1 + host checks 0.1. */
const RAM_NEEDED = 6;



export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const threads = Number(ns.args[0] ?? 1);
  void threads; // threads are set by exec/run, not by the script itself

  const host = ns.getHostname();
  if (ns.getServerMaxRam(host) < RAM_NEEDED) {
    logger.tlog(ns, `share.ts needs ${RAM_NEEDED} GB; ${host} has ${ns.getServerMaxRam(host)} GB.`);
    return;
  }

  const ignoreBladeburner = ns.args.some((a) => String(a) === "--ignore-bladeburner");

  while (true) {
    // Cheap gate first: inBladeburner() costs 0 GB and never throws.
    if (!ignoreBladeburner && ns.bladeburner.inBladeburner() && ns.bladeburner.getCurrentAction() != null) {
      logger.log(ns, "Bladeburner is running an action; sharing would cancel it. Waiting.");
      await ns.sleep(1000);
      continue;
    }
    await ns.share();
  }
}
