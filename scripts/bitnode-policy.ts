/**
 * bitnode-policy.ts
 * ============================================================================
 * Pure bitnode selection rules. No ns.* call appears in this file, so it costs
 * 0 GB and can be exercised offline:
 *   node mocksuite.mjs bitnode-policy
 *
 * Names and themes come from bitnodes_doc.md in this repository (BitNodes 1-15
 * are documented there; 16-25 are the challenge nodes that only exist to hand
 * out their source file).
 *
 * A bitnode is chosen for one reason: the source file it hands out. The suite
 * keeps a list of the source files already owned and picks the node that fills
 * the most important gap.
 */

/** What a bitnode is good for. */
export interface BitnodeProfile {
  id: number;
  name: string;
  /** short reason a player would pick this node */
  theme: string;
  /** subsystems the node makes available or much stronger */
  unlocks: string[];
  /** 1 = easy, 5 = brutal */
  difficulty: number;
}

export const BITNODES: BitnodeProfile[] = [
  { id: 1, name: "Source Genesis", theme: "baseline, everything works", unlocks: ["hacking", "hacknet", "crime", "jobs", "factions", "stock"], difficulty: 1 },
  { id: 2, name: "Rise of the Underworld", theme: "gangs, and karma is reset", unlocks: ["gang", "crime"], difficulty: 2 },
  { id: 3, name: "Corporatocracy", theme: "corporations from the start", unlocks: ["corporation"], difficulty: 2 },
  { id: 4, name: "The Singularity", theme: "Singularity API, cheaper to use", unlocks: ["singularity", "ascend"], difficulty: 3 },
  { id: 5, name: "Artificial Intelligence", theme: "AI-related servers and a stronger hacknet", unlocks: ["hacknet", "hacking"], difficulty: 3 },
  { id: 6, name: "Bladeburners", theme: "Bladeburner division", unlocks: ["bladeburner"], difficulty: 4 },
  { id: 7, name: "Bladeburners 2079", theme: "Bladeburner with a harder economy", unlocks: ["bladeburner"], difficulty: 4 },
  { id: 8, name: "Ghost of Wall Street", theme: "stock market is the main income", unlocks: ["stock"], difficulty: 3 },
  { id: 9, name: "Hacktocracy", theme: "servers are richer, hacking is the path", unlocks: ["hacking", "hacknet"], difficulty: 3 },
  { id: 10, name: "Digital Carbon", theme: "sleeves", unlocks: ["sleeves"], difficulty: 4 },
  { id: 11, name: "The Big Crash", theme: "money is scarce, gang is strong", unlocks: ["gang"], difficulty: 4 },
  { id: 12, name: "The Recursion", theme: "servers repeat, good for grinding", unlocks: ["hacking"], difficulty: 4 },
  { id: 13, name: "They're lunatics", theme: "Stanek's Gift", unlocks: ["stanek"], difficulty: 4 },
  { id: 14, name: "IPvGO Subnet Takeover", theme: "Go", unlocks: ["go"], difficulty: 3 },
  { id: 15, name: "The Secrets of the Dark Net", theme: "Darknet", unlocks: ["darknet"], difficulty: 3 },
  { id: 16, name: "Challenge BitNode 16", theme: "source file only", unlocks: [], difficulty: 5 },
  { id: 17, name: "Challenge BitNode 17", theme: "source file only", unlocks: [], difficulty: 5 },
  { id: 18, name: "Challenge BitNode 18", theme: "source file only", unlocks: [], difficulty: 5 },
  { id: 19, name: "Challenge BitNode 19", theme: "source file only", unlocks: [], difficulty: 5 },
  { id: 20, name: "Challenge BitNode 20", theme: "source file only", unlocks: [], difficulty: 5 },
  { id: 21, name: "Challenge BitNode 21", theme: "source file only", unlocks: [], difficulty: 5 },
  { id: 22, name: "Challenge BitNode 22", theme: "source file only", unlocks: [], difficulty: 5 },
  { id: 23, name: "Challenge BitNode 23", theme: "source file only", unlocks: [], difficulty: 5 },
  { id: 24, name: "Challenge BitNode 24", theme: "source file only", unlocks: [], difficulty: 5 },
  { id: 25, name: "Challenge BitNode 25", theme: "source file only", unlocks: [], difficulty: 5 },
];

/** Bitnode n hands out source file n. */
export function sourceFileOf(bitnode: number): number {
  return bitnode;
}

/**
 * Rank the bitnodes that are still unowned for a given goal.
 *
 * `goal` is what the player wants next: "money", "augmentations", "gang",
 * "bladeburner", "corporation", "sleeves", "stanek", "go", "darknet", "hacknet",
 * "hacking" or "any".
 *
 * Scoring:
 *   +10  the node is the canonical node for the goal
 *   +4   the node unlocks a subsystem the suite can already use
 *   -difficulty
 *   -0.1 * id, so that among equals the lower-numbered node is picked first
 */
export function rankBitnodes(owned: number[], goal = "any"): BitnodeProfile[] {
  const candidates = unownedBitnodes(owned);

  const scored = candidates.map((node) => {
    let score = 0;
    if (goal !== "any" && node.unlocks.includes(goal)) score += 10;
    if (node.unlocks.length > 0) score += 4;
    score -= node.difficulty;
    score -= node.id * 0.1;
    return { node, score };
  });

  scored.sort((a, b) => b.score - a.score || a.node.id - b.node.id);
  return scored.map((entry) => entry.node);
}

/**
 * The single bitnode to enter next. Returns null when every bitnode has been
 * destroyed, which is the point where the suite stops recommending resets.
 */
export function nextBitnode(owned: number[], goal = "any", current = 1): BitnodeProfile | null {
  const ranked = rankBitnodes(owned, goal);
  return ranked.length > 0 ? ranked[0] : null;
}

/**
 * Should the player reset now?
 *
 * Resetting is only worth it when enough augmentations are ready to install at
 * once: each reset costs a full run, so installing one augmentation per reset
 * is a bad trade. `readyCount` is the number of augmentations that are both
 * affordable and past their prerequisites, `threshold` is the minimum batch.
 */
export function shouldAscend(readyCount: number, threshold = 5): boolean {
  return readyCount >= threshold;
}

/**
 * How many augmentations must be ready before a reset pays for itself.
 * Early in a run a single augmentation is worth more than the reset costs, so
 * the threshold is lower when few source files are owned.
 */
export function ascendThreshold(owned: number[]): number {
  const count = ownedSourceFiles(owned).size;
  if (count <= 1) return 3;
  if (count <= 4) return 5;
  return 8;
}

/** One-line summary of a bitnode, for the dashboard and the log. */
export function bitnodeSummary(node: BitnodeProfile): string {
  const unlocks = node.unlocks.length > 0 ? node.unlocks.join(", ") : "nothing new";
  return `BN${node.id} ${node.name} - ${node.theme} (${unlocks}, difficulty ${node.difficulty}/5)`;
}

/** Which bitnodes have already been destroyed (source file owned). */
export function ownedSourceFiles(owned: number[]): Set<number> {
  return new Set(owned.filter((n) => Number.isFinite(n) && n > 0));
}

/** Bitnodes that have not been destroyed yet. */
export function unownedBitnodes(owned: number[]): BitnodeProfile[] {
  const have = ownedSourceFiles(owned);
  return BITNODES.filter((node) => !have.has(node.id));
}
