/**
 * gang.ts
 * ============================================================================
 * Gang automation (BitNode 2 / Source-File 2):
 *   - creates the gang, preferring a hacking gang when hacking is our best stat
 *   - recruits every member respect allows
 *   - assigns each member the task with the best money/respect per cycle
 *   - buys the equipment that gives the most stat per dollar for that task
 *   - ascends members once they have banked enough ascension points
 *   - turns territory warfare on only when we are likely to win the clash
 *
 * RAM cost (GB), from the official RamCostGenerator (GangApiBase = 4):
 *   base 1.6 | createGang 1 | getMemberNames 1 | getGangInformation 2
 *   getAllGangInformation 2 | getMemberInformation 2 | canRecruitMember 1
 *   getRecruitsAvailable 1 | respectForNextRecruit 1 | recruitMember 2
 *   getTaskNames 0 | getTaskStats 1 | setMemberTask 2 | getEquipmentNames 0
 *   getEquipmentCost 2 | getEquipmentType 2 | getEquipmentStats 2
 *   purchaseEquipment 4 | ascendMember 4 | getAscensionResult 2
 *   setTerritoryWarfare 2 | getChanceToWinClash 4 | getBonusTime 0 | nextUpdate 0
 *   + getPlayer 0.5 | getServerMaxRam 0.05 | getHostname 0.05
 *   => ~28 GB
 *
 * Usage
 *   run gang.ts
 *   run gang.ts --dry-run --ascend-at 2000 --interval 3000
 */

import type { NS } from "../defs.d";

const RAM_NEEDED = 28;

/** Gangs you can create, split by what they reward. */
const HACKING_GANGS = ["BitRunners", "The Black Hand", "NiteSec"] as const;
const COMBAT_GANGS = [
  "Slum Snakes",
  "Speakers for the Dead",
  "The Dark Army",
  "The Syndicate",
  "Silhouette",
  "Tetrads",
] as const;

/** The gang caps at 12 members. */
const MAX_MEMBERS = 12;

export async function main(ns: NS): Promise<void> {
  ns.clearLog();
  ns.disableLog("ALL");

  const args = ns.args.map(String);
  const core = await ns.dynamicImport("./core.ts");
  const dryRun = args.includes("--dry-run");
  const loops = core.maxLoops(args);
  const interval = core.numOr(args, "--interval", 2000);
  const ascendAt = core.numOr(args, "--ascend-at", 1000);
  const host = ns.getHostname();

  if (ns.getServerMaxRam(host) < RAM_NEEDED) {
    ns.tprint(`gang.ts needs ${RAM_NEEDED} GB; ${host} has ${ns.getServerMaxRam(host)} GB.`);
    return;
  }

  if (!core.subsystemAvailable(ns, "gang")) {
    ns.tprint("Gangs are not available here - need BitNode 2 or Source-File 2.");
    return;
  }

  // Outside BitNode 2 gangs only recruit you once karma is low enough (<= -54000).
  if (core.bitnode(ns) !== 2 && core.karma(ns) > -54000) {
    ns.tprint(
      `Gangs need karma <= -54000 outside BitNode 2 (current karma ${core.karma(ns)}).`,
    );
    return;
  }

  ns.print("=== gang module ===");

  for (let loop = 0; loop < loops; ++loop) {
    if (!ns.gang.inGang()) {
      createGang(ns, core, dryRun);
      await ns.sleep(interval);
      continue;
    }

    const gang = ns.gang.getGangInformation();
    recruit(ns, gang, dryRun);
    assignTasks(ns, gang, dryRun);
    buyEquipment(ns, gang, dryRun);
    ascend(ns, ascendAt, dryRun);
    territoryWarfare(ns, gang, dryRun);

    const members = ns.gang.getMemberNames().length;
    ns.print(
      `members ${members} | respect ${gang.respect.toFixed(1)} | ` +
        `territory ${(gang.territory * 100).toFixed(1)}% | ` +
        `income ${core.fmt(gang.moneyGainRate)}/cycle | wanted ${gang.wantedLevel.toFixed(1)}`,
    );

    // nextUpdate() burns the bonus time the gang has accumulated.
    await ns.gang.nextUpdate();
  }
}

/** Create the gang with the faction that fits our build best. */
function createGang(ns: NS, core: any, dryRun: boolean): void {
  const s = core.stats(ns);
  const combat = (s.strength + s.defense + s.dexterity + s.agility) / 4;
  const order = s.hacking >= combat
    ? [...HACKING_GANGS, ...COMBAT_GANGS]
    : [...COMBAT_GANGS, ...HACKING_GANGS];

  for (const faction of order) {
    if (dryRun) {
      ns.print(`[dry-run] would try to create a ${faction} gang`);
      continue;
    }
    if (ns.gang.createGang(faction)) {
      ns.print(`gang created with ${faction}`);
      return;
    }
  }
  ns.print("could not create a gang - join one of the gang factions first");
}

/** Recruit as many members as respect allows. */
function recruit(ns: NS, gang: any, dryRun: boolean): void {
  const members = ns.gang.getMemberNames().length;
  if (members >= MAX_MEMBERS) return;
  if (!ns.gang.canRecruitMember()) return;

  const available = ns.gang.getRecruitsAvailable();
  const needed = ns.gang.respectForNextRecruit();
  if (available <= 0) return;

  for (let i = 0; i < available; ++i) {
    const name = `Member ${members + i + 1}`;
    if (dryRun) {
      ns.print(`[dry-run] would recruit ${name} (respect ${needed.toFixed(1)} needed)`);
      continue;
    }
    if (ns.gang.recruitMember(name)) ns.print(`recruited ${name}`);
    else break;
  }
}

/**
 * Pick the best task per member.
 * With Formulas.exe we use the real game formulas; otherwise we fall back to a
 * weighted-stat heuristic that still gets close.
 */
function assignTasks(ns: NS, gang: any, dryRun: boolean): void {
  const hasFormulas = ns.ls("home", "Formulas.exe").length > 0;
  const tasks = ns.gang.getTaskNames();
  const stats: Record<string, any> = {};
  for (const t of tasks) stats[t] = ns.gang.getTaskStats(t);

  for (const name of ns.gang.getMemberNames()) {
    const member = ns.gang.getMemberInformation(name);
    let best = member.task;
    let bestScore = -Infinity;

    for (const task of tasks) {
      const score = hasFormulas
        ? ns.formulas.gang.moneyGain(gang, member, stats[task]) +
          ns.formulas.gang.respectGain(gang, member, stats[task]) * 1000 -
          Math.max(0, ns.formulas.gang.wantedLevelGain(gang, member, stats[task])) * 4000
        : heuristicScore(member, stats[task]);

      if (score > bestScore) {
        bestScore = score;
        best = task;
      }
    }

    if (best === member.task) continue;

    if (dryRun) {
      ns.print(`[dry-run] ${name}: ${member.task} -> ${best}`);
      continue;
    }
    if (ns.gang.setMemberTask(name, best)) ns.print(`${name} assigned to ${best}`);
  }
}

/** Weighted stat contribution, normalised by task difficulty. */
function heuristicScore(member: any, task: any): number {
  const eff = (stat: number, mult: number, asc: number) => stat * mult * asc;
  const weighted =
    eff(member.hack, member.hack_mult, member.hack_asc_mult) * task.hackWeight +
    eff(member.str, member.str_mult, member.str_asc_mult) * task.strWeight +
    eff(member.def, member.def_mult, member.def_asc_mult) * task.defWeight +
    eff(member.dex, member.dex_mult, member.dex_asc_mult) * task.dexWeight +
    eff(member.agi, member.agi_mult, member.agi_asc_mult) * task.agiWeight +
    eff(member.cha, member.cha_mult, member.cha_asc_mult) * task.chaWeight;

  return (task.baseMoney + task.baseRespect * 500) * weighted / (task.difficulty + 1);
}

/**
 * Buy the equipment with the best "relevant stat per dollar" for each member.
 * Only spend a slice of the bankroll on any single purchase.
 */
function buyEquipment(ns: NS, gang: any, dryRun: boolean): void {
  void gang;
  const cash = ns.getPlayer().money;
  const names = ns.gang.getEquipmentNames();

  const cache: Record<string, { cost: number; stats: any }> = {};
  for (const name of names) {
    cache[name] = { cost: ns.gang.getEquipmentCost(name), stats: ns.gang.getEquipmentStats(name) };
  }

  for (const memberName of ns.gang.getMemberNames()) {
    const member = ns.gang.getMemberInformation(memberName);
    const owned = new Set(member.upgrades.concat(member.augmentations));
    const task = ns.gang.getTaskStats(member.task);

    let best: string | null = null;
    let bestValue = 0;

    for (const name of names) {
      if (owned.has(name)) continue;
      const cost = cache[name].cost;
      if (cost <= 0 || cost > cash / 5) continue;

      const st = cache[name].stats;
      const value =
        (st.hack ?? 0) * task.hackWeight +
        (st.str ?? 0) * task.strWeight +
        (st.def ?? 0) * task.defWeight +
        (st.dex ?? 0) * task.dexWeight +
        (st.agi ?? 0) * task.agiWeight +
        (st.cha ?? 0) * task.chaWeight;

      const perDollar = value / cost;
      if (perDollar > bestValue) {
        bestValue = perDollar;
        best = name;
      }
    }

    if (!best) continue;

    if (dryRun) {
      ns.print(`[dry-run] would buy ${best} for ${memberName} (${money0(cache[best].cost)})`);
      continue;
    }
    if (ns.gang.purchaseEquipment(memberName, best)) {
      ns.print(`${memberName} bought ${best} for ${money0(cache[best].cost)}`);
    }
  }
}

/** Ascend when the banked ascension points are worth the respect loss. */
function ascend(ns: NS, ascendAt: number, dryRun: boolean): void {
  for (const name of ns.gang.getMemberNames()) {
    const m = ns.gang.getMemberInformation(name);
    const points =
      m.hack_asc_points + m.str_asc_points + m.def_asc_points +
      m.dex_asc_points + m.agi_asc_points + m.cha_asc_points;

    if (points < ascendAt) continue;

    if (dryRun) {
      ns.print(`[dry-run] would ascend ${name} (${points.toFixed(0)} ascension points)`);
      continue;
    }
    const result = ns.gang.ascendMember(name);
    if (result) {
      ns.print(
        `ascended ${name}: hack x${result.hack.toFixed(2)} str x${result.str.toFixed(2)} ` +
          `(-${result.respect.toFixed(1)} respect)`,
      );
    }
  }
}

/** Only fight for territory when we expect to win every clash. */
function territoryWarfare(ns: NS, gang: any, dryRun: boolean): void {
  const others = ns.gang.getAllGangInformation();
  let wins = 0;
  let total = 0;

  for (const other of Object.keys(others)) {
    if (other === gang.faction) continue;
    total += 1;
    if (ns.gang.getChanceToWinClash(other) > 0.55) wins += 1;
  }

  const engage = total > 0 && wins === total && gang.territory < 0.99;
  if (gang.territoryWarfareEngaged === engage) return;

  if (dryRun) {
    ns.print(`[dry-run] would set territory warfare to ${engage}`);
    return;
  }
  ns.gang.setTerritoryWarfare(engage);
  ns.print(`territory warfare ${engage ? "ON" : "OFF"}`);
}

function money0(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return n.toFixed(0);
}