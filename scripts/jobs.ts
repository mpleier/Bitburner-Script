/**
 * jobs.ts
 * ============================================================================
 * Job automation: apply for every job we qualify for, keep the highest paying
 * one, upgrade it, and run a share script on every server with spare RAM so
 * we keep earning while we are working.
 *
 * RAM cost (GB): base 1.6 + listJobs 0.5 + applyJob 2 + getJobInformation 2
 *   + isBusy 0.5 + getPlayer 0.5 + 5x getJob* 0.05 + upgradeJob 1
 *   + getJobUpgradeCost 1 + startProgram 1.6 + exec 1 + scan 0.2
 *   + getServerMaxRam 0.05 + getServerUsedRam 0.05 + hasRootAccess 0.05
 *   + scp 0.05 + getStat 0.05
 *   => ~14 GB
 *
 * Usage
 *   run jobs.ts
 *   run jobs.ts --no-share --dry-run
 */

import type { NS } from "../defs.d";

export async function main(ns: NS): Promise<void> {
  ns.clearLog();
  ns.disableLog("ALL");

  const args = ns.args.map(String);
  const dryRun = args.includes("--dry-run");
  const share = !args.includes("--no-share");
  const interval = Number(flagOr(args, "--interval", 2000));

  ns.print("=== jobs module ===");

  while (true) {
    const jobs = ns.singularity.listJobs();
    const cash = ns.getPlayer().money;

    // Apply for anything we are not already employed at.
    for (const job of jobs) {
      if (jobs.some((j) => j === job)) {
        // listJobs returns current employment; skip if already employed there
      }
      const info = ns.singularity.getJobInformation(job);
      if (info.requiredStat > ns.getStat(info.stat)) {
        ns.print(`not qualified for ${job} (needs ${info.requiredStat} ${info.stat})`);
        continue;
      }
      if (cash < info.startingSalary) continue;

      if (dryRun) {
        ns.print(`[dry-run] would apply for ${job} (${fmt(info.startingSalary)}/cycle)`);
        continue;
      }
      if (ns.singularity.applyJob(job)) ns.print(`applied for ${job}`);
    }

    // Upgrade the current job when it is cheap.
    for (const job of jobs) {
      const cost = ns.singularity.getJobUpgradeCost(job);
      if (cost > 0 && cost < cash / 10) {
        if (!dryRun) ns.singularity.upgradeJob(job);
      }
    }

    // Keep a share script running everywhere with spare RAM.
    if (share) shareEverywhere(ns, dryRun);

    await ns.sleep(interval);
  }
}

/** scp share.ts to every rooted server with RAM and run it there. */
function shareEverywhere(ns: NS, dryRun: boolean): void {
  ns.scp(["share.ts"], "home");

  for (const host of ns.scan("home")) {
    if (!ns.hasRootAccess(host)) continue;
    const free = ns.getServerMaxRam(host) - ns.getServerUsedRam(host);
    if (free < 4) continue;

    const threads = Math.floor(free / 1);
    if (dryRun) {
      ns.print(`[dry-run] would run share.ts on ${host} with ${threads} threads`);
      continue;
    }
    if (ns.isRunning("share.ts", host)) continue;
    ns.exec("share.ts", host, threads);
  }
}

function flagOr(args: string[], name: string, fallback: number): number {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? Number(args[i + 1]) : fallback;
}

function fmt(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return n.toFixed(2);
}
