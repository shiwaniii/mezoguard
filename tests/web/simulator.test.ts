import { describe, expect, it } from "vitest";
import { simulatePortfolio, simSummary } from "@/lib/wallet/simulate";
import { scaledCollateralPrice } from "@/lib/wallet/reprice";
import { BTC_PRICE, MORPHO_BTC_PRICE, morpho, trove } from "./fixtures";

const WAD = 10n ** 18n;

describe("simulator recompute", () => {
  const t = trove();
  const m = morpho();

  it("at the current price every ratio equals the live one", () => {
    const rows = simulatePortfolio([t, m], BTC_PRICE, BTC_PRICE);
    expect(rows[0].result.collateralRatio).toBe(t.collateralRatio);
    // Morpho ratio recomputed from its own oracle at the unchanged price matches within 1 wei of precision
    const diff = rows[1].result.collateralRatio - m.collateralRatio;
    expect(diff < 10n && diff > -10n).toBe(true);
  });

  it("a 50% BTC drop halves both ratios and makes the Trove liquidatable", () => {
    const half = BTC_PRICE / 2n;
    const rows = simulatePortfolio([t, m], half, BTC_PRICE);
    expect(rows[0].result.collateralRatio).toBe((t.collateralAmount * half) / t.debtAmount);
    expect(rows[0].result.level).toBe("liquidatable");
    // Morpho oracle scaled by the same percentage, not set to the Mezo price
    expect(rows[1].priceUsd).toBe(MORPHO_BTC_PRICE / 2n);
    const ratioDiff = rows[1].result.collateralRatio * 2n - m.collateralRatio;
    expect(ratioDiff < 10n && ratioDiff > -10n).toBe(true);
    expect(simSummary(rows).liquidatable).toBeGreaterThanOrEqual(1);
  });

  it("recomputes recommendations: a big drop needs a repay, a rise needs none", () => {
    const down = simulatePortfolio([t], (BTC_PRICE * 7n) / 10n, BTC_PRICE)[0];
    expect(down.result.repayToTarget).toBeGreaterThan(0n);
    expect(down.result.addCollToTarget).toBeGreaterThan(0n);
    const up = simulatePortfolio([t], BTC_PRICE * 2n, BTC_PRICE)[0];
    expect(up.result.repayToTarget).toBe(0n);
    expect(up.result.level).toBe("healthy");
  });

  it("maps a Morpho liquidation price back to BTC-price terms", () => {
    const row = simulatePortfolio([m], BTC_PRICE, BTC_PRICE)[0];
    expect(row.liquidationBtcUsd).toBe((m.liquidationPriceUsd * BTC_PRICE) / MORPHO_BTC_PRICE);
  });

  it("leaves non-BTC collateral unchanged", () => {
    const musdColl = { ...m, collateralAsset: { ...m.collateralAsset, symbol: "MUSD" } };
    expect(scaledCollateralPrice(musdColl, 1n * WAD, BTC_PRICE)).toBe(musdColl.price.usd);
  });
});
