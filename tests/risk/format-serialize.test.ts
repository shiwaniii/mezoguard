import { describe, expect, it } from "vitest";
import { fmtPct, fmtRatio, fmtUnits, fmtUsd, parseUnitsSafe } from "@/lib/format";
import {
  INFINITE_RATIO, analyzeRedemption, assess, classifyRedemption, fromWireAssessment, fromWirePosition,
  fromWireRecommendation, fromWireScenario, fromWireSummary, recommend, simulate, summarize, toWire,
} from "@/lib/risk";
import { ratioAt } from "@/lib/risk/valuation";
import type { Address } from "viem";
import { E18, OWNER, e18, morpho, pct, stubAdapter, trove, usd } from "./fixtures";

describe("format", () => {
  it("fmtUnits", () => {
    expect(fmtUnits(1234567890000000000000n, 18)).toBe("1,234.5679");
    expect(fmtUnits(70927700000000000n, 18, 6)).toBe("0.070928");
    expect(fmtUnits(100_000_008n, 6, 2)).toBe("100");
    expect(fmtUnits(100_005_000n, 6, 2)).toBe("100.01"); // half-up
    expect(fmtUnits(-1_500_000n, 6)).toBe("-1.5");
    expect(fmtUnits(0n, 18)).toBe("0");
  });
  it("fmtUsd / fmtRatio / fmtPct", () => {
    expect(fmtUsd(usd("74123.456"))).toBe("$74,123.46");
    expect(fmtUsd(0n)).toBe("$0.00");
    expect(fmtUsd(-usd(5))).toBe("-$5.00");
    expect(fmtRatio(1856197717780521340n)).toBe("185.6%");
    expect(fmtRatio(pct(110))).toBe("110.0%");
    expect(fmtRatio(INFINITE_RATIO)).toBe("∞");
    expect(fmtPct(e18("0.1234"))).toBe("12.34%");
    expect(fmtPct(e18("0.0075"))).toBe("0.75%");
  });
  it("parseUnitsSafe", () => {
    expect(parseUnitsSafe("1,234.5", 6)).toBe(1_234_500_000n);
    expect(parseUnitsSafe(".5", 18)).toBe(5n * 10n ** 17n);
    expect(parseUnitsSafe("1.", 18)).toBe(E18);
    expect(parseUnitsSafe("1.0000001", 6)).toBeNull();
    expect(parseUnitsSafe("-1", 18)).toBeNull();
    expect(parseUnitsSafe("1e5", 18)).toBeNull();
    expect(parseUnitsSafe("", 18)).toBeNull();
    expect(parseUnitsSafe("abc", 18)).toBeNull();
  });
});

describe("serialize round-trip", () => {
  const tr = trove(e18(1), e18(40_000), usd(100_000), {
    redemption: { queuePosition: 3, queueSize: 344, debtAhead: e18(5), debtAheadShare: e18("0.01"), exposure: "high" },
    debtPrincipal: e18(39_000), debtInterest: e18(1_000), maxBorrowingCapacity: e18(60_000), interestRateBps: 100,
  });
  const mo = morpho(e18("0.5"), 30_000n * 10n ** 6n, usd(100_000));
  it("positions survive JSON", () => {
    for (const p of [tr, mo]) {
      const w = JSON.parse(JSON.stringify(toWire(p)));
      expect(typeof w.debtAmount).toBe("string");
      expect(fromWirePosition(w)).toEqual(p);
    }
  });
  it("assessment / recommendation / summary / scenario survive JSON", () => {
    const rt = <T,>(x: T) => JSON.parse(JSON.stringify(toWire(x)));
    const a = assess(tr);
    expect(fromWireAssessment(rt(a))).toEqual(a);
    const r = recommend(trove(e18("0.05"), e18(2_200), usd(50_000)));
    expect(fromWireRecommendation(rt(r))).toEqual(r);
    const s = summarize(OWNER, [tr, mo]);
    expect(fromWireSummary(rt(s))).toEqual(s);
    const sc = simulate(tr, usd(50_000), stubAdapter("mezo-musd-trove"));
    expect(fromWireScenario(rt(sc))).toEqual(sc);
  });
  it("rejects non-integer strings", () => {
    const w = JSON.parse(JSON.stringify(toWire(tr)));
    w.debtAmount = "1.5";
    expect(() => fromWirePosition(w)).toThrow();
  });
});

describe("collateral calculator minimality", () => {
  it.each([
    [trove(e18("0.7"), e18(33_333), usd(61_234))],
    [morpho(e18("0.3"), 19_999_999_999n, usd(91_111), 6)],
    [morpho(e18("0.3"), 19_999_999_999n * 10n ** 12n + 7n, usd(91_111), 18)],
  ])("adding the result reaches target, one unit less does not (%#)", (p) => {
    const r = recommend(p);
    expect(r.addCollateral).toBeGreaterThan(0n);
    expect(ratioAt(p, p.collateralAmount + r.addCollateral, p.debtAmount, p.price.usd)).toBeGreaterThanOrEqual(r.targetRatio);
    expect(ratioAt(p, p.collateralAmount + r.addCollateral - 1n, p.debtAmount, p.price.usd)).toBeLessThan(r.targetRatio);
  });
});

describe("redemption analyzer", () => {
  const a = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address;
  const mcr = pct(110);
  const entries = [
    { owner: a(1), nicr: 100n, icr: pct(105), debt: e18(1_000) }, // below MCR → skipped by redemptions
    { owner: a(2), nicr: 200n, icr: pct(130), debt: e18(2_000) },
    { owner: a(3), nicr: 300n, icr: pct(160), debt: e18(3_000) },
    { owner: a(4), nicr: 400n, icr: pct(250), debt: e18(94_000) },
  ];
  it("sums debt ahead with ICR ≥ MCR only, in NICR order", () => {
    const r = analyzeRedemption([...entries].reverse(), a(4), mcr, e18(100_000))!;
    expect(r.queuePosition).toBe(4);
    expect(r.queueSize).toBe(4);
    expect(r.debtAhead).toBe(e18(5_000));
    expect(r.debtAheadShare).toBe(e18("0.05"));
    expect(r.exposure).toBe("moderate"); // exactly 5% is not < 5%
    expect(analyzeRedemption(entries, a(2), mcr, e18(100_000))!.exposure).toBe("high");
    expect(analyzeRedemption(entries, a(9), mcr, e18(100_000))).toBeUndefined();
  });
  it("thresholds", () => {
    expect(classifyRedemption(e18("0.0499"))).toBe("high");
    expect(classifyRedemption(e18("0.1999"))).toBe("moderate");
    expect(classifyRedemption(e18("0.2"))).toBe("low");
  });
  it("feeds the assessment reasons and score", () => {
    const tr = trove(e18(1), e18(40_000), usd(100_000), {
      redemption: { queuePosition: 1, queueSize: 344, debtAhead: 0n, debtAheadShare: 0n, exposure: "high" },
    });
    expect(assess(tr).reasons.join(" ")).toMatch(/Redemption exposure high/);
  });
});
