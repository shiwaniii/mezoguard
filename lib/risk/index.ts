/** MezoGuard risk engine — pure, bigint only, no I/O. See docs/RISK_ENGINE.md. */
export { DEFAULT_THRESHOLDS, assess, riskScore, levelForRatio, priceDeclineBuffer, thresholdsFor, validateThresholds } from "@/lib/risk/classify";
export type { ThresholdsByProtocol, ThresholdsInput } from "@/lib/risk/classify";
export { DEFAULT_TARGET_MULTIPLIER, recommend, defaultTargetRatio, repayToTarget, collateralToTarget, maxRepayFor, closeCostFor } from "@/lib/risk/recommend";
export { simulate, crCurve } from "@/lib/risk/scenario";
export { summarize } from "@/lib/risk/portfolio";
export { liquidationPrice, isLiquidatable } from "@/lib/risk/liquidation";
export { analyzeRedemption, classifyRedemption, REDEMPTION_THRESHOLDS } from "@/lib/risk/redemption";
export type { TroveQueueEntry } from "@/lib/risk/redemption";
export {
  repricePosition, withPrice, morphoOracleToUsd, usdToMorphoOracle, morphoMaxBorrow, morphoLiquidationRatio,
  morphoCollateralRatio, troveCollateralRatio, ratioAt,
} from "@/lib/risk/valuation";
export { INFINITE_RATIO, WAD } from "@/lib/risk/math";
export * from "@/lib/risk/serialize";
