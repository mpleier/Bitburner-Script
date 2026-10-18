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
 *   => ~35 GB
 *
 * Usage
 *   run stock.ts
 *   run stock.ts --risk 0.02 --dry-run
 */

import type { NS } from "../defs.d";

const RAM_NEEDED = 36;

export async function main(ns: NS): Promise<void> {
  ns.clearLog();
  ns.disableLog("ALL");

  const args = ns.args.map(String);
  const dryRun = args.includes("--dry-run");
  const risk = Number(flagOr(args, "--risk", 0.02)); // fraction of bankroll per position
  const host = ns.getHostname();

  if (ns.getServerMaxRam(host) < RAM_NEEDED) {
    ns.tprint(`stock.ts needs ${RAM_NEEDED} GB; ${host} has ${ns.getServerMaxRam(host)} GB.`);
    return;
  }

  ns.print("=== stock module ===");

  while (true) {
    const cash = ns.getPlayer().money;

    // Accounts / data
    if (!ns.stock.hasWseAccount()) {
      if (cash > 4_000_000 * 2 && !dryRun) ns.stock.purchaseWseAccount();
      else {
        ns.print("waiting for WSE account (4M)");
        await ns.sleep(5000);
        continue;
      }
    }
    if (!ns.stock.hasTixApiAccess() && cash > 2_000_000 * 2) {
      if (!dryRun) ns.stock.purchaseTixApi();
    }
    if (!ns.stock.has4SData() && cash > 1_000_000 * 2) {
      if (!dryRun) ns.stock.purchase4SMarketData();
    }
    if (!ns.stock.has4SDataTixApi() && cash > 1_000_000 * 2) {
      if (!dryRun) ns.stock.purchase4SMarketDataTixApi();
    }

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

    ns.print(`tick: ${symbols.length} symbols, ${trades} trades, bankroll ${fmt(cash)}`);
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
