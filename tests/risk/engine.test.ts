import { describe, expect, it } from "vitest";
import {
  DEFAULT_THRESHOLDS, DEFAULT_TARGET_MULTIPLIER, INFINITE_RATIO, assess, crCurve, liquidationPrice, recommend, riskScore,
  simulate, summarize,
} from "@/lib/risk";
import { E18, OWNER, e18, morpho, pct, price, stubAdapter, trove, usd } from "./fixtures";

const T = stubAdapter("mezo-musd-trove");
const MB = stubAdapter("morpho-blue");

describe("liquidation price", () => {
  it("1 BTC, 40,000 MUSD debt, $100k, MCR 110% ⇒ $44,000", () => {
    const p = trove(e18(1), e18(40_000), usd(100_000));
    expect(liquidationPrice(p)).toBe(usd(44_000));
    expect(p.collateralRatio).toBe(pct(250));
  });
  it("Trove rounds UP (never optimistic)", () => {
    const p = trove(3n, e18(1), usd(1)); // 1e18 × 1.1e18 / 3 = 366666…6.67 → …7
    expect(liquidationPrice(p)).toBe(366666666666666666666666666666666667n);
  });
  it("Morpho: 1 BTC, 50,000 mUSDC, LLTV 77% ⇒ ceil(50,000/0.77) USD", () => {
    const p = morpho(e18(1), 50_000n * 10n ** 6n, usd(100_000));
    expect(liquidationPrice(p)).toBe(64935064935064935064936n);
    expect(p.liquidationRatio).toBe(1298701298701298702n); // ceil(1/0.77)
  });
  it("zero debt ⇒ 0 (no liquidation)", () => {
    expect(liquidationPrice(trove(e18(1), 0n, usd(100_000)))).toBe(0n);
  });
});

describe("risk levels (Trove, MCR 110%, thresholds ×1.6/1.3/1.1 ⇒ 176%/143%/121%)", () => {
  const at = (btcUsd: number) => assess(trove(e18(1), e18(40_000), usd(btcUsd)));
  it.each([
    [100_000, "healthy"], // 250%
    [70_400, "healthy"], // exactly 176% → not below
    [65_000, "watch"], // 162.5%
    [55_000, "high"], // 137.5%
    [46_000, "critical"], // 115%
    [44_000, "critical"], // exactly MCR → not liquidatable (ICR < MCR is the rule)
    [43_000, "liquidatable"], // 107.5%
  ])("$%i ⇒ %s", (px, lvl) => {
    expect(at(px).level).toBe(lvl);
  });
  it("buffer, margin, next level price", () => {
    const a = at(100_000);
    expect(a.safetyMargin).toBe(pct(250) - pct(110));
    expect(a.priceDeclineBuffer).toBe(e18("0.56")); // (100k − 44k)/100k
    expect(a.nextLevel).toBe("watch");
    expect(a.nextLevelPriceUsd).toBe(usd(70_400)); // 44,000 × 1.6
    expect(a.stale).toBe(false);
    const l = at(43_000);
    expect(l.nextLevel).toBeUndefined();
    expect(l.priceDeclineBuffer).toBe(0n);
  });
  it("Morpho liquidatable only when borrow > maxBorrow (exact boundary)", () => {
    // 1 BTC at oracle $100,000 (mUSDC 6 dec): maxBorrow = 100,000e6 × 0.77 = 77,000e6
    const ok = morpho(e18(1), 77_000n * 10n ** 6n, usd(100_000));
    const bad = morpho(e18(1), 77_000n * 10n ** 6n + 1n, usd(100_000));
    expect(assess(ok).level).toBe("critical");
    expect(assess(bad).level).toBe("liquidatable");
  });
  it("closed position and zero debt are healthy", () => {
    expect(assess(trove(0n, 0n, usd(1), { status: "closed" })).level).toBe("healthy");
    const z = assess(trove(e18(1), 0n, usd(100_000)));
    expect(z.level).toBe("healthy");
    expect(z.safetyMargin).toBe(INFINITE_RATIO);
  });
});

describe("price up / down scenarios", () => {
  const p = trove(e18(1), e18(40_000), usd(100_000));
  it("price down 50% ⇒ CR halves, level high", () => {
    const s = simulate(p, usd(50_000), T);
    expect(s.collateralRatio).toBe(pct(125));
    expect(s.collateralValueUsd).toBe(usd(50_000));
    expect(s.level).toBe("high");
    expect(s.priceDeclineBuffer).toBe(e18("0.12")); // (50k − 44k)/50k
    expect(s.repayToTarget).toBe(11590909090909090909091n);
    expect(s.addCollToTarget).toBe(e18("0.408"));
  });
  it("price up ⇒ healthy, no action", () => {
    const s = simulate(p, usd(150_000), T);
    expect(s.collateralRatio).toBe(pct(375));
    expect(s.level).toBe("healthy");
    expect(s.repayToTarget).toBe(0n);
    expect(s.addCollToTarget).toBe(0n);
  });
  it("Morpho scenario updates the oracle price used for liquidation", () => {
    const m = morpho(e18(1), 50_000n * 10n ** 6n, usd(100_000));
    expect(simulate(m, usd(64_935), MB).level).toBe("liquidatable");
    expect(simulate(m, usd(64_936), MB).level).toBe("critical");
  });
  it("crCurve is linear in price with steps+1 points", () => {
    const c = crCurve(p, T, usd(40_000), usd(120_000), 4);
    expect(c.map((x) => x.priceUsd)).toEqual([40, 60, 80, 100, 120].map((k) => usd(k * 1000)));
    expect(c.map((x) => x.ratio)).toEqual([100, 150, 200, 250, 300].map((k) => pct(k)));
  });
});

describe("recommendations", () => {
  it("default target = liquidationRatio × 1.6", () => {
    expect(DEFAULT_TARGET_MULTIPLIER).toBe(e18("1.6"));
    const r = recommend(trove(e18(1), e18(40_000), usd(50_000)));
    expect(r.targetRatio).toBe(pct(176));
    // Target debt = 50,000 / 1.76 = 28,409.090909…; repay = 40,000 − that
    expect(r.repayAmount).toBe(11590909090909090909091n);
    expect(r.repayFeasible).toBe(true);
    expect(r.resultingRatioAfterRepay).toBeGreaterThanOrEqual(pct(176));
    // coll needed = 40,000 × 1.76 / 50,000 = 1.408 BTC
    expect(r.addCollateral).toBe(e18("0.408"));
    expect(r.resultingRatioAfterAdd).toBe(pct(176));
    expect(r.kind).toBe("estimate");
  });
  it("collateral rounds UP to the last wei", () => {
    const r = recommend(trove(e18(1), e18(40_000), usd(30_000)), pct(200)); // need 80,000/30,000 = 2.666…
    expect(r.addCollateral).toBe(1666666666666666667n);
    expect(r.resultingRatioAfterAdd).toBeGreaterThanOrEqual(pct(200));
  });
  it("never negative when already above target", () => {
    const r = recommend(trove(e18(1), e18(10_000), usd(100_000)));
    expect(r.repayAmount).toBe(0n);
    expect(r.addCollateral).toBe(0n);
  });
  it("Trove min-net-debt edge: caps repay, infeasible, suggests close/add collateral", () => {
    // 0.05 BTC @ $50k = $2,500; debt 2,200 (net 2,000); min net 1,800 ⇒ max repay 200
    const p = trove(e18("0.05"), e18(2_200), usd(50_000));
    const r = recommend(p);
    expect(r.repayFeasible).toBe(false);
    expect(r.repayAmount).toBe(e18(200));
    expect(r.resultingRatioAfterRepay).toBe(pct(125)); // 2,500 / 2,000
    expect(r.repayNote).toMatch(/1,800 MUSD minimum/);
    expect(r.repayNote).toMatch(/Close the Trove \(2,000 MUSD\)/);
    expect(r.addCollateral).toBeGreaterThan(0n);
  });
  it("Trove already at min net debt ⇒ max repay 0", () => {
    const r = recommend(trove(e18("0.04"), e18(2_000), usd(50_000)));
    expect(r.repayAmount).toBe(0n);
    expect(r.repayFeasible).toBe(false);
  });
  it("Morpho repay in 6-dec units, no min debt", () => {
    // 1 BTC @ $100k, 70,000 mUSDC; target = (1/0.77)×1.6 ⇒ target debt = 100,000 / 2.0779… = 48,124.99…
    const m = morpho(e18(1), 70_000n * 10n ** 6n, usd(100_000));
    const r = recommend(m);
    expect(r.repayFeasible).toBe(true);
    const targetRatio = (1298701298701298702n * 16n) / 10n;
    expect(r.targetRatio).toBe(targetRatio);
    const targetDebt = (100_000n * 10n ** 6n * E18) / targetRatio;
    expect(r.repayAmount).toBe(70_000n * 10n ** 6n - targetDebt);
    expect(r.resultingRatioAfterRepay).toBeGreaterThanOrEqual(targetRatio);
    expect(r.resultingRatioAfterAdd).toBeGreaterThanOrEqual(targetRatio);
  });
});

describe("decimal scaling (6 vs 18)", () => {
  it("same economics in mUSDC (6) and MUSD (18) give identical CR, liq price, USD", () => {
    const a = morpho(e18("0.5"), 20_000n * 10n ** 6n, usd(80_000), 6);
    const b = morpho(e18("0.5"), 20_000n * E18, usd(80_000), 18);
    expect(a.collateralRatio).toBe(b.collateralRatio);
    expect(a.collateralRatio).toBe(pct(200));
    expect(a.liquidationPriceUsd).toBe(b.liquidationPriceUsd);
    expect(a.debtValueUsd).toBe(b.debtValueUsd);
    expect(assess(a).level).toBe(assess(b).level);
    // Morpho floors collateral value to loan-token units, so 6-dec rounds to 1 µUSDC (≈1.25e7 wei of BTC at $80k).
    const ra = recommend(a), rb = recommend(b);
    const diff = ra.addCollateral - rb.addCollateral;
    expect(diff >= 0n && diff <= 10n ** 8n).toBe(true);
    expect(ra.resultingRatioAfterAdd).toBeGreaterThanOrEqual(ra.targetRatio);
    expect(rb.resultingRatioAfterAdd).toBeGreaterThanOrEqual(rb.targetRatio);
  });
});

describe("stale oracle", () => {
  it("assessment.stale and reasons explain", () => {
    const p = trove(e18(1), e18(40_000), usd(100_000), {
      price: price(usd(100_000), { stale: true, source: "mezo-oracle-precompile", staleReason: "oracle last updated 95s ago" }),
    });
    const a = assess(p);
    expect(a.stale).toBe(true);
    expect(a.reasons.join(" ")).toMatch(/stale.*95s ago.*unverified/);
    expect(summarize(OWNER, [p]).stale).toBe(true);
  });
});

describe("thresholds", () => {
  it("same multipliers give protocol-specific boundaries", () => {
    // Trove watch < 176%; Morpho watch < 1.2987×1.6 = 207.8%. CR 190% is healthy on Trove, watch on Morpho.
    expect(assess(trove(e18(1), e18(40_000), usd(76_000))).level).toBe("healthy");
    expect(assess(morpho(e18(1), 40_000n * 10n ** 6n, usd(76_000))).level).toBe("watch");
  });
  it("per-protocol overrides", () => {
    const m = morpho(e18(1), 30_000n * 10n ** 6n, usd(50_000)); // CR 166.7%, m = 1.2833
    expect(assess(m).level).toBe("high");
    const t = { "morpho-blue": { watch: e18(2), high: e18("1.5"), critical: e18("1.3") } };
    expect(assess(m, t).level).toBe("critical");
    expect(assess(trove(e18(1), e18(40_000), usd(65_000)), t).level).toBe("watch"); // default for trove
    expect(DEFAULT_THRESHOLDS.watch).toBe(e18("1.6"));
  });
});

describe("portfolio", () => {
  const tr = trove(e18(1), e18(40_000), usd(100_000)); // $100k / $40k
  const mo = morpho(e18("0.5"), 30_000n * 10n ** 6n, usd(100_000)); // $50k / $30k, CR 166.7%
  const s = summarize(OWNER, [tr, mo]);
  it("debt-weighted aggregate, not averaged ratios", () => {
    expect(s.totalCollateralUsd).toBe(usd(150_000));
    expect(s.totalDebtUsd).toBe(usd(70_000));
    expect(s.aggregateRatio).toBe((usd(150_000) * E18) / usd(70_000)); // 214.29%, avg of ratios would be 208.3%
    expect(s.debtByAsset).toEqual({ MUSD: e18(40_000), mUSDC: 30_000n * 10n ** 6n });
  });
  it("worst level, highest-risk position, debt at risk", () => {
    expect(s.level).toBe("high");
    expect(s.highestRiskPositionId).toBe(mo.positionId);
    expect(s.debtAtRiskUsd).toBe(usd(30_000));
    expect(s.positions).toBe(2);
  });
  it("debt-weighted risk score", () => {
    expect(riskScore(assess(tr), tr)).toBe(0);
    expect(riskScore(assess(mo), mo)).toBe(72); // (2 − 1.2833) × 100
    expect(s.riskScore).toBe(31); // 72 × 30k / 70k = 30.86
  });
  it("concentration shares", () => {
    const c = s.concentration.find((x) => x.positionId === mo.positionId)!;
    expect(c.debtShare).toBe((usd(30_000) * E18) / usd(70_000));
    expect(c.collateralShare).toBe((usd(50_000) * E18) / usd(150_000));
  });
  it("empty portfolio", () => {
    const e = summarize(OWNER, []);
    expect(e.aggregateRatio).toBe(INFINITE_RATIO);
    expect(e.riskScore).toBe(0);
    expect(e.level).toBe("healthy");
  });
  it("risk score bounds", () => {
    const liq = trove(e18(1), e18(40_000), usd(43_000));
    expect(riskScore(assess(liq), liq)).toBe(100);
    const crit = trove(e18(1), e18(40_000), usd(44_000)); // m = 1.0 but not liquidatable
    expect(riskScore(assess(crit), crit)).toBe(99);
  });
});
