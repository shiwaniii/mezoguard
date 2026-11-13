/** Portfolio-wide what-if at one BTC price (pure; tested). */
import { simulate } from "@/lib/risk";
import { RISK_ORDER, type Position, type ScenarioResult } from "@/lib/risk/types";
import { clientAdapters, scaledCollateralPrice, tracksBtc } from "./reprice";

export interface SimRow {
  position: Position;
  /** Collateral price used for this position (its own oracle, scaled). */
  priceUsd: bigint;
  result: ScenarioResult;
  /** BTC price at which this position liquidates, in BTC-price terms (Morpho oracle mapped back). 0 if n/a. */
  liquidationBtcUsd: bigint;
}

export function simulatePortfolio(positions: Position[], simulatedBtcUsd: bigint, currentBtcUsd: bigint, targetRatio?: (p: Position) => bigint | undefined): SimRow[] {
  return positions.map((p) => {
    const priceUsd = scaledCollateralPrice(p, simulatedBtcUsd, currentBtcUsd);
    const result = simulate(p, priceUsd, clientAdapters[p.protocol], undefined, targetRatio?.(p));
    const liquidationBtcUsd = p.price.usd > 0n && tracksBtc(p) ? (p.liquidationPriceUsd * currentBtcUsd) / p.price.usd : 0n;
    return { position: p, priceUsd, result, liquidationBtcUsd };
  });
}

export function simSummary(rows: SimRow[]) {
  let liquidatable = 0;
  let atRisk = 0;
  let debtAtRiskUsd = 0n;
  for (const r of rows) {
    if (r.result.level === "liquidatable") liquidatable++;
    if (RISK_ORDER[r.result.level] >= RISK_ORDER.high) {
      atRisk++;
      debtAtRiskUsd += r.position.debtValueUsd;
    }
  }
  return { liquidatable, atRisk, debtAtRiskUsd };
}
