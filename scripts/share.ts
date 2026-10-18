/**
 * share.ts
 * ============================================================================
 * The classic "share" loop: run this on every server with spare RAM to farm
 * charisma XP and, with Augmentation 24 (Share Programmes), real money.
 *
 * RAM cost (GB): base 1.6 + share 2.4 = 4 GB per script instance.
 *
 * Usage
 *   run share.ts 100
 */

// Bitburner injects its API typings as a global declaration file, so `NS`
// needs no import (globals.d.ts mirrors that for local `tsc` checks).

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const threads = Number(ns.args[0] ?? 1);
  void threads; // threads are set by exec/run, not by the script itself

  while (true) {
    await ns.share();
  }
}
