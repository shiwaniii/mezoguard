/**
 * Risk classification. Levels are thresholds on collateralRatio expressed as MULTIPLES of the protocol's own
 * liquidation ratio, so the same thresholds work for a 110% Trove MCR and a 1/0.77 ≈ 129.9% Morpho market:
 *
 *   liquidatable  ⇔ protocol condition (Trove ICR < MCR; Morpho borrow > maxBorrow)
 *   critical      CR < liqRatio × critical (1.10)
 *   high          CR < liqRatio × high     (1.30)
 *   watch         CR < liqRatio × watch    (1.60)
 *   healthy       otherwise
 *
 * Because CR is linear in price, the price at which CR == liqRatio × m is liqPrice × m.
 */
import type { Position, ProtocolId, RiskAssessment, RiskLevel, RiskThresholds } from "@/lib/risk/types";
import { RISK_ORDER } from "@/lib/risk/types";
import { INFINITE_RATIO, WAD, mulDivUp } from "@/lib/risk/math";
import { isLiquidatable, liquidationPrice } from "@/lib/risk/liquidation";
import { isMorpho, isTrove } from "@/lib/risk/valuation";
import { fmtPct, fmtRatio, fmtUsd } from "@/lib/format";

export const DEFAULT_THRESHOLDS: RiskThresholds = {
  watch: 1_600_000_000_000_000_000n,
  high: 1_300_000_000_000_000_000n,
  critical: 1_100_000_000_000_000_000n,
};

/** Per-protocol override map. Any API taking `RiskThresholds` also accepts this. */
export type ThresholdsByProtocol = Partial<Record<ProtocolId, RiskThresholds>> & { default?: RiskThresholds };
export type ThresholdsInput = RiskThresholds | ThresholdsByProtocol;

function isFlat(t: ThresholdsInput): t is RiskThresholds {
  return typeof (t as RiskThresholds).watch === "bigint";
}

export function thresholdsFor(protocol: ProtocolId, t?: ThresholdsInput): RiskThresholds {
  if (!t) return DEFAULT_THRESHOLDS;
  if (isFlat(t)) return t;
  return t[protocol] ?? t.default ?? DEFAULT_THRESHOLDS;
}

export function validateThresholds(t: RiskThresholds): void {
  if (!(t.watch >= t.high && t.high >= t.critical && t.critical >= WAD)) {
    throw new Error("thresholds must satisfy watch ≥ high ≥ critical ≥ 1.0");
  }
}

/** Level from CR alone (no protocol liquidation check). */
export function levelForRatio(cr: bigint, liqRatio: bigint, t: RiskThresholds): Exclude<RiskLevel, "liquidatable"> {
  const at = (m: bigint) => (liqRatio * m) / WAD;
  if (cr < at(t.critical)) return "critical";
  if (cr < at(t.high)) return "high";
  if (cr < at(t.watch)) return "watch";
  return "healthy";
}

const NEXT: Record<RiskLevel, RiskLevel | undefined> = {
  healthy: "watch",
  watch: "high",
  high: "critical",
  critical: "liquidatable",
  liquidatable: undefined,
};

function multiplierFor(level: RiskLevel, t: RiskThresholds): bigint {
  switch (level) {
    case "watch":
      return t.watch;
    case "high":
      return t.high;
    case "critical":
      return t.critical;
    default:
      return WAD;
  }
}

export function priceDeclineBuffer(priceUsd: bigint, liqPriceUsd: bigint): bigint {
  if (priceUsd === 0n || priceUsd <= liqPriceUsd) return 0n;
  return ((priceUsd - liqPriceUsd) * WAD) / priceUsd;
}

export function assess(p: Position, tIn?: ThresholdsInput): RiskAssessment {
  const t = thresholdsFor(p.protocol, tIn);
  const reasons: string[] = [];
  const stale = p.price.stale;

  if (p.status !== "active") {
    return {
      positionId: p.positionId, level: "healthy", safetyMargin: 0n, priceDeclineBuffer: 0n,
      stale, reasons: [`Position is ${p.status}; no open debt.`],
    };
  }
  if (p.debtAmount === 0n) {
    return {
      positionId: p.positionId, level: "healthy", safetyMargin: INFINITE_RATIO, priceDeclineBuffer: WAD,
      stale, reasons: ["No debt outstanding; collateral cannot be liquidated."],
    };
  }

  const liqPrice = p.liquidationPriceUsd > 0n ? p.liquidationPriceUsd : liquidationPrice(p);
  const level: RiskLevel = isLiquidatable(p) ? "liquidatable" : levelForRatio(p.collateralRatio, p.liquidationRatio, t);
  const nextLevel = NEXT[level];
  // The CR of a position flagged liquidatable by the protocol may still sit above the band boundary due to Morpho floor math;
  // nextLevelPrice is the price at which the next band starts.
  const nextLevelPriceUsd = nextLevel ? mulDivUp(liqPrice, multiplierFor(nextLevel, t), WAD) : undefined;

  const watchAt = (p.liquidationRatio * t.watch) / WAD;
  reasons.push(
    `Collateral ratio ${fmtRatio(p.collateralRatio)} vs liquidation at ${fmtRatio(p.liquidationRatio)} ` +
      `(watch below ${fmtRatio(watchAt)}).`,
  );
  if (level === "liquidatable") {
    reasons.push(
      isTrove(p)
        ? "ICR is below the Minimum Collateral Ratio: the Trove can be liquidated now."
        : "Borrowed amount exceeds the market's max borrow (collateral × oracle price × LLTV): liquidatable now.",
    );
  } else {
    reasons.push(
      `Liquidation at ${fmtUsd(liqPrice)} per ${p.collateralAsset.symbol}; price can fall ` +
        `${fmtPct(priceDeclineBuffer(p.price.usd, liqPrice))} before that.`,
    );
  }
  if (isMorpho(p)) {
    reasons.push(`Uses the Morpho market oracle (${fmtUsd(p.price.usd)}), which is what Morpho liquidations use; loan asset valued at $1.`);
  }
  if (isTrove(p)) {
    if (p.params.recoveryMode) {
      reasons.push(`System is in Recovery Mode (TCR ${fmtRatio(p.params.tcr)} < CCR ${fmtRatio(p.params.ccr)}).`);
    }
    if (p.redemption && p.redemption.exposure !== "low") {
      reasons.push(
        `Redemption exposure ${p.redemption.exposure}: ${fmtPct(p.redemption.debtAheadShare)} of system debt is ahead of this Trove.`,
      );
    }
  }
  if (stale) {
    reasons.push(
      `Price is stale${p.price.staleReason ? ` (${p.price.staleReason})` : ""}: level is computed from the last known price and is unverified.`,
    );
  }

  return {
    positionId: p.positionId,
    level,
    safetyMargin: p.collateralRatio - p.liquidationRatio,
    priceDeclineBuffer: priceDeclineBuffer(p.price.usd, liqPrice),
    nextLevelPriceUsd,
    nextLevel,
    stale,
    reasons,
  };
}

/**
 * 0..100 integer. Linear in m = CR / liquidationRatio: m ≥ 2.0 → 0, m = 1.0 → 100 (so 1.6 → 40, 1.3 → 70, 1.1 → 90).
 * Adders (capped at 99 unless liquidatable): Trove Recovery Mode +5, redemption exposure moderate +3 / high +8.
 * Liquidatable → 100.
 */
export function riskScore(a: RiskAssessment, p: Position): number {
  if (a.level === "liquidatable") return 100;
  if (p.status !== "active" || p.debtAmount === 0n) return 0;
  if (p.liquidationRatio === 0n) return 0;
  const m = (p.collateralRatio * WAD) / p.liquidationRatio; // 1e18
  let s = m >= 2n * WAD ? 0n : ((2n * WAD - m) * 100n + WAD / 2n) / WAD;
  if (s > 100n) s = 100n;
  if (isTrove(p)) {
    if (p.params.recoveryMode) s += 5n;
    if (p.redemption?.exposure === "moderate") s += 3n;
    if (p.redemption?.exposure === "high") s += 8n;
  }
  if (s > 99n) s = 99n;
  return Number(s);
}

export function worse(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RISK_ORDER[a] >= RISK_ORDER[b] ? a : b;
}
