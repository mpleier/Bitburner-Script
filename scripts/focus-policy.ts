/**
 * focus-policy.ts
 * ============================================================================
 * Pure activity-coordination rules for the suite. No ns.* call appears in this
 * file, so importing it costs 0 GB (Bitburner reserves RAM by walking the AST
 * of a script and everything it statically imports, src/Script/RamCalculations.ts)
 * and every rule here can be exercised offline:
 *   node mocksuite.mjs focus-policy
 *
 * The game gives the player exactly one work slot: Player.currentWork is set by
 * a company job, faction work, a crime, a class, a gym session or ns.share().
 * Bladeburner.process() cancels a running Bladeburner action whenever
 * Player.currentWork is set and the player does not own BladesSimulacrum, and
 * the browser UI (the casino page, for example) is replaced by the work page
 * the moment the player starts working.
 *
 * So at most one "work slot" subsystem can run at a time, and anything that
 * drives the browser UI cannot coexist with any of them.
 */

/** Every subsystem the scheduler can schedule. */
export type Activity =
  | "hacking"
  | "hacknet"
  | "contracts"
  | "factions"
  | "jobs"
  | "crime"
  | "gang"
  | "bladeburner"
  | "corporation"
  | "stock"
  | "stanek"
  | "sleeves"
  | "go"
  | "infiltration"
  | "darknet"
  | "share"
  | "casino"
  | "ascend";

/**
 * Activities that occupy Player.currentWork. Two of these cannot run at the
 * same time, and each of them replaces the browser page another UI driver needs.
 *
 * "ascend" is deliberately NOT here. ascend.ts never calls work APIs and never
 * opens a browser page; it decides whether to call installAugmentations(), which
 * is a full reset that wipes every script anyway. A reset does not need the work
 * slot, so treating ascend as a work activity would mute it for the wrong reason
 * (the casino, for example). ascend.ts guards the one real hazard - a running
 * Bladeburner action - by itself.
 */
export const WORK_SLOT_ACTIVITIES: Activity[] = [
  "factions",
  "jobs",
  "crime",
  "bladeburner",
  "share",
];

/** Activities that drive the browser UI and therefore need the player's screen. */
export const UI_ACTIVITIES: Activity[] = ["casino"];

/**
 * Do two activities fight over the player?
 *
 * - two work-slot activities always fight (there is only one work slot);
 * - a UI activity fights any work-slot activity (the work page replaces the UI);
 * - everything else can run side by side: gang, sleeves, go, stanek, hacknet,
 *   hacking, stock, corporation, darknet and infiltration all work through the
 *   API without touching Player.currentWork.
 */
export function conflictsWith(a: Activity, b: Activity): boolean {
  if (a === b) return false;
  const aWork = WORK_SLOT_ACTIVITIES.includes(a);
  const bWork = WORK_SLOT_ACTIVITIES.includes(b);
  const aUi = UI_ACTIVITIES.includes(a);
  const bUi = UI_ACTIVITIES.includes(b);
  return (aWork && bWork) || (aUi && bWork) || (bUi && aWork);
}

/** Every activity that would be pushed out by `activity`. */
export function blockedBy(activity: Activity): Activity[] {
  return ALL_ACTIVITIES.filter((other) => conflictsWith(activity, other));
}

export const ALL_ACTIVITIES: Activity[] = [
  "hacking",
  "hacknet",
  "contracts",
  "factions",
  "jobs",
  "crime",
  "gang",
  "bladeburner",
  "corporation",
  "stock",
  "stanek",
  "sleeves",
  "go",
  "infiltration",
  "darknet",
  "share",
  "casino",
  "ascend",
];

/**
 * Activities that need the browser window get first refusal on it: a UI driver
 * is useless while the player is working, but a work module loses nothing when
 * the casino sits idle. So the UI activities are considered first and the rest
 * keeps the order the scheduler handed us.
 */
export function prioritizeActivities(candidates: Activity[]): Activity[] {
  const ui = candidates.filter((activity) => UI_ACTIVITIES.includes(activity));
  const rest = candidates.filter((activity) => !UI_ACTIVITIES.includes(activity));
  return [...ui, ...rest];
}

/**
 * Resolve which activities may run at the same time.
 *
 * `candidates` arrives in scheduler priority order, but prioritizeActivities()
 * considers the browser-UI drivers first: the player can only work for one
 * faction, hold one job or commit one crime at a time, so whoever claims the
 * work slot wins and every later activity that would collide with it is dropped.
 * Activities that do not touch the player's time are never dropped.
 */
export function allowedActivities(candidates: Activity[]): Set<Activity> {
  const allowed = new Set<Activity>();

  for (const activity of prioritizeActivities(candidates)) {
    let blocked = false;
    for (const held of allowed) {
      if (conflictsWith(activity, held)) {
        blocked = true;
        break;
      }
    }
    if (!blocked) allowed.add(activity);
  }

  return allowed;
}

/**
 * Which activities in the suite actually need the player's focus. Used by
 * autobot.ts to build the focus file it hands to every module.
 */
export function focusNeeds(activity: Activity): boolean {
  return WORK_SLOT_ACTIVITIES.includes(activity) || UI_ACTIVITIES.includes(activity);
}

/**
 * Human-readable reason a module was muted, for the dashboard and the log.
 */
export function focusReason(activity: Activity, held: Activity[]): string {
  const culprit = held.find((other) => conflictsWith(activity, other));
  if (!culprit) return "";
  if (UI_ACTIVITIES.includes(culprit)) {
    return `focus conflict: ${culprit} drives the browser UI`;
  }
  return `focus conflict: ${culprit} already holds the player's work slot`;
}
