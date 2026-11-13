/** Portfolio aggregation — debt-weighted, never an average of ratios. */
import type { Address } from "viem";
import type { PortfolioSummary, Position, RiskLevel } from "@/lib/risk/types";
import { RISK_ORDER } from "@/lib/risk/types";
import { ratio, WAD } from "@/lib/risk/math";
import { assess, riskScore, worse, type ThresholdsInput } from "@/lib/risk/classify";

export function summarize(owner: Address, ps: Position[], t?: ThresholdsInput): PortfolioSummary {
  const active = ps.filter((p) => p.status === "active");
  let totalCollateralUsd = 0n;
  let totalDebtUsd = 0n;
  let debtAtRiskUsd = 0n;
  let weightedScore = 0n;
  let level: RiskLevel = "healthy";
  let stale = false;
  const debtByAsset: Record<string, bigint> = {};
  let worst: { id: string; level: RiskLevel; m: bigint } | undefined;

  for (const p of active) {
    const a = assess(p, t);
    const s = riskScore(a, p);
    totalCollateralUsd += p.collateralValueUsd;
    totalDebtUsd += p.debtValueUsd;
    debtByAsset[p.debtAsset.symbol] = (debtByAsset[p.debtAsset.symbol] ?? 0n) + p.debtAmount;
    weightedScore += BigInt(s) * p.debtValueUsd;
    level = worse(level, a.level);
    stale ||= a.stale;
    if (RISK_ORDER[a.level] >= RISK_ORDER.high) debtAtRiskUsd += p.debtValueUsd;
    if (p.debtAmount > 0n) {
      const m = p.liquidationRatio > 0n ? (p.collateralRatio * WAD) / p.liquidationRatio : 0n;
      if (!worst || RISK_ORDER[a.level] > RISK_ORDER[worst.level] || (a.level === worst.level && m < worst.m)) {
        worst = { id: p.positionId, level: a.level, m };
      }
    }
  }

  return {
    owner,
    positions: active.length,
    totalCollateralUsd,
    totalDebtUsd,
    debtByAsset,
    aggregateRatio: ratio(totalCollateralUsd, totalDebtUsd),
    riskScore: totalDebtUsd > 0n ? Number((weightedScore + totalDebtUsd / 2n) / totalDebtUsd) : 0,
    level,
    highestRiskPositionId: worst?.id,
    debtAtRiskUsd,
    concentration: active.map((p) => ({
      positionId: p.positionId,
      protocol: p.protocol,
      collateralShare: totalCollateralUsd > 0n ? (p.collateralValueUsd * WAD) / totalCollateralUsd : 0n,
      debtShare: totalDebtUsd > 0n ? (p.debtValueUsd * WAD) / totalDebtUsd : 0n,
    })),
    stale,
  };
}
