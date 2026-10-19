/**
 * casino-policy.ts
 * ============================================================================
 * Pure decision logic for casino.ts.
 *
 * Why a separate file: Bitburner reserves RAM statically by walking the AST of
 * a script and everything it *statically* imports
 * (src/Script/RamCalculations.ts). This file contains no ns.* call at all, so
 * importing it costs 0 GB, and every rule in it can be exercised offline:
 *   node mocksuite.mjs casino-policy
 *
 * The constants are the game's own numbers:
 *   - Player.travel() charges CONSTANTS.TravelCost to change city (200,000).
 *   - The blackjack wager box caps a single bet at 100,000,000.
 *   - The house bans us once total casino winnings pass 10 billion, which is
 *     the real end condition of a save-scum run.
 */

/** Fee the game charges to travel between cities (CONSTANTS.TravelCost). */
export const TRAVEL_COST = 200_000;

/** Hard cap on one blackjack bet. */
export const CASINO_MAX_BET = 100_000_000;

/** Bankroll we want before a casino run is worth starting. */
export const CASINO_SEED_MONEY = 300_000;

/** Total casino winnings after which Iker Molina kicks us out for good. */
export const CASINO_BAN_THRESHOLD = 1e10;

/** Fraction of the bankroll we are willing to put on one hand. */
export const WAGER_FRACTION = 0.9;

/** How many hands we let net winnings slide before reloading the game. */
export const DEFAULT_RELOAD_AFTER_LOSSES = 10;

export type BlackjackOutcome = "win" | "lose" | "tie";
export type Strategy = "simple" | "basic";

/** Every element the driver needs, in one place so the tests can use them too. */
export const XPATH = {
  saveGame: "//button[@aria-label = 'save game']",
  travelButton: "//div[@role='button' and ./div/p/text()='Travel']",
  aevumLink: "//span[contains(@class,'travel') and ./text()='A']",
  travelConfirm: "//button[p/text()='Travel']",
  cityMenu: "//div[(@role = 'button') and (contains(., 'City'))]",
  casinoLink: "//span[@aria-label = 'Iker Molina Casino']",
  casinoTitle: "//h4[text()='Iker Molina Casino']",
  blackjack: "//button[contains(text(), 'blackjack')]",
  wagerInput: "//input[@type='number']",
  startGame: "//button[text() = 'Start']",
  hit: "//button[text() = 'Hit']",
  stay: "//button[text() = 'Stay']",
  count: "//p[contains(text(), 'Count:')]",
  dealerCard: "//p[normalize-space(.)='Dealer']/following-sibling::*[1]//span[1]",
  lost: "//p[contains(text(), 'lost')]",
  won: "//p/text()[contains(.,'won') or contains(.,'Won')]",
  tie: "//p[contains(text(), 'Tie')]",
  blackjackWin: "//p[contains(text(), 'Blackjack!')]",
  kickedOut: "//span[contains(text(), 'Alright cheater get out of here')]",
  closeModal: "//button[contains(@class,'closeButton')]",
  unfocus: "//button[text()='Do something else simultaneously']",
  terminal: "//div[(@role = 'button') and (contains(., 'Terminal'))]",
};

/* -------------------------------------------------------------------------- */
/*  Option validation                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Returns a human-readable problem with the sleep timings, or null when they
 * are all sane. A negative sleep would make ns.sleep() throw deep inside the
 * driver, so it is caught here instead.
 */
export function casinoOptionsError(options: {
  saveSleepMs: number;
  clickSleepMs: number;
  findSleepMs: number;
  maxRounds: number;
  reloadAfterLosses: number;
}): string | null {
  for (const name of ["saveSleepMs", "clickSleepMs", "findSleepMs"]) {
    const value = options[name as "saveSleepMs"];
    if (!Number.isFinite(value) || value < 0) return `${name} must be a finite nonnegative number.`;
  }
  if (!Number.isFinite(options.maxRounds) || options.maxRounds < 1) return "maxRounds must be at least 1.";
  if (!Number.isFinite(options.reloadAfterLosses) || options.reloadAfterLosses < 1) {
    return "reloadAfterLosses must be at least 1.";
  }
  return null;
}


/* -------------------------------------------------------------------------- */
/*  Betting                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * How much to put on the next hand. We bet most of the bankroll because a loss
 * is undone by reloading the game, so the only real risk is running out of
 * money before we can reload.
 */
export function casinoWager(wallet: number): number {
  if (!Number.isFinite(wallet) || wallet < 1) return 0;
  return Math.min(CASINO_MAX_BET, Math.max(1, Math.floor(wallet * WAGER_FRACTION)));
}

/**
 * Money gained/lost by one hand.
 *
 * The game's own money source is authoritative when it is available; otherwise
 * we fall back to the payout the rules imply (blackjack pays 1.5x).
 */
export function casinoRoundDelta(
  outcome: BlackjackOutcome,
  bet: number,
  before: number,
  after: number,
  blackjack = false,
): number {
  if (Number.isFinite(before) && Number.isFinite(after)) return after - before;
  if (outcome === "win") return bet * (blackjack ? 1.5 : 1);
  if (outcome === "lose") return -bet;
  if (outcome === "tie") return 0;
  throw new Error(`Unknown blackjack outcome: ${outcome}`);
}

/* -------------------------------------------------------------------------- */
/*  Reading the table                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Turn the dealer's visible upcard into its value (A = 11, J/Q/K = 10).
 * The UI renders the suit glyph next to the rank, so the suit is stripped.
 */
export function parseDealerRank(text: string): number {
  const rank = String(text)
    .replace(/[♠♣♥♦]/g, "")
    .trim()
    .toUpperCase();
  if (rank === "A") return 11;
  if (rank === "J" || rank === "Q" || rank === "K") return 10;
  const value = Number(rank);
  if (Number.isInteger(value) && value >= 2 && value <= 10) return value;
  throw new Error(`Cannot read the dealer's card: ${text}`);
}

/**
 * Stand threshold for a HARD total, indexed by the dealer's upcard (2..11).
 * "Hit" means the total is below the threshold.
 *
 *   dealer 2,3  -> stand on 13+   (hard 12 vs 2 or 3 is a hit)
 *   dealer 4-6  -> stand on 12+
 *   dealer 7-A  -> stand on 17+
 */
const HARD_STAND_AT = [13, 13, 12, 12, 12, 17, 17, 17, 17, 17];

/**
 * Stand threshold for a SOFT total (an ace still counted as 11).
 *
 *   dealer 2-8  -> stand on 18+   (soft 13-17 is always a hit)
 *   dealer 9-A  -> stand on 19+
 */
const SOFT_STAND_AT = [18, 18, 18, 18, 18, 18, 18, 18, 19, 19];

/**
 * The dealer-aware basic strategy. Doubling is not available in Bitburner, so
 * the "double" cells of the published chart collapse into "hit".
 */
export function basicStrategy(total: number, soft: boolean, dealer: number): boolean {
  if (!(dealer >= 2 && dealer <= 11)) throw new Error(`Invalid dealer rank: ${dealer}`);
  const table = soft ? SOFT_STAND_AT : HARD_STAND_AT;
  return total < table[dealer - 2];
}

/**
 * Decide whether to hit.
 *
 * The casino prints "Count: 17" for a hard total and "Count: 18, 8" for a soft
 * one (the two values an ace can be worth), so more than one number means the
 * hand is soft.
 */
export function blackjackShouldHit(countText: string, dealer: number, strategy: Strategy = "basic"): boolean {
  const counts = (String(countText).replace(/^.*?Count:\s*/i, "").match(/\d+/g) ?? []).map(Number);
  const valid = counts.filter((count) => count >= 1 && count <= 21);
  if (valid.length === 0) throw new Error(`Cannot read a playable blackjack count: ${countText}`);

  const total = Math.max(...valid);
  const soft = valid.length > 1;

  if (strategy === "simple") return total < 17;
  return basicStrategy(total, soft, dealer);
}

/* -------------------------------------------------------------------------- */
/*  Seed money                                                                 */
/* -------------------------------------------------------------------------- */

export interface CrimeChoice<T extends string = string> {
  name: T;
  money: number;
  time: number;
  chance: number;
}

/**
 * Pick the crime that reaches `remaining` dollars in the least expected time.
 * Expected attempts = 1 / chance, so the expected time is
 * ceil(remaining / money) * time / chance.
 */
export function chooseSeedCrime<T extends string>(
  choices: CrimeChoice<T>[],
  remaining: number,
): CrimeChoice<T> | null {
  if (remaining <= 0) return null;

  let best: CrimeChoice<T> | null = null;
  let bestEta = Infinity;

  for (const choice of choices) {
    if (!(choice.money > 0 && choice.time > 0 && choice.chance > 0)) continue;
    if (!Number.isFinite(choice.money + choice.time + choice.chance)) continue;
    const attempts = Math.ceil(remaining / choice.money) / Math.min(1, choice.chance);
    const eta = attempts * choice.time;
    if (eta < bestEta) {
      bestEta = eta;
      best = choice;
    }
  }

  return best;
}

/* -------------------------------------------------------------------------- */
/*  What to do after a hand                                                    */
/* -------------------------------------------------------------------------- */

export interface RoundState {
  hands: number;
  net: number;
  peak: number;
}

export type HandAction = "save" | "reload" | "continue";

/**
 * Save-scumming decision:
 *   save    - we won, lock the win into the save file.
 *   reload  - the bankroll is in danger, or we have slid this many bets below
 *             the peak; reloading without saving undoes those losses.
 *   continue - nothing worth reacting to.
 */
export function decideHand(
  state: RoundState,
  outcome: BlackjackOutcome,
  bet: number,
  moneyBefore: number,
  moneyAfter: number,
  blackjack: boolean,
  reloadAfterLosses: number,
): HandAction {
  const delta = casinoRoundDelta(outcome, bet, moneyBefore, moneyAfter, blackjack);
  state.net += delta;
  if (state.net > state.peak) state.peak = state.net;

  if (outcome === "win") return "save";
  if (moneyAfter < TRAVEL_COST * 2) return "reload";
  if (state.net <= state.peak - bet * reloadAfterLosses) return "reload";
  return "continue";
}


