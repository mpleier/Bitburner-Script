/**
 * spending-policy.ts
 * ============================================================================
 * Pure spending rules for the suite. No ns.* call appears in this file, so
 * importing it costs 0 GB and every rule can be exercised offline:
 *   node mocksuite.mjs spending-policy
 *
 * The problem this solves: hacknet.ts, gang.ts, stock.ts, corporation.ts and
 * ascend.ts all spend from the same pool of money at the same time. Without a
 * shared budget each of them can drain the bank, and the module that runs last
 * finds nothing left.
 *
 * Two rules:
 *   1. RESERVE_FRACTION of the bank is never touched - it is the buffer that
 *      keeps server hacking, infiltration and casino buy-ins working.
 *   2. What is left over is split into per-subsystem ceilings, so no single
 *      subsystem can take everything.
 */

/** Fraction of the bank that no subsystem may spend. */
export const RESERVE_FRACTION = 0.25;

/** Per-subsystem ceiling, as a fraction of the spendable money. */
export const ALLOWANCES: Record<string, number> = {
  hacknet: 0.2,
  gang: 0.15,
  augs: 0.5,
  stock: 0.1,
  corporation: 0.3,
  casino: 0.05,
  infiltration: 0.02,
  darknet: 0.05,
  contracts: 0,
};

/** Used when a subsystem is not in ALLOWANCES. */
export const DEFAULT_ALLOWANCE = 0.1;

/** Money that must stay in the bank. */
export function reserve(money: number): number {
  return Math.max(0, money) * RESERVE_FRACTION;
}

/** Money a subsystem is allowed to spend right now. */
export function allowance(money: number, subsystem: string): number {
  const spendable = Math.max(0, money) - reserve(money);
  const fraction = ALLOWANCES[subsystem] ?? DEFAULT_ALLOWANCE;
  return Math.max(0, spendable * fraction);
}

/** Can `subsystem` afford `cost` without breaking the reserve? */
export function canAfford(money: number, cost: number, subsystem: string): boolean {
  if (cost <= 0) return true;
  return cost <= allowance(money, subsystem);
}

/**
 * Same question, but with the reason - useful for a log line that explains why
 * a purchase was skipped instead of silently doing nothing.
 */
export function spendPlan(
  money: number,
  cost: number,
  subsystem: string,
): { ok: boolean; reason: string; limit: number } {
  const limit = allowance(money, subsystem);
  if (cost <= 0) return { ok: true, reason: "free", limit };
  if (cost <= limit) return { ok: true, reason: "within allowance", limit };
  return {
    ok: false,
    reason: `${subsystem} budget is ${limit.toFixed(0)} of ${money.toFixed(0)} bank, cost is ${cost.toFixed(0)}`,
    limit,
  };
}

/** How much money is left for a subsystem after a planned purchase. */
export function headroom(money: number, cost: number, subsystem: string): number {
  return allowance(money, subsystem) - Math.max(0, cost);
}
