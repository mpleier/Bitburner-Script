/**
 * globals.d.ts
 * ============================================================================
 * Bitburner's script editor injects its own NetscriptDefinitions.d.ts as a
 * *global* declaration file (it strips every `export` keyword before handing
 * it to Monaco), so in-game you never have to import anything:
 *
 *   export async function main(ns: NS) { ... }
 *
 * This file reproduces that behaviour for local `tsc --noEmit` checks so the
 * suite can be type-checked without any `import ... from "../defs.d"` line,
 * which is what makes the game's module resolver complain
 * ("Module not found: ../defs.d") on some versions.
 */
import type {
  NS as _NS,
  BladeburnerActionName as _BladeburnerActionName,
} from "./defs.d";

declare global {
  /** The `ns` object handed to every script's `main()`. */
  type NS = _NS;
  /** Names of Bladeburner actions, as accepted by `ns.bladeburner`. */
  type BladeburnerActionName = _BladeburnerActionName;
}

export {};
