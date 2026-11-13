/**
 * Liquidation price + the protocol's own liquidation condition.
 *
 * Trove:  liqPrice = ceil(debt × MCR / coll)                         (USD per BTC, 1e18; debt & coll 18 dec)
 * Morpho: oracle threshold p* = debt × 1e36 × 1e18 / (coll × lltv)  (the oracle price at which borrow == maxBorrow)
 *         liqPriceUsd = ceil(debt × 10^collDec × 1e36 / (10^loanDec × coll × lltv))   (loan asset = $1)
 *
 * Both are estimates in the sense that the debt keeps accruing interest and Morpho floors intermediate products;
 * rounding is UP so the displayed liquidation price is never optimistic.
 */
import type { Position } from "@/lib/risk/types";
import { WAD, mulDivUp, pow10 } from "@/lib/risk/math";
import { isMorpho, isTrove, morphoMaxBorrow } from "@/lib/risk/valuation";

export function liquidationPrice(p: Position): bigint {
  if (p.debtAmount === 0n || p.collateralAmount === 0n) return 0n;
  if (isMorpho(p)) {
    const { lltv } = p.params;
    if (lltv === 0n) return 0n;
    const num = p.debtAmount * pow10(p.collateralAsset.decimals) * WAD * WAD;
    const den = pow10(p.debtAsset.decimals) * p.collateralAmount * lltv;
    return mulDivUp(num, 1n, den);
  }
  // Trove: debt (18) × MCR (1e18) / coll (18) → USD 1e18. Generic decimals for safety.
  const num = p.debtAmount * p.liquidationRatio * pow10(p.collateralAsset.decimals);
  const den = p.collateralAmount * pow10(p.debtAsset.decimals);
  return mulDivUp(num, 1n, den);
}

/** True only when the protocol itself would allow liquidation right now. */
export function isLiquidatable(p: Position): boolean {
  if (p.status !== "active" || p.debtAmount === 0n) return false;
  if (isMorpho(p)) {
    return p.debtAmount > morphoMaxBorrow(p.collateralAmount, p.params.oraclePrice, p.params.lltv);
  }
  if (isTrove(p)) {
    // Mezo MUSD liquidates only ICR < MCR (no Recovery-Mode CCR liquidations in TroveManager.liquidate).
    return p.collateralRatio < p.params.mcr;
  }
  return p.collateralRatio < p.liquidationRatio;
}
