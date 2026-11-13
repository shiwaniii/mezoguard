/**
 * Pure mirror of Morpho Blue's MathLib / SharesMathLib and the view-side interest accrual
 * (morpho-org/morpho-blue src/libraries/{MathLib,SharesMathLib}.sol, Morpho._accrueInterest).
 */
import { WAD, mulDivDown, mulDivUp } from "@/lib/risk/math";

export const VIRTUAL_SHARES = 10n ** 6n;
export const VIRTUAL_ASSETS = 1n;

export const wMulDown = (x: bigint, y: bigint) => mulDivDown(x, y, WAD);
export const wDivUp = (x: bigint, y: bigint) => mulDivUp(x, WAD, y);

/** e^(x·n) − 1 ≈ x·n + (x·n)²/2 + (x·n)³/6, with Morpho's exact floor order. */
export function wTaylorCompounded(x: bigint, n: bigint): bigint {
  const firstTerm = x * n;
  const secondTerm = mulDivDown(firstTerm, firstTerm, 2n * WAD);
  const thirdTerm = mulDivDown(secondTerm, firstTerm, 3n * WAD);
  return firstTerm + secondTerm + thirdTerm;
}

export const toSharesDown = (assets: bigint, totalAssets: bigint, totalShares: bigint) =>
  mulDivDown(assets, totalShares + VIRTUAL_SHARES, totalAssets + VIRTUAL_ASSETS);
export const toAssetsDown = (shares: bigint, totalAssets: bigint, totalShares: bigint) =>
  mulDivDown(shares, totalAssets + VIRTUAL_ASSETS, totalShares + VIRTUAL_SHARES);
export const toSharesUp = (assets: bigint, totalAssets: bigint, totalShares: bigint) =>
  mulDivUp(assets, totalShares + VIRTUAL_SHARES, totalAssets + VIRTUAL_ASSETS);
export const toAssetsUp = (shares: bigint, totalAssets: bigint, totalShares: bigint) =>
  mulDivUp(shares, totalAssets + VIRTUAL_ASSETS, totalShares + VIRTUAL_SHARES);

export interface MorphoMarketState {
  totalSupplyAssets: bigint;
  totalSupplyShares: bigint;
  totalBorrowAssets: bigint;
  totalBorrowShares: bigint;
  lastUpdate: bigint;
  fee: bigint;
}

/**
 * Accrues interest to `now` (seconds) at `borrowRate` (per-second WAD, from IRM.borrowRateView).
 * Mirrors Morpho._accrueInterest's effect on totalBorrowAssets/totalSupplyAssets (fee shares only change supply shares).
 */
export function accrueInterest(m: MorphoMarketState, borrowRate: bigint, now: bigint): MorphoMarketState {
  const elapsed = now - m.lastUpdate;
  if (elapsed <= 0n || borrowRate === 0n) return m;
  const interest = wMulDown(m.totalBorrowAssets, wTaylorCompounded(borrowRate, elapsed));
  let feeShares = 0n;
  if (m.fee !== 0n) {
    const feeAmount = wMulDown(interest, m.fee);
    feeShares = toSharesDown(feeAmount, m.totalSupplyAssets + interest - feeAmount, m.totalSupplyShares);
  }
  return {
    ...m,
    totalBorrowAssets: m.totalBorrowAssets + interest,
    totalSupplyAssets: m.totalSupplyAssets + interest,
    totalSupplyShares: m.totalSupplyShares + feeShares,
    lastUpdate: now,
  };
}

/** Borrow assets owed by a position (rounded UP, as Morpho does in _isHealthy and repay-by-shares). */
export function borrowAssetsOf(borrowShares: bigint, m: MorphoMarketState): bigint {
  return toAssetsUp(borrowShares, m.totalBorrowAssets, m.totalBorrowShares);
}

export const SECONDS_PER_YEAR = 31_536_000n;
