/**
 * Repayment + collateral calculators. All amounts are estimates at the position's current price.
 *
 *   targetRatio (default) = liquidationRatio × DEFAULT_TARGET_MULTIPLIER (1.6)
 *   Target debt     = CollValue / TargetRatio          (CollValue in debt-token units, floor)
 *   Repay           = max(0, debt − targetDebt)
 *   Add collateral  = max(0, ceil(debt × TargetRatio / price) − coll)   (rounded UP to the collateral's last unit)
 *
 * Trove rules (BorrowerOperations.adjustTrove / closeTrove):
 *   repay ≤ debt − gasComp                      (_requireValidMUSDRepayment)
 *   (debt − gasComp) − repay ≥ minNetDebt       (_requireAtLeastMinNetDebt)
 *   ⇒ maxRepay = max(0, debt − gasComp − minNetDebt); closing costs debt − gasComp.
 * If reaching the target needs more than maxRepay, repayAmount is capped at maxRepay, repayFeasible=false and the note
 * suggests closing the Trove or adding collateral.
 */
import type { Position, Recommendation } from "@/lib/risk/types";
import { ORACLE_PRICE_SCALE, WAD, clamp0, divUp, mulDivUp, pow10 } from "@/lib/risk/math";
import { collateralInDebtUnits, isMorpho, isTrove, protocolPrice, ratioAt } from "@/lib/risk/valuation";
import { fmtUnits } from "@/lib/format";

export const DEFAULT_TARGET_MULTIPLIER = 1_600_000_000_000_000_000n;

export function defaultTargetRatio(p: Position): bigint {
  return (p.liquidationRatio * DEFAULT_TARGET_MULTIPLIER) / WAD;
}

/** Trove: debt − gasComp − minNetDebt, ≥ 0. Morpho: full debt. */
export function maxRepayFor(p: Position): bigint {
  if (isTrove(p)) return clamp0(p.debtAmount - p.params.gasCompensation - p.params.minNetDebt);
  return p.debtAmount;
}

/** Trove: debt − gasComp (gas compensation is burned from the gas pool). Morpho: full debt. */
export function closeCostFor(p: Position): bigint {
  if (isTrove(p)) return clamp0(p.debtAmount - p.params.gasCompensation);
  return p.debtAmount;
}

/** Debt-token amount to repay so that CR ≥ target at `priceUsd`. Never negative. */
export function repayToTarget(p: Position, target: bigint, priceUsd: bigint = p.price.usd): bigint {
  if (target === 0n) return 0n;
  const value = collateralInDebtUnits(p, p.collateralAmount, priceUsd);
  const targetDebt = (value * WAD) / target;
  return clamp0(p.debtAmount - targetDebt);
}

/** Collateral (native units, rounded up) to add so that CR ≥ target at `priceUsd`. Never negative. */
export function collateralToTarget(p: Position, target: bigint, priceUsd: bigint = p.price.usd): bigint {
  if (p.debtAmount === 0n || priceUsd === 0n) return 0n;
  let needed: bigint;
  if (isMorpho(p)) {
    // CR = floor(floor(coll × oracle / 1e36) × 1e18 / debt) ≥ target
    //   ⇔ floor(coll × oracle / 1e36) ≥ ceil(debt × target / 1e18) =: V
    //   ⇔ coll ≥ ceil(V × 1e36 / oracle)                       (exact inversion of Morpho's floor math)
    const oracle = protocolPrice(p, priceUsd);
    if (oracle === 0n) return 0n;
    const v = mulDivUp(p.debtAmount, target, WAD);
    needed = mulDivUp(v, ORACLE_PRICE_SCALE, oracle);
  } else {
    // CR = floor(coll × price / debt) ≥ target ⇔ coll × price ≥ debt × target (18-dec MUSD & BTC; generic decimals)
    needed = divUp(p.debtAmount * target * pow10(p.collateralAsset.decimals), priceUsd * pow10(p.debtAsset.decimals));
  }
  const add = clamp0(needed - p.collateralAmount);
  return add;
}

export function recommend(p: Position, targetRatio?: bigint): Recommendation {
  const target = targetRatio ?? defaultTargetRatio(p);
  const base: Recommendation = {
    positionId: p.positionId,
    targetRatio: target,
    repayAmount: 0n,
    repayFeasible: true,
    addCollateral: 0n,
    resultingRatioAfterRepay: p.collateralRatio,
    resultingRatioAfterAdd: p.collateralRatio,
    kind: "estimate",
  };
  if (p.status !== "active" || p.debtAmount === 0n) return base;

  const price = p.price.usd;
  const needRepay = repayToTarget(p, target, price);
  const add = collateralToTarget(p, target, price);
  let repay = needRepay;
  let feasible = true;
  let note: string | undefined;

  if (isTrove(p) && needRepay > 0n) {
    const cap = maxRepayFor(p);
    if (needRepay > cap) {
      repay = cap;
      feasible = false;
      const sym = p.debtAsset.symbol;
      const d = p.debtAsset.decimals;
      note =
        `Reaching the target needs ${fmtUnits(needRepay, d, 2)} ${sym}, but net debt can't go below the ` +
        `${fmtUnits(p.params.minNetDebt, d, 0)} ${sym} minimum, so at most ${fmtUnits(cap, d, 2)} ${sym} can be repaid. ` +
        `Close the Trove (${fmtUnits(closeCostFor(p), d, 2)} ${sym}) or add collateral instead.`;
    }
  }

  return {
    ...base,
    repayAmount: repay,
    repayFeasible: feasible,
    repayNote: note,
    addCollateral: add,
    resultingRatioAfterRepay: ratioAt(p, p.collateralAmount, p.debtAmount - repay, price),
    resultingRatioAfterAdd: ratioAt(p, p.collateralAmount + add, p.debtAmount, price),
  };
}
