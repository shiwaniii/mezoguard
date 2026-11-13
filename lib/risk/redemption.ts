/**
 * Redemption analyzer (MUSD Troves only). Pure.
 *
 * `redeemCollateral` starts at SortedTroves.getLast() (lowest NICR) and walks getPrev, skipping Troves with ICR < MCR.
 * A Trove's exposure = MUSD debt of active Troves AHEAD of it in that walk (lower NICR) whose ICR ≥ MCR — a
 * redemption must consume all of that before it touches this Trove.
 *
 * Classification by debtAheadShare = debtAhead / total system debt:
 *   < 5%   → high      (a redemption of ≤ 5% of supply reaches this Trove)
 *   < 20%  → moderate
 *   else   → low
 * These cut-offs are MezoGuard heuristics, not protocol parameters.
 */
import type { Address } from "viem";
import type { TroveRedemption } from "@/lib/risk/types";
import { WAD } from "@/lib/risk/math";

export const REDEMPTION_THRESHOLDS = {
  high: 5n * 10n ** 16n, // 5%
  moderate: 20n * 10n ** 16n, // 20%
} as const;

export interface TroveQueueEntry {
  owner: Address;
  /** Nominal ICR (coll × 1e20 / principal) — the SortedTroves key. */
  nicr: bigint;
  /** Current ICR at the reference price. */
  icr: bigint;
  /** Total debt (principal + interest, incl. pending). */
  debt: bigint;
}

export function classifyRedemption(debtAheadShare: bigint): TroveRedemption["exposure"] {
  if (debtAheadShare < REDEMPTION_THRESHOLDS.high) return "high";
  if (debtAheadShare < REDEMPTION_THRESHOLDS.moderate) return "moderate";
  return "low";
}

/**
 * Orders entries in redemption order (lowest NICR first; ties broken by address for determinism) and computes the
 * exposure of `owner`. `systemDebt` is TroveManager.getEntireSystemDebt(). Returns undefined if owner not in the list.
 */
export function analyzeRedemption(
  entries: TroveQueueEntry[],
  owner: Address,
  mcr: bigint,
  systemDebt: bigint,
): TroveRedemption | undefined {
  const order = [...entries].sort((a, b) =>
    a.nicr === b.nicr ? (a.owner.toLowerCase() < b.owner.toLowerCase() ? -1 : 1) : a.nicr < b.nicr ? -1 : 1,
  );
  const idx = order.findIndex((e) => e.owner.toLowerCase() === owner.toLowerCase());
  if (idx < 0) return undefined;
  let debtAhead = 0n;
  for (let i = 0; i < idx; i++) if (order[i].icr >= mcr) debtAhead += order[i].debt;
  const total = systemDebt > 0n ? systemDebt : order.reduce((s, e) => s + e.debt, 0n);
  const debtAheadShare = total > 0n ? (debtAhead * WAD) / total : 0n;
  return {
    queuePosition: idx + 1,
    queueSize: order.length,
    debtAhead,
    debtAheadShare,
    exposure: classifyRedemption(debtAheadShare),
  };
}
