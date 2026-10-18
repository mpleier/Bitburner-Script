/**
 * darknet.ts
 * ============================================================================
 * Darknet (BitNode 15 / Source-File 15) network explorer:
 *   - probes the servers directly connected to the current one
 *   - pulls each server's details (model, password length/format, hints)
 *   - heartbleeds the logs to mine password candidates
 *   - authenticates with the discovered candidates
 *   - frees blocked RAM and stasis-links the servers worth keeping
 *   - reports darknet instability so you know when to back off
 *
 * RAM cost (GB):
 *   base 1.6 | probe 0.2 | getServerDetails 0.1 | authenticate 0.4
 *   connectToSession 0.05 | heartbleed 0.6 | setStasisLink 12
 *   getStasisLinkLimit 0 | getStasisLinkedServers 0 | getDarknetInstability 0
 *   getBlockedRam 0 | memoryReallocation 1
 *   + getHostname 0.05 | getServerMaxRam 0.05
 *   => ~26 GB
 *
 * Usage
 *   run darknet.ts
 *   run darknet.ts --dry-run --max-attempts 20
 */

import type { NS } from "../defs.d";

const RAM_NEEDED = 26;

export async function main(ns: NS): Promise<void> {
  ns.clearLog();
  ns.disableLog("ALL");

  const args = ns.args.map(String);
  const core = await ns.dynamicImport("./core.ts");
  const dryRun = args.includes("--dry-run");
  const loops = core.maxLoops(args);
  const maxAttempts = core.numOr(args, "--max-attempts", 25);
  const host = ns.getHostname();

  if (ns.getServerMaxRam(host) < RAM_NEEDED) {
    ns.print(`darknet.ts needs ${RAM_NEEDED} GB; ${host} has ${ns.getServerMaxRam(host)} GB.`);
    return;
  }

  if (!core.subsystemAvailable(ns, "darknet")) {
    ns.print("The darknet API is only available in BitNode 10.");
    return;
  }

  ns.print("=== darknet module ===");

  for (let loop = 0; loop < loops; ++loop) {
    const instability = ns.dnet.getDarknetInstability();
    const linkLimit = ns.dnet.getStasisLinkLimit();
    const linked = ns.dnet.getStasisLinkedServers();

    const neighbours = ns.dnet.probe();
    ns.print(
      `${neighbours.length} connected servers | instability auth x` +
        `${instability.authenticationDurationMultiplier.toFixed(2)} ` +
        `(${(instability.authenticationTimeoutChance * 100).toFixed(1)}% timeout) | ` +
        `stasis links ${linked.length}/${linkLimit}`,
    );

    for (const target of neighbours) {
      const details = ns.dnet.getServerDetails(target);
      if (!details.isOnline) continue;

      const blocked = ns.dnet.getBlockedRam(target);
      if (blocked > 0 && !dryRun) await ns.dnet.memoryReallocation(target);

      const candidates = await harvestCandidates(ns, target, dryRun);

      if (dryRun) {
        ns.print(
          `[dry-run] ${target}: model ${details.modelId}, password ` +
            `${details.passwordLength} chars (${details.passwordFormat}), ` +
            `hint "${details.passwordHint}", ${candidates.length} candidates`,
        );
        continue;
      }

      if (details.hasSession) {
        ns.print(`${target}: already have a session`);
        continue;
      }

      for (const password of candidates.slice(0, maxAttempts)) {
        const result = await ns.dnet.authenticate(target, password);
        if (result.success) {
          ns.print(`authenticated to ${target} with "${password}"`);
          if (linked.length < linkLimit) await ns.dnet.setStasisLink(true);
          break;
        }
      }
    }

    await ns.sleep(5000);
  }
}

/**
 * Pull the server's logs with heartbleed and extract plausible password
 * candidates from them, plus the passwordHint/data fields.
 */
async function harvestCandidates(ns: NS, target: string, dryRun: boolean): Promise<string[]> {
  const seen = new Set<string>();
  if (dryRun) return [];

  try {
    const bleed = await ns.dnet.heartbleed(target, { peek: true, logsToCapture: 5 });
    for (const line of bleed.logs ?? []) {
      for (const token of String(line).split(/[^A-Za-z0-9]+/)) {
        if (token.length >= 4 && token.length <= 16) seen.add(token);
      }
    }
  } catch {
    /* heartbleed fails on servers whose charisma requirement we do not meet */
  }

  const details = ns.dnet.getServerDetails(target);
  if (details.data) seen.add(details.data);

  return [...seen];
}