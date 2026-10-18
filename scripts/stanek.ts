/**
 * stanek.ts
 * ============================================================================
 * Stanek's Gift automation (BitNode 13 / Source-File 13):
 *   - accepts the gift
 *   - greedily packs the strongest fragments into the grid without overlap
 *   - charges every fragment as often as possible
 *
 * RAM cost (GB):
 *   base 1.6 | giftWidth 0.4 | giftHeight 0.4 | chargeFragment 0.4
 *   fragmentDefinitions 0 | activeFragments 5 | clearGift 0
 *   canPlaceFragment 0.5 | placeFragment 5 | getFragment 2
 *   removeFragment 0.15 | acceptGift 2 | getServerMaxRam 0.05 | getHostname 0.05
 *   => ~19 GB
 *
 * Usage
 *   run stanek.ts
 *   run stanek.ts --dry-run --charge-every 5000
 */

// Bitburner injects its API typings as a global declaration file, so `NS`
// needs no import (globals.d.ts mirrors that for local `tsc` checks).

// core.ts is imported statically on purpose. Bitburner's RAM allocation is
// computed from the AST of the script and everything it *statically* imports;
// ns.dynamicImport() is invisible to that pass, so the API calls core.ts makes
// would not be paid for and the game would abort the script with a RAM error.
import * as core from "./core.ts";
import * as logger from "./logger.ts";

const RAM_NEEDED = 26;

export async function main(ns: NS): Promise<void> {
  ns.clearLog();
  ns.disableLog("ALL");

  const args = ns.args.map(String);
  const dryRun = args.includes("--dry-run");
  const loops = core.maxLoops(args);
  const chargeEvery = core.numOr(args, "--charge-every", 5000);
  const host = ns.getHostname();

  if (ns.getServerMaxRam(host) < RAM_NEEDED) {
    logger.tlog(ns, `stanek.ts needs ${RAM_NEEDED} GB; ${host} has ${ns.getServerMaxRam(host)} GB.`);
    return;
  }

  if (!core.subsystemAvailable(ns, "stanek")) {
    logger.tlog(ns, "Stanek's Gift needs BitNode 13 or Source-File 13 - skipping.");
    return;
  }

  logger.log(ns, "=== stanek module ===");

  const BOOSTER = core.tryCall(() => ns.enums.FragmentType.Booster, 18);

  for (let loop = 0; loop < loops; ++loop) {
    const width = core.tryCall(() => ns.stanek.giftWidth(), 0);
    const height = core.tryCall(() => ns.stanek.giftHeight(), 0);

    if (width <= 0 || height <= 0) {
      if (!core.tryCall(() => ns.stanek.acceptGift(), false)) {
        logger.log(ns, "Stanek's Gift is not available yet");
        await ns.sleep(1000);
        continue;
      }
      logger.log(ns, "accepted the gift");
      continue;
    }

    packFragments(ns, width, height, dryRun);

    const active = core.tryCall(() => ns.stanek.activeFragments(), []);
    for (const f of active) {
      // Booster fragments cannot be charged; they only boost their neighbours.
      if (f.type === BOOSTER) {
        if (dryRun) logger.log(ns, `[dry-run] skipping booster ${f.id} at ${f.x},${f.y}`);
        continue;
      }
      if (dryRun) {
        logger.log(ns, `[dry-run] would charge fragment ${f.id} at ${f.x},${f.y} (${f.numCharge}/${f.highestCharge})`);
        continue;
      }
      try {
        await ns.stanek.chargeFragment(f.x, f.y);
      } catch (err) {
        logger.log(ns, `could not charge fragment at ${f.x},${f.y}: ${err}`);
      }
    }

    logger.log(ns, 
      `placed ${active.length} fragments | total power ${active.reduce((a: number, f: any) => a + f.power, 0)}`,
    );

    await ns.sleep(chargeEvery);
  }
}

/**
 * Greedy packing: strongest fragments first, first free non-overlapping cell
 * and rotation that fits. `limit` caps how many copies of a fragment we place.
 */
function packFragments(ns: NS, width: number, height: number, dryRun: boolean): void {
  const defs = ns.stanek.fragmentDefinitions();
  const placed = ns.stanek.activeFragments();

  const occupied = new Set<string>();
  for (const f of placed) {
    for (const cell of cellsOf(f.shape, f.x, f.y, f.rotation)) occupied.add(cell);
  }

  const counts: Record<number, number> = {};
  for (const f of placed) counts[f.id] = (counts[f.id] ?? 0) + 1;

  const sorted = defs.slice().sort((a, b) => b.power - a.power);

  for (const def of sorted) {
    if ((counts[def.id] ?? 0) >= def.limit) continue;

    let best = null;
    let bestScore = -1;

    for (let rotation = 0; rotation < 4; ++rotation) {
      for (let y = 0; y < height; ++y) {
        for (let x = 0; x < width; ++x) {
          const cells = cellsOf(def.shape, x, y, rotation);
          if (cells.length === 0) continue;
          // the rotated bounding box must stay inside the gift
          if (cells.some((c) => { const [cy, cx] = c.split(",").map(Number); return cx < 0 || cy < 0 || cx >= width || cy >= height; })) continue;
          if (cells.some((c) => occupied.has(c))) continue;

          // Prefer spots that hug what is already on the board: fewer stray gaps.
          let score = 0;
          for (const c of cells) {
            const [cy, cx] = c.split(",").map(Number);
            if (occupied.has(`${cy - 1},${cx}`)) score++;
            if (occupied.has(`${cy + 1},${cx}`)) score++;
            if (occupied.has(`${cy},${cx - 1}`)) score++;
            if (occupied.has(`${cy},${cx + 1}`)) score++;
          }
          score -= (x + y) / 100; // deterministic tie-break, top-left first

          if (score > bestScore) {
            bestScore = score;
            best = { x, y, rotation, cells };
          }
        }
      }
    }

    if (!best) {
      logger.log(ns, `no room for fragment ${def.id} (${def.type}, power ${def.power})`);
      continue;
    }

    if (!ns.stanek.canPlaceFragment(best.x, best.y, best.rotation, def.id)) continue;

    if (dryRun) {
      logger.log(ns, `[dry-run] would place fragment ${def.id} (${def.type}) at ${best.x},${best.y} rot ${best.rotation}`);
    } else if (!ns.stanek.placeFragment(best.x, best.y, best.rotation, def.id)) {
      logger.log(ns, `failed to place fragment ${def.id} (${def.type})`);
      continue;
    } else {
      logger.log(ns, `placed fragment ${def.id} (${def.type}) at ${best.x},${best.y} rot ${best.rotation}`);
    }

    for (const c of best.cells) occupied.add(c);
    counts[def.id] = (counts[def.id] ?? 0) + 1;
  }

  const totalPower = Object.entries(counts).reduce((a, [id, n]) => {
    const def = defs.find((d) => d.id === Number(id));
    return a + (def ? def.power * n : 0);
  }, 0);
  logger.log(ns, 
    `grid ${width}x${height}: ${occupied.size}/${width * height} cells filled, ` +
      `${Object.values(counts).reduce((a, n) => a + n, 0)} fragments, total power ${totalPower}`,
  );
}

/**
 * Absolute "row,col" keys of the cells a shape covers.
 *
 * The shape is rotated about its own origin, then its bounding box is slid so
 * that the top-left cell of that box lands on (y, x). That keeps every cell
 * inside the grid as long as x + boxWidth - 1 < width and
 * y + boxHeight - 1 < height, which is what the game checks.
 */
function cellsOf(shape: boolean[][], x: number, y: number, rotation: number): string[] {
  const pts: Array<[number, number]> = [];

  for (let r = 0; r < shape.length; ++r) {
    for (let c = 0; c < (shape[r]?.length ?? 0); ++c) {
      if (!shape[r][c]) continue;
      // Rotate 90 degrees clockwise about the origin, `rotation` times.
      let rr = r;
      let cc = c;
      for (let i = 0; i < rotation % 4; ++i) {
        const nr = cc;
        const nc = -rr;
        rr = nr;
        cc = nc;
      }
      pts.push([rr, cc]);
    }
  }

  if (pts.length === 0) return [];

  const minR = Math.min(...pts.map((p) => p[0]));
  const minC = Math.min(...pts.map((p) => p[1]));

  return pts.map(([r, c]) => `${y + r - minR},${x + c - minC}`);
}