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

import type { NS } from "../defs.d";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const threads = Number(ns.args[0] ?? 1);
  void threads; // threads are set by exec/run, not by the script itself

  while (true) {
    await ns.share();
  }
}
