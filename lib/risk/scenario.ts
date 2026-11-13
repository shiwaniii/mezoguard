/** Scenario engine: re-price a position at a hypothetical collateral USD price using the adapter's protocol math. */
import type { Position, ProtocolAdapter, ScenarioResult } from "@/lib/risk/types";
import { assess, priceDeclineBuffer, type ThresholdsInput } from "@/lib/risk/classify";
import { collateralToTarget, defaultTargetRatio, repayToTarget } from "@/lib/risk/recommend";
import { withPrice } from "@/lib/risk/valuation";

export function simulate(
  p: Position,
  priceUsd: bigint,
  adapter: ProtocolAdapter,
  t?: ThresholdsInput,
  targetRatio?: bigint,
): ScenarioResult {
  const r = adapter.reprice(p, priceUsd);
  // Hypothetical prices are by definition not stale.
  const q: Position = { ...withPrice(p, priceUsd), ...r, price: { ...p.price, usd: priceUsd, stale: false, staleReason: undefined } };
  const a = assess(q, t);
  const target = targetRatio ?? defaultTargetRatio(p);
  const active = p.status === "active";
  return {
    positionId: p.positionId,
    priceUsd,
    collateralValueUsd: r.collateralValueUsd,
    collateralRatio: r.collateralRatio,
    level: a.level,
    priceDeclineBuffer: priceDeclineBuffer(priceUsd, p.liquidationPriceUsd),
    repayToTarget: active ? repayToTarget(q, target, priceUsd) : 0n,
    addCollToTarget: active ? collateralToTarget(q, target, priceUsd) : 0n,
  };
}

/** `steps + 1` evenly spaced points from `fromUsd` to `toUsd` inclusive. */
export function crCurve(
  p: Position,
  adapter: ProtocolAdapter,
  fromUsd: bigint,
  toUsd: bigint,
  steps: number,
): { priceUsd: bigint; ratio: bigint }[] {
  const n = Math.max(1, Math.floor(steps));
  const out: { priceUsd: bigint; ratio: bigint }[] = [];
  const span = toUsd - fromUsd;
  for (let i = 0; i <= n; i++) {
    const priceUsd = fromUsd + (span * BigInt(i)) / BigInt(n);
    out.push({ priceUsd, ratio: adapter.reprice(p, priceUsd).collateralRatio });
  }
  return out;
}
