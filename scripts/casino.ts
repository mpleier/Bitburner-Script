/**
 * casino.ts
 * ============================================================================
 * Blackjack at the Iker Molina Casino in Aevum, driven through the game UI.
 *
 * The whole run is save-scumming:
 *   - save the game after every win, so the win is permanent;
 *   - reload the page (without saving) when the net winnings slide, which
 *     undoes the losses;
 *   - stop when the casino bans us, which is what actually ends the run.
 *
 * Read this before running it:
 *   1. It drives the browser UI. It needs the game window on the casino page
 *      and it needs the player's focus. Any module that takes focus
 *      (crime.ts, jobs.ts, factions.ts, bladeburner.ts, share.ts) fights it, so
 *      autobot.ts mutes those five while casino.ts is scheduled.
 *   2. It runs by default: autobot.ts turns it off with --no-casino.
 *   3. The house bans us after ~10 billion in winnings. After that there is
 *      nothing left to automate.
 *   4. When the casino kicks us out for cheating, casino.ts writes
 *      casino_banned.txt on its server and exits. Every later run - and
 *      autobot.ts's scheduler - reads that note and leaves the casino alone,
 *      so the module stops instead of being restarted every interval.
 *
 * RAM cost (GB): base 1.6 + core.ts 9.7 + logger.ts 0.05
 *   + ps 0.2 | getPlayer 0.5 | getMoneySources 0.5 | ls 0.05
 *   + singularity.travelToCity 2 | goToLocation 2 | getCurrentWork 2
 *   + commitCrime 2 | getCrimeStats 2 | getCrimeChance 2
 *   + getServerMaxRam 0.05 | sleep/print/write 0
 *   => RAM_NEEDED below; `npm run ram` recomputes it exactly.
 *
 * Usage
 *   run casino.ts --dry-run               report the plan, touch nothing
 *   run casino.ts                         play until banned
 *   run casino.ts --max-rounds 200        stop after 200 hands
 *   run casino.ts --simple-strategy       stay on 17+, ignore the dealer
 *   run casino.ts --earn-seed             grind crimes up to 300k first
 *   run autobot.ts --no-casino            keep the blackjack bot off
 */

// Bitburner injects its API typings as a global declaration file, so `NS`
// needs no import (globals.d.ts mirrors that for local `tsc` checks).

// core.ts is imported statically on purpose: Bitburner's RAM allocation is
// computed from the AST of the script and everything it *statically* imports.
import * as core from "./core.ts";
import * as logger from "./logger.ts";
import * as policy from "./casino-policy.ts";

/** Recomputed by `npm run ram` (ramgap.mjs): 34.35 GB worst case. */
const RAM_NEEDED = 35;

interface Options {
  saveSleepMs: number;
  clickSleepMs: number;
  findSleepMs: number;
  strategy: policy.Strategy;
  maxRounds: number;
  reloadAfterLosses: number;
  seedMoney: number;
  earnSeed: boolean;
  dryRun: boolean;
}

function parseOptions(ns: NS): Options | null {
  const args = ns.args.map(String);
  const options: Options = {
    saveSleepMs: core.numOr(args, "--save-sleep", 10),
    clickSleepMs: core.numOr(args, "--click-sleep", 5),
    findSleepMs: core.numOr(args, "--find-sleep", 0),
    strategy: core.hasFlag(args, "--simple-strategy") ? "simple" : "basic",
    maxRounds: core.numOr(args, "--max-rounds", 1000),
    reloadAfterLosses: core.numOr(args, "--reload-after-losses", policy.DEFAULT_RELOAD_AFTER_LOSSES),
    seedMoney: core.numOr(args, "--seed", policy.CASINO_SEED_MONEY),
    earnSeed: core.hasFlag(args, "--earn-seed"),
    dryRun: core.hasFlag(args, "--dry-run"),
  };

  const error = policy.casinoOptionsError(options);
  if (error) {
    logger.tlog(ns, `casino: ${error}`);
    return null;
  }
  return options;
}

export async function main(ns: NS): Promise<void> {
  ns.clearLog();
  ns.disableLog("ALL");

  const opts = parseOptions(ns);
  if (!opts) return;

  const host = ns.getHostname();
  if (ns.getServerMaxRam(host) < RAM_NEEDED) {
    logger.tlog(ns, `casino.ts needs ${RAM_NEEDED} GB; ${host} has ${ns.getServerMaxRam(host)} GB.`);
    return;
  }

  logger.log(ns, "=== casino module ===");

  /* The house throws us out once. If it already has - in the UI, in the game's
     own winnings counter, or in the note a previous run left behind - there is
     nothing left to automate, and we must not be restarted every interval. */
  const ban = banReason(ns);
  if (ban) {
    recordBan(ns, ban);
    logger.tlog(ns, `casino: ${ban}. casino.ts will not run again in this save.`);
    logger.log(ns, "casino: the casino is closed to us, stopping");
    return;
  }

  if (opts.dryRun) {
    logger.log(ns, `money ${core.fmt(core.money(ns))} -> wager ${core.fmt(policy.casinoWager(core.money(ns)))}`);
    logger.log(ns, `strategy ${opts.strategy} | max ${opts.maxRounds} hands | reload after ${opts.reloadAfterLosses} hands of losses`);
    logger.log(ns, `casino winnings so far ${core.fmt(casinoWinnings(ns))} (the house bans at ${core.fmt(policy.CASINO_BAN_THRESHOLD)})`);
    logger.log(ns, `[dry-run] would travel to Aevum and play at the Iker Molina Casino`);
    return;
  }

  const doc = getDocument();
  if (!doc) {
    logger.tlog(ns,
      "casino.ts needs the game UI: it automates the blackjack page by clicking " +
      "on it, so it has to run in the browser with the Overview panel open. " +
      "Use --dry-run to see what it would do without touching the UI.",
    );
    return;
  }

  if (!(await ensureSeedMoney(ns, opts))) return;

  for (let attempt = 1; attempt <= 5; ++attempt) {
    try {
      await reachBlackjackTable(ns, doc, opts);
      break;
    } catch (err) {
      logger.log(ns, `casino: attempt ${attempt}/5 to reach the table failed: ${(err as Error).message}`);
      if (attempt === 5) {
        logger.tlog(ns, "casino: gave up reaching the blackjack table.");
        return;
      }
      await ns.sleep(1000);
    }
  }

  // Saving here is what makes the reload loop restart this script.
  await saveGame(ns, doc, opts);

  const state: policy.RoundState = { hands: 0, net: 0, peak: 0 };
  const reason = await playHands(ns, doc, opts, state);
  logger.log(ns, `casino: stopped (${reason}) after ${state.hands} hands, net ${core.fmt(state.net)}`);

  // A kick-out is permanent for this save, so say it loudly in the terminal
  // instead of letting the cooldown quietly back off.
  if (policy.isBanText(reason)) {
    logger.tlog(ns, `casino: ${reason}. ${policy.CASINO_BAN_MARKER} now records it, so the suite will not start casino.ts again.`);
  }

  // Hand the screen back to the terminal, best effort.
  const terminal = find(doc, policy.XPATH.terminal);
  if (terminal) await clickElement(ns, doc, terminal, opts);
}

/* -------------------------------------------------------------------------- */
/*  DOM access                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Bitburner's sandbox does not expose `document` as a global, so it has to be
 * pulled out with eval - the same trick the community casino scripts use.
 * Returns null in a headless harness, which is how casino.ts detects that it
 * cannot drive the UI.
 */
function getDocument(): any | null {
  try {
    const doc = eval("document");
    if (!doc || typeof doc.evaluate !== "function") return null;
    return doc;
  } catch {
    return null;
  }
}

/** XPathResult.FIRST_ORDERED_NODE_TYPE, inlined so we never need the global. */
const FIRST_ORDERED_NODE_TYPE = 9;

/** One element or null. Never throws: a half-rendered page is normal. */
function find(doc: any, xpath: string): any | null {
  try {
    return doc.evaluate(xpath, doc, null, FIRST_ORDERED_NODE_TYPE, null).singleNodeValue ?? null;
  } catch {
    return null;
  }
}

/**
 * Look for an element, retrying while the UI catches up. The retry delay
 * doubles up to 200 ms, which is the game's tick rate, so a retry can never
 * be faster than one game tick.
 */
async function findElement(
  ns: NS,
  doc: any,
  xpath: string,
  retries: number,
  opts: Options,
  required: boolean,
): Promise<any | null> {
  if (opts.findSleepMs > 0) await ns.sleep(opts.findSleepMs);

  let delay = 1;
  for (let attempt = 1; attempt <= retries; ++attempt) {
    const element = find(doc, xpath);
    if (element) return element;
    if (attempt < retries) {
      await ns.sleep(delay);
      delay = Math.min(delay * 2, 200);
    }
  }

  if (required) {
    throw new Error(`could not find the element for "${xpath}" after ${retries} attempts`);
  }
  return null;
}

/**
 * The casino's buttons are React components: clicking the DOM node is not
 * always enough, because the component's own state only changes through the
 * handler React attached to it. So we call that handler directly when we can
 * find it, and fall back to a plain click when we cannot.
 */
function reactHandler(element: any, eventName: string): ((event: any) => void) | null {
  if (!element || element.isConnected === false || element.disabled) return null;

  for (const key of Object.keys(element)) {
    if (!key.startsWith("__reactProps$")) continue;
    const handler = element[key] && element[key][eventName];
    if (typeof handler === "function") return handler;
  }

  for (const key of Object.keys(element)) {
    if (!key.startsWith("__reactFiber$")) continue;
    const fiber = element[key];
    if (fiber && fiber.stateNode === element) {
      for (const props of [fiber.memoizedProps, fiber.pendingProps]) {
        if (props && typeof props[eventName] === "function") return props[eventName];
      }
    }
  }

  return null;
}

/** The minimum a React handler needs to accept the event as real. */
function fakeEvent(element: any): any {
  return {
    isTrusted: true,
    target: element,
    currentTarget: element,
    nativeEvent: { isTrusted: true },
    preventDefault: () => {},
    stopPropagation: () => {},
  };
}

async function clickElement(ns: NS, doc: any, element: any, opts: Options): Promise<void> {
  if (!element) throw new Error("click was called on an element that is not on screen");

  if (opts.clickSleepMs > 0) await ns.sleep(opts.clickSleepMs);

  const handler = reactHandler(element, "onClick");
  if (handler) handler(fakeEvent(element));
  else if (typeof element.click === "function") element.click();
  else throw new Error("this element has neither a React onClick handler nor a click() method");

  if (opts.clickSleepMs > 0) await ns.sleep(opts.clickSleepMs);
}

async function setWager(ns: NS, doc: any, input: any, value: number, opts: Options): Promise<void> {
  if (!input) throw new Error("the wager input is not on screen");

  if (opts.clickSleepMs > 0) await ns.sleep(opts.clickSleepMs);

  const text = String(value);
  const handler = reactHandler(input, "onChange");
  if (handler) handler({ ...fakeEvent(input), target: { value: text } });
  else input.value = text;

  if (opts.clickSleepMs > 0) await ns.sleep(opts.clickSleepMs);
}


/* -------------------------------------------------------------------------- */
/*  Getting to the table                                                       */
/* -------------------------------------------------------------------------- */

/** Total casino winnings the game has recorded for this install. */
function casinoWinnings(ns: NS): number {
  return core.tryCall(() => Number(ns.getMoneySources().sinceInstall.casino) || 0, 0);
}

/* -------------------------------------------------------------------------- */
/*  The ban                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The note a previous run left when the house threw us out, or null when there
 * is none. Blackjack has no API, so this file is the only way the kick-out
 * survives past the script's own lifetime.
 */
function banNote(ns: NS): string | null {
  const marker = policy.CASINO_BAN_MARKER;
  try {
    if (!ns.ls(ns.getHostname()).includes(marker)) return null;
    const note = ns.read(marker);
    return note
      ? note.split("\n").filter((line) => line.trim()).join(" | ")
      : "the note left by an earlier run";
  } catch {
    // Cannot prove a ban, so let the run carry on.
    return null;
  }
}

/** Why the casino is closed to us, or null while it is still open. */
function banReason(ns: NS): string | null {
  const note = banNote(ns);
  if (note) return `already kicked out for cheating (${note})`;
  if (policy.isBannedByWinnings(casinoWinnings(ns))) {
    return `kicked out for cheating: winnings ${core.fmt(casinoWinnings(ns))} passed the ${core.fmt(policy.CASINO_BAN_THRESHOLD)} limit`;
  }
  return null;
}

/**
 * Write the ban note so this script exits on its next run and autobot.ts stops
 * scheduling it. Losing this file is not fatal: the winnings counter and the UI
 * modal are checked every run too.
 */
function recordBan(ns: NS, reason: string): void {
  if (banNote(ns)) return;
  try {
    ns.write(
      policy.CASINO_BAN_MARKER,
      `casino banned: ${reason}\ncasino winnings ${core.fmt(casinoWinnings(ns))}\n`,
      "w",
    );
    logger.log(ns, `casino: wrote ${policy.CASINO_BAN_MARKER} so the suite stops scheduling casino.ts`);
  } catch (err) {
    logger.log(ns, `casino: could not record the ban (${(err as Error).message})`);
  }
}

/**
 * The kick-out modal, whatever its exact wording happens to be. The XPath is the
 * fast path; the page scan is the fallback for a game update that rewords it.
 */
function banText(doc: any): string | null {
  const modal = find(doc, policy.XPATH.kickedOut);
  if (modal) return String(modal.textContent || "").trim();

  const body = doc && doc.body ? String(doc.body.textContent || "") : "";
  for (const phrase of policy.BAN_TEXTS) {
    const at = body.toLowerCase().indexOf(phrase.toLowerCase());
    if (at >= 0) return body.slice(at, at + 60).trim();
  }
  return null;
}

/**
 * A crime, a job or a class takes the player's focus, and the casino page is
 * replaced by the work page. If that happened, click "do something else
 * simultaneously" to get the UI back.
 */
async function releaseFocus(ns: NS, doc: any, opts: Options): Promise<boolean> {
  const button = find(doc, policy.XPATH.unfocus);
  if (!button) return false;
  logger.log(ns, "casino: something is holding the player's focus, releasing it");
  await clickElement(ns, doc, button, opts);
  return true;
}

async function travelToAevum(ns: NS, doc: any, opts: Options): Promise<void> {
  if (core.money(ns) < policy.TRAVEL_COST) {
    throw new Error(`travel to Aevum costs ${core.fmt(policy.TRAVEL_COST)}, we have ${core.fmt(core.money(ns))}`);
  }

  // Source-File 4 makes this a single call.
  if (core.tryCall(() => ns.singularity.travelToCity("Aevum"), false)) return;

  // Otherwise click through the World -> Travel menu.
  await clickElement(ns, doc, await findElement(ns, doc, policy.XPATH.travelButton, 15, opts, true), opts);
  await clickElement(ns, doc, await findElement(ns, doc, policy.XPATH.aevumLink, 15, opts, true), opts);

  if (ns.getPlayer().city !== "Aevum") {
    const confirm = await findElement(ns, doc, policy.XPATH.travelConfirm, 15, opts, false);
    if (confirm) await clickElement(ns, doc, confirm, opts);
  }

  if (ns.getPlayer().city !== "Aevum") {
    throw new Error(`still in ${ns.getPlayer().city} after trying to travel to Aevum`);
  }
}

async function reachBlackjackTable(ns: NS, doc: any, opts: Options): Promise<void> {
  await releaseFocus(ns, doc, opts);

  if (ns.getPlayer().city !== "Aevum") await travelToAevum(ns, doc, opts);

  if (!find(doc, policy.XPATH.casinoTitle)) {
    await clickElement(ns, doc, await findElement(ns, doc, policy.XPATH.cityMenu, 15, opts, true), opts);
    await clickElement(ns, doc, await findElement(ns, doc, policy.XPATH.casinoLink, 15, opts, true), opts);

    if (!find(doc, policy.XPATH.casinoTitle)) {
      if (!core.tryCall(() => ns.singularity.goToLocation("Iker Molina Casino"), false)) {
        throw new Error("neither the City menu nor goToLocation opened the casino");
      }
    }
  }

  await clickElement(ns, doc, await findElement(ns, doc, policy.XPATH.blackjack, 15, opts, true), opts);
  logger.log(ns, "casino: at the blackjack table");
}

/**
 * True when the casino has thrown us out: the note an earlier run left, the
 * game's own winnings counter, or the kick-out modal on screen. Other modals
 * have to be closed first, because they sit in front of the ban message.
 */
async function isBanned(ns: NS, doc: any, opts: Options, retries = 3): Promise<boolean> {
  if (banReason(ns)) return true;

  for (let attempt = 0; attempt < retries; ++attempt) {
    if (banText(doc)) return true;
    const close = find(doc, policy.XPATH.closeModal);
    if (!close) break;
    await clickElement(ns, doc, close, opts);
  }
  return false;
}

/**
 * Check for the kick-out and, when it happened, record it so neither this script
 * nor autobot.ts starts the run again. Returns the reason, or null while the
 * casino is still open to us.
 */
async function kickedOut(ns: NS, doc: any, opts: Options, retries = 1): Promise<string | null> {
  const reason = banReason(ns)
    ?? (await isBanned(ns, doc, opts, retries) ? "the casino kicked us out for cheating" : null);
  if (!reason) return null;
  recordBan(ns, reason);
  return reason;
}

/**
 * "win" | "lose" | "tie" once the hand is over, null while it is still in play
 * or when the last click did not register.
 */
async function readOutcome(ns: NS, doc: any, opts: Options): Promise<policy.BlackjackOutcome | null> {
  for (let retries = 1; retries <= 5; ++retries) {
    if (find(doc, policy.XPATH.hit)) return null;
    if (find(doc, policy.XPATH.lost)) return "lose";
    if (find(doc, policy.XPATH.won)) return "win";
    if (find(doc, policy.XPATH.tie)) return "tie";
    await ns.sleep(retries * 20);
  }
  return null;
}

async function dealerRank(ns: NS, doc: any, opts: Options): Promise<number> {
  const card = await findElement(ns, doc, policy.XPATH.dealerCard, 10, opts, true);
  return policy.parseDealerRank(card.textContent || "");
}


/* -------------------------------------------------------------------------- */
/*  Playing                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * One hand: place the bet, hit or stay until the hand is over, then save,
 * reload or carry on depending on the result.
 *
 * Returns why the run stopped.
 */
async function playHands(ns: NS, doc: any, opts: Options, state: policy.RoundState): Promise<string> {
  let startRetries = 0;

  while (state.hands < opts.maxRounds) {
    // The house can throw us out between hands, so check before every bet.
    const ban = await kickedOut(ns, doc, opts);
    if (ban) return ban;

    const bet = policy.casinoWager(core.money(ns));
    if (bet <= 0) return "no money left to bet";

    const moneyBefore = core.money(ns);
    const wagerInput = await findElement(ns, doc, policy.XPATH.wagerInput, 15, opts, true);
    await setWager(ns, doc, wagerInput, bet, opts);
    const startButton = await findElement(ns, doc, policy.XPATH.startGame, 15, opts, true);
    await clickElement(ns, doc, startButton, opts);

    // No Hit/Stay buttons means the hand ended immediately or never started.
    if (!find(doc, policy.XPATH.hit) && !find(doc, policy.XPATH.stay)) {
      const outcome = await readOutcome(ns, doc, opts);
      if (outcome === null) {
        const banNow = await kickedOut(ns, doc, opts, 3);
        if (banNow) return banNow;
        if (++startRetries <= 5) {
          logger.log(ns, `casino: the Start click did not register (retry ${startRetries}/5)`);
          continue;
        }
        return "the Start button never responded";
      }
      state.hands += 1;
      const action = finishHand(ns, doc, opts, state, outcome, bet, moneyBefore);
      if (action === "reload") return await undoLosses(ns, opts);
      const ban = await kickedOut(ns, doc, opts, 1);
      if (ban) return ban;
      continue;
    }

    // The hand is in play: keep hitting until it ends.
    const handStarted = Date.now();
    let outcome: policy.BlackjackOutcome | null = null;

    while (outcome === null) {
      if (Date.now() - handStarted > 30_000) return "a hand took longer than 30 seconds";

      const count = await findElement(ns, doc, policy.XPATH.count, 10, opts, true);
      const dealer = await dealerRank(ns, doc, opts);
      const shouldHit = policy.blackjackShouldHit(count.textContent || "", dealer, opts.strategy);

      const button = await findElement(ns, doc, shouldHit ? policy.XPATH.hit : policy.XPATH.stay, 10, opts, true);
      await clickElement(ns, doc, button, opts);
      await ns.sleep(1); // let the game deal the next card

      outcome = await readOutcome(ns, doc, opts);
    }

    state.hands += 1;
    const action = finishHand(ns, doc, opts, state, outcome, bet, moneyBefore);
    if (action === "reload") return await undoLosses(ns, opts);
    const banAfter = await kickedOut(ns, doc, opts, 1);
    if (banAfter) return banAfter;
  }

  return "reached --max-rounds";
}

/**
 * Record the hand and decide what the run needs next:
 *   save    - we won, so write the win to the save file to keep it.
 *   reload  - we are losing badly, reload without saving to undo it.
 *   nothing - carry on.
 */
function finishHand(
  ns: NS,
  doc: any,
  opts: Options,
  state: policy.RoundState,
  outcome: policy.BlackjackOutcome,
  bet: number,
  moneyBefore: number,
): policy.HandAction {
  const blackjack = outcome === "win" && Boolean(find(doc, policy.XPATH.blackjackWin));
  const moneyAfter = core.money(ns);
  const action = policy.decideHand(state, outcome, bet, moneyBefore, moneyAfter, blackjack, opts.reloadAfterLosses);

  // One line per hand is a lot of noise: without --verbose we only report a
  // checkpoint every 25 hands, and reloads/bans always get their own line.
  if (logger.verbose(ns) || state.hands % 25 === 0) {
    logger.log(ns,
      `casino: hand ${state.hands} ${outcome}${blackjack ? " (blackjack)" : ""} ` +
      `${core.fmt(policy.casinoRoundDelta(outcome, bet, moneyBefore, moneyAfter, blackjack))} | net ${core.fmt(state.net)}`
    );
  }

  // Only worth a save if this win is the best the run has achieved so far.
  if (action === "save" && state.net >= state.peak) void saveGame(ns, doc, opts);

  return action;
}

/* -------------------------------------------------------------------------- */
/*  Saving and reloading                                                       */
/* -------------------------------------------------------------------------- */

/** Save the game through the Overview panel's save button. */
async function saveGame(ns: NS, doc: any, opts: Options): Promise<void> {
  if (opts.saveSleepMs > 0) await ns.sleep(opts.saveSleepMs);
  const button = await findElement(ns, doc, policy.XPATH.saveGame, 100, opts, true);
  await clickElement(ns, doc, button, opts);
  if (opts.saveSleepMs > 0) await ns.sleep(opts.saveSleepMs);
}

/**
 * Reload the page without saving, which is what undoes a loss. The game shows
 * a confirmation dialog when the page is closed while scripts are running, so
 * `onbeforeunload` is cleared first.
 *
 * Note: the reload kills this script, so nothing after it runs in the real
 * game. The script restarts from the save file, which is the point of the loop
 * in main().
 */
async function undoLosses(ns: NS, opts: Options): Promise<string> {
  let win: any = null;
  try {
    win = eval("window");
  } catch {
    return "the page could not be reloaded to undo the losses";
  }
  if (!win || !win.location) return "no window to reload";

  const previous = win.onbeforeunload;
  try {
    win.onbeforeunload = null;
    if (opts.saveSleepMs > 0) await ns.sleep(opts.saveSleepMs);
    win.location.reload();
    return "reloaded the page to undo the losses";
  } catch (err) {
    logger.log(ns, `casino: reload failed: ${(err as Error).message}`);
    return "reload failed";
  } finally {
    // Only reached if the reload never happened.
    win.onbeforeunload = previous;
  }
}

/* -------------------------------------------------------------------------- */
/*  Seed money                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A run is pointless without a bankroll: travel costs 200k and a hand worth
 * playing needs a real bet. With --earn-seed we grind crimes for it; without
 * it we tell the player what to run and exit, which is what autobot.ts's
 * cooldown then backs off from.
 */
async function ensureSeedMoney(ns: NS, opts: Options): Promise<boolean> {
  if (core.money(ns) >= opts.seedMoney) return true;

  if (!opts.earnSeed) {
    logger.tlog(ns,
      `casino: ${core.fmt(core.money(ns))} is not enough. A run needs ${core.fmt(opts.seedMoney)} ` +
      `(travel ${core.fmt(policy.TRAVEL_COST)} plus a bet). Run crime.ts or jobs.ts first, ` +
      "or pass --earn-seed and this module will grind the crimes for you."
    );
    return false;
  }

  if (core.workBladeburnerConflict(ns)) {
    logger.log(ns, "casino: the player's time is taken by a job or a Bladeburner action, cannot earn seed money");
    return false;
  }

  const choices = Object.values(ns.enums.CrimeType).map((name) => {
    const stats = ns.singularity.getCrimeStats(name);
    return { name, money: stats.money, time: stats.time, chance: ns.singularity.getCrimeChance(name) };
  });

  for (let attempt = 0; attempt < 20 && core.money(ns) < opts.seedMoney; ++attempt) {
    const crime = policy.chooseSeedCrime(choices, opts.seedMoney - core.money(ns));
    if (!crime) {
      logger.log(ns, "casino: no crime can earn the seed money");
      return false;
    }
    logger.log(ns,
      `casino: committing ${crime.name} (${core.fmt(crime.money)}, ${core.fmtTime(crime.time)}, chance ${crime.chance})`
    );
    const duration = ns.singularity.commitCrime(crime.name);
    if (duration > 0) await ns.sleep(duration);
  }

  return core.money(ns) >= opts.seedMoney;
}


