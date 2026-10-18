/**
 * stock.ts
 * ============================================================================
 * Stock market automation: buys the WSE account, the Tix API and the 4S
 * market data, then trades every symbol using the forecast + volatility.
 *
 * Expected profit per share per tick  ~=  (forecast - 0.5) * 2 * price * volatility
 * We go long when that is positive, short when it is negative, and we size
 * the position so a bad tick cannot wipe out the bankroll.
 *
 * RAM cost (GB): base 1.6 + 4 account checks 0.05 + 4 purchases 2.5
 *   + getSymbols 2 + getPrice 2 + getPosition 2 + getMaxShares 2
 *   + getVolatility 2.5 + getForecast 2.5 + 4 trade calls 2.5 + getPlayer 0.5
 *   => ~39 GB
 *
 * Usage
 *   run stock.ts
 *   run stock.ts --risk 0.02 --dry-run
 */

// Bitburner injects its API typings as a global declaration file, so `NS`
// needs no import (globals.d.ts mirrors that for local `tsc` checks).

// core.ts is imported statically on purpose. Bitburner's RAM allocation is
// computed from the AST of the script and everything it *statically* imports;
// ns.dynamicImport() is invisible to that pass, so the API calls core.ts makes
// would not be paid for and the game would abort the script with a RAM error.
import * as core from "./core.ts";
import * as logger from "./logger.ts";

const RAM_NEEDED = 45;

/* Stock market access costs, straight from src/StockMarket.ts:
   getStockMarketWseCost / getStockMarketTixApiCost /
   getStockMarket4SDataCost / getStockMarket4STixApiCost */
const COST_WSE = 4_000_000;
const COST_TIX = 2_000_000;
const COST_4S = 1_000_000;
const COST_4S_TIX = 1_000_000;

export async function main(ns: NS): Promise<void> {
  ns.clearLog();
  ns.disableLog("ALL");

  const args = ns.args.map(String);
  const dryRun = args.includes("--dry-run");
  const risk = Number(flagOr(args, "--risk", 0.02)); // fraction of bankroll per position
  const loops = core.maxLoops(args);
  const host = ns.getHostname();

  if (ns.getServerMaxRam(host) < RAM_NEEDED) {
    logger.tlog(ns, `stock.ts needs ${RAM_NEEDED} GB; ${host} has ${ns.getServerMaxRam(host)} GB.`);
    return;
  }

  logger.log(ns, "=== stock module ===");

  for (let loop = 0; loop < loops; ++loop) {
    /* Gates. In the real game (src/StockMarket.ts) only getConstants and the
       four "has..." / "purchase..." calls are ungated:
         - getSymbols/getPrice/getPosition/getMaxShares/getBonusTime/nextUpdate
           throw "You don't have TIX API Access! Cannot use stock.x()"
         - getForecast/getVolatility throw
           "You don't have 4S Market Data TIX API Access!"
       So buy the access before touching the market, and skip the tick when we
       cannot afford it. */
    if (!ns.stock.hasWseAccount()) {
      if (dryRun) { logger.log(ns, `[dry-run] would buy a WSE account for ${fmt(COST_WSE)}`); return; }
      if (ns.getPlayer().money < COST_WSE) {
        logger.log(ns, `waiting for ${fmt(COST_WSE)} for a WSE account`);
        await ns.sleep(5000);
        continue;
      }
      if (!ns.stock.purchaseWseAccount()) {
        logger.log(ns, "WSE account purchase failed");
        await ns.sleep(5000);
        continue;
      }
    }

    if (!ns.stock.hasTixApiAccess()) {
      if (dryRun) { logger.log(ns, `[dry-run] would buy TIX API access for ${fmt(COST_TIX)}`); return; }
      if (ns.getPlayer().money < COST_TIX) {
        logger.log(ns, `waiting for ${fmt(COST_TIX)} for TIX API access`);
        await ns.sleep(5000);
        continue;
      }
      if (!ns.stock.purchaseTixApi()) {
        logger.log(ns, "TIX API purchase failed");
        await ns.sleep(5000);
        continue;
      }
    }

    if (!ns.stock.has4SData() && !dryRun && ns.getPlayer().money > COST_4S * 2) {
      ns.stock.purchase4SMarketData();
    }

    if (!ns.stock.has4SDataTixApi()) {
      if (dryRun) { logger.log(ns, `[dry-run] would buy 4S Market Data TIX API for ${fmt(COST_4S_TIX)}`); return; }
      if (ns.getPlayer().money < COST_4S_TIX) {
        logger.log(ns, `waiting for ${fmt(COST_4S_TIX)} for 4S Market Data TIX API`);
        await ns.sleep(5000);
        continue;
      }
      // Returns false when 4S data is disabled in this bitnode's advanced
      // options, so there is no forecast to read - stop rather than throw.
      if (!ns.stock.purchase4SMarketDataTixApi()) {
        logger.log(ns, "4S Market Data TIX API unavailable (4S data disabled in bitnode options). Exiting.");
        return;
      }
    }

    const cash = ns.getPlayer().money;
    const symbols = ns.stock.getSymbols();
    let trades = 0;

    for (const sym of symbols) {
      const forecast = ns.stock.getForecast(sym);
      const volatility = ns.stock.getVolatility(sym);
      const price = ns.stock.getPrice(sym);
      const maxShares = ns.stock.getMaxShares(sym);
      const [long, short, longProfit, shortProfit] = ns.stock.getPosition(sym);

      const edge = (forecast - 0.5) * 2 * volatility; // expected return per share per tick
      const budget = ns.getPlayer().money * risk;
      const want = Math.min(maxShares, Math.floor(budget / Math.max(price, 1)));

      if (edge > 0.001) {
        // Long: buy up to `want`, take profit when we are far ahead.
        if (long < want) {
          const shares = want - long;
          if (!dryRun) ns.stock.buyStock(sym, shares);
          trades++;
        } else if (longProfit > price * long * 0.5) {
          const sell = Math.floor(long / 2);
          if (sell > 0) {
            if (!dryRun) ns.stock.sellStock(sym, sell);
            trades++;
          }
        }
        if (short > 0) {
          if (!dryRun) ns.stock.sellShort(sym, short);
          trades++;
        }
      } else if (edge < -0.001) {
        // Short
        if (short < want) {
          const shares = want - short;
          if (!dryRun) ns.stock.buyShort(sym, shares);
          trades++;
        } else if (shortProfit > price * short * 0.5) {
          const sell = Math.floor(short / 2);
          if (sell > 0) {
            if (!dryRun) ns.stock.sellShort(sym, sell);
            trades++;
          }
        }
        if (long > 0) {
          if (!dryRun) ns.stock.sellStock(sym, long);
          trades++;
        }
      }
    }

    logger.log(ns, `tick: ${symbols.length} symbols, ${trades} trades, bankroll ${fmt(cash)}`);
    await ns.stock.nextUpdate();
  }
}

function flagOr(args: string[], name: string, fallback: number): number {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? Number(args[i + 1]) : fallback;
}

function fmt(n: number): string {
  if (n >= 1e12) return (n / 1e12).toFixed(2) + "T";
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return n.toFixed(2);
}
