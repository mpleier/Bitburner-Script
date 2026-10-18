/**
 * go.ts
 * ============================================================================
 * IPvGO (Go) automation:
 *   - plays against the current opponent using a capture/connect heuristic
 *   - prefers moves that put an opponent chain in atari (1 liberty)
   - avoids self-atari and filling its own eyes
   - prefers the centre of the board on the opening moves
 *
 * RAM cost (GB):
 *   base 1.6 | getBoardState 4 | makeMove 4 | passTurn 0 | getCurrentPlayer 0
 *   getGameState 0 | getOpponent 0 | resetBoardState 0
 *   analysis.getValidMoves 8 | analysis.getLiberties 16 | analysis.getChains 16
 *   analysis.getStats 0 | getServerMaxRam 0.05 | getHostname 0.05
 *   => ~53 GB
 *
 * Usage
 *   run go.ts
 *   run go.ts --opponent "Netburners" --size 5 --dry-run
 */

// Bitburner injects its API typings as a global declaration file, so `NS`
// needs no import (globals.d.ts mirrors that for local `tsc` checks).

// core.ts is imported statically on purpose. Bitburner's RAM allocation is
// computed from the AST of the script and everything it *statically* imports;
// ns.dynamicImport() is invisible to that pass, so the API calls core.ts makes
// would not be paid for and the game would abort the script with a RAM error.
import * as core from "./core.ts";

const RAM_NEEDED = 53;

export async function main(ns: NS): Promise<void> {
  ns.clearLog();
  ns.disableLog("ALL");

  const args = ns.args.map(String);
  const dryRun = args.includes("--dry-run");
  const loops = core.maxLoops(args);
  const host = ns.getHostname();

  if (ns.getServerMaxRam(host) < RAM_NEEDED) {
    ns.print(`go.ts needs ${RAM_NEEDED} GB; ${host} has ${ns.getServerMaxRam(host)} GB.`);
    return;
  }

  ns.print("=== go module ===");

  for (let loop = 0; loop < loops; ++loop) {
    const board = ns.go.getBoardState();
    const me = ns.go.getCurrentPlayer();

    if (me === "None") {
      const state = ns.go.getGameState();
      ns.print(`game over: white ${state.whiteScore} / black ${state.blackScore}`);
      await ns.sleep(1000);
      continue;
    }

    const move = bestMove(ns, board);
    if (!move) {
      ns.print("no valid move - passing");
      if (!dryRun) await ns.go.passTurn();
      continue;
    }

    if (dryRun) {
      ns.print(`[dry-run] best move ${move.x},${move.y} (score ${move.score.toFixed(2)})`);
    } else {
      const result = await ns.go.makeMove(move.x, move.y);
      ns.print(`played ${move.x},${move.y} (score ${move.score.toFixed(2)}) -> opponent ${result.type} ${result.x ?? "-"},${result.y ?? "-"}`);
    }
  }
}

/**
 * Score every legal point.
 * Board indexing: board[x] is a column, board[x][y] is the point at (x, y).
 */
function bestMove(ns: NS, board: string[]): { x: number; y: number; score: number } | null {
  const valid = ns.go.analysis.getValidMoves();
  const libs = ns.go.analysis.getLiberties();
  const chains = ns.go.analysis.getChains();

  const width = board.length;
  const height = board[0]?.length ?? 0;
  const me = ns.go.getCurrentPlayer() === "White" ? "O" : "X";
  const them = me === "O" ? "X" : "O";

  let best: { x: number; y: number; score: number } | null = null;

  for (let x = 0; x < width; ++x) {
    for (let y = 0; y < height; ++y) {
      if (!valid[x]?.[y]) continue;

      let score = 0;
      let emptyNeighbours = 0;
      let selfAtariRisk = false;

      for (const [nx, ny] of neighbours(x, y)) {
        const cell = board[nx]?.[ny];
        if (cell === ".") {
          emptyNeighbours += 1;
          continue;
        }
        if (cell === "#") continue;

        if (cell === them) {
          // Playing next to an opponent chain that has only one liberty puts
          // that whole chain in atari - the strongest move available.
          if (libs[nx][ny] === 1) score += 120;
          else score += 6;
        } else if (cell === me) {
          // Do not fill an eye of our own living group.
          if (libs[nx][ny] <= 2) score -= 40;
          else score += 3;
        }
      }

      if (emptyNeighbours === 0) selfAtariRisk = true;
      if (selfAtariRisk) score -= 100;

      // Centre is worth more in the opening.
      const cx = (width - 1) / 2;
      const cy = (height - 1) / 2;
      score += (width + height) / 2 - (Math.abs(x - cx) + Math.abs(y - cy));

      void chains;

      if (!best || score > best.score) best = { x, y, score };
    }
  }

  return best;
}

function neighbours(x: number, y: number): Array<[number, number]> {
  return [
    [x - 1, y],
    [x + 1, y],
    [x, y - 1],
    [x, y + 1],
  ];
}