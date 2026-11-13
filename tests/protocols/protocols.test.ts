import { describe, expect, it } from "vitest";
import { toEventSelector, type Address } from "viem";
import { LOG_RANGE_CAP, MORPHO, MORPHO_MARKETS, MUSD_PROTOCOL } from "@/lib/chain/config";
import { morphoAbi } from "@/lib/chain/abis";
import { addressTopic, chunkRange, mapLimit, topicToAddress } from "@/lib/protocols/client";
import {
  VIRTUAL_SHARES, accrueInterest, borrowAssetsOf, toAssetsDown, toAssetsUp, toSharesDown, toSharesUp, wTaylorCompounded,
} from "@/lib/protocols/morpho-math";
import { TOPIC, buildMorphoPosition, type MarketInfo } from "@/lib/protocols/morpho";
import { buildTrovePosition, closeCost, maxRepay, nominalICR, troveStatusFromCode, type RawTroveReads } from "@/lib/protocols/mezo-trove";
import { buildPriceReading, scaleTo18 } from "@/lib/protocols/price";
import { adapters, discoverAll } from "@/lib/protocols";
import { assess, morphoOracleToUsd, usdToMorphoOracle } from "@/lib/risk";
import { e18, pct, troveParams, usd } from "../risk/fixtures";

describe("client helpers", () => {
  it("chunkRange covers Morpho's history in ≤ cap windows (340 for the 2026-11-09 head)", () => {
    const w = chunkRange(MORPHO.deployBlock, 16_668_119n);
    expect(w.length).toBe(340);
    expect(w[0].from).toBe(MORPHO.deployBlock);
    expect(w.at(-1)!.to).toBe(16_668_119n);
    for (let i = 0; i < w.length; i++) {
      expect(w[i].to - w[i].from <= LOG_RANGE_CAP).toBe(true);
      if (i > 0) expect(w[i].from).toBe(w[i - 1].to + 1n);
    }
    expect(chunkRange(5n, 4n)).toEqual([]);
    expect(chunkRange(5n, 5n)).toEqual([{ from: 5n, to: 5n }]);
  });
  it("mapLimit preserves order and bounds concurrency", async () => {
    let inFlight = 0, peak = 0;
    const out = await mapLimit([5, 1, 3, 2, 4], 2, async (x) => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((r) => setTimeout(r, x));
      inFlight--;
      return x * 10;
    });
    expect(out).toEqual([50, 10, 30, 20, 40]);
    expect(peak).toBe(2);
  });
  it("address topics", () => {
    const a = "0x09aB514B6974601967E7b379478EFf4073cceD06" as Address;
    expect(addressTopic(a)).toBe("0x00000000000000000000000009ab514b6974601967e7b379478eff4073cced06");
    expect(topicToAddress(addressTopic(a)).toLowerCase()).toBe(a.toLowerCase());
  });
  it("event topics match the frozen ABI", () => {
    const ev = (n: string) => morphoAbi.find((x) => x.type === "event" && x.name === n)!;
    expect(TOPIC.CreateMarket).toBe(toEventSelector(ev("CreateMarket") as never));
    expect(TOPIC.Borrow).toBe(toEventSelector(ev("Borrow") as never));
    expect(TOPIC.SupplyCollateral).toBe(toEventSelector(ev("SupplyCollateral") as never));
  });
});

describe("Morpho SharesMathLib / MathLib mirror (hand-computed)", () => {
  // Real BTC/mUSDC market + borrower 0x09aB… on 2026-11-09 (cast): shares 99,961,175,532,156;
  // totalBorrowAssets 10,696,648,061; totalBorrowShares 10,692,494,318,585,746.
  const S = 99_961_175_532_156n, TA = 10_696_648_061n, TS = 10_692_494_318_585_746n;
  it("toAssetsUp/Down with virtual shares 1e6, virtual assets 1", () => {
    // ceil(S × (TA+1) / (TS+1e6)) computed independently in Python
    expect(toAssetsUp(S, TA, TS)).toBe(100_000_008n);
    expect(toAssetsDown(S, TA, TS)).toBe(100_000_007n);
    expect(VIRTUAL_SHARES).toBe(1_000_000n);
  });
  it("empty market: 1 asset ↔ 1e6 shares", () => {
    expect(toSharesDown(1n, 0n, 0n)).toBe(1_000_000n);
    expect(toSharesUp(1n, 0n, 0n)).toBe(1_000_000n);
    expect(toAssetsUp(1_000_000n, 0n, 0n)).toBe(1n);
    expect(toAssetsUp(1n, 0n, 0n)).toBe(1n); // rounds up
    expect(toAssetsDown(1n, 0n, 0n)).toBe(0n);
  });
  it("wTaylorCompounded", () => {
    // x = 1e9/s, n = 1 year: 3.1536e16 + (3.1536e16)²/2e18 + …/3e18
    expect(wTaylorCompounded(10n ** 9n, 31_536_000n)).toBe(32_038_486_841_419_776n);
    expect(wTaylorCompounded(0n, 100n)).toBe(0n);
  });
  it("accrueInterest then borrow assets (rate 14,269,306/s, 1 h elapsed)", () => {
    const m = { totalSupplyAssets: 44_570_068_578n, totalSupplyShares: 77_177_953_646_105_122n, totalBorrowAssets: TA, totalBorrowShares: TS, lastUpdate: 1000n, fee: 0n };
    const a = accrueInterest(m, 14_269_306n, 1000n + 3600n);
    expect(a.totalBorrowAssets).toBe(TA + 549n);
    expect(a.totalSupplyAssets).toBe(m.totalSupplyAssets + 549n);
    expect(borrowAssetsOf(S, a)).toBe(100_000_013n);
    expect(accrueInterest(m, 14_269_306n, 1000n)).toBe(m); // no time elapsed
  });
  it("fee mints supply shares, not borrow assets", () => {
    const m = { totalSupplyAssets: e18(100), totalSupplyShares: e18(100) * 10n ** 6n, totalBorrowAssets: e18(50), totalBorrowShares: e18(50) * 10n ** 6n, lastUpdate: 0n, fee: e18("0.1") };
    const a = accrueInterest(m, 10n ** 9n, 1000n);
    expect(a.totalSupplyShares > m.totalSupplyShares).toBe(true);
    expect(a.totalBorrowShares).toBe(m.totalBorrowShares);
  });
});

const BTC_MUSDC = MORPHO_MARKETS[0];
const info: MarketInfo = {
  id: BTC_MUSDC.id, label: BTC_MUSDC.label, loanToken: BTC_MUSDC.loanToken, collateralToken: BTC_MUSDC.collateralToken,
  oracle: BTC_MUSDC.oracle, irm: BTC_MUSDC.irm, lltv: BTC_MUSDC.lltv,
  loanAsset: { symbol: "mUSDC", address: BTC_MUSDC.loanToken, decimals: 6 },
  collateralAsset: { symbol: "BTC", address: BTC_MUSDC.collateralToken, decimals: 18 },
};

describe("Morpho oracle conversion + position builder", () => {
  it("oracle ⇄ USD (1e36 decimal-adjusted)", () => {
    expect(morphoOracleToUsd(76_970n * 10n ** 24n, 18, 6)).toBe(usd(76_970)); // live BTC/mUSDC value 7.697e28
    expect(morphoOracleToUsd(1_002_794_319_536_398_540_000_000n, 18, 6)).toBe(1_002_794_319_536_398_540n); // MUSD/mUSDC
    expect(usdToMorphoOracle(usd(76_970), 18, 6)).toBe(76_970n * 10n ** 24n);
    expect(usdToMorphoOracle(usd(76_970), 18, 18)).toBe(76_970n * 10n ** 36n);
  });
  it("builds the real 0x09aB… position (2026-11-09 snapshot)", () => {
    const owner = "0x09aB514B6974601967E7b379478EFf4073cceD06" as Address;
    const p = buildMorphoPosition({
      owner, market: info, borrowShares: 99_961_175_532_156n, collateral: 141_249_519_739_733_320n,
      state: { totalSupplyAssets: 44_570_068_578n, totalSupplyShares: 77_177_953_646_105_122n, totalBorrowAssets: 10_696_648_061n, totalBorrowShares: 10_692_494_318_585_746n, lastUpdate: 1_794_135_665n, fee: 0n },
      borrowRate: 0n, oraclePrice: 76_970n * 10n ** 24n, blockNumber: 1n, blockTimestamp: 1_794_135_665n, mezoBtcUsd: usd(74_000),
    });
    expect(p.debtAmount).toBe(100_000_008n);
    expect(p.debtValueUsd).toBe(100_000_008n * 10n ** 12n);
    // CR = floor(coll × price / 1e36) × 1e18 / debt
    const collInLoan = (141_249_519_739_733_320n * 76_970n * 10n ** 24n) / 10n ** 36n;
    expect(p.collateralRatio).toBe((collInLoan * 10n ** 18n) / 100_000_008n);
    expect(p.collateralValueUsd).toBe((141_249_519_739_733_320n * usd(74_000)) / 10n ** 18n); // Mezo PriceFeed price
    expect(p.price.source).toBe("morpho-oracle");
    expect(p.price.usd).toBe(usd(76_970));
    expect(p.positionId).toBe(`${BTC_MUSDC.id}:${owner}`);
    expect(assess(p).level).toBe("healthy");
  });
});

const rawTrove = (o: Partial<RawTroveReads> = {}): RawTroveReads => ({
  owner: "0x017FF5FB886E90f9e5ADb405D8eFddffC1162dD2", statusCode: 1,
  coll: 70_927_700_000_000_000n, principal: 2_822_249_630_000_000_000_000n, interest: 1_095_482_047_436_824_697n,
  pendingCollateral: 0n, pendingPrincipal: 0n, pendingInterest: 0n,
  icr: 1_856_197_717_780_521_340n, interestRateBps: 100, maxBorrowingCapacity: 5_136_334_324_649_785_454_545n,
  params: troveParams(), blockNumber: 1n, ...o,
});

describe("Trove builder + tx helpers", () => {
  const priceR = buildPriceReading({ fetchPrice: { ok: true, value: 73_887_730_160_000_000_000_000n }, answer: 0n, updatedAt: 1n, decimals: 18, blockNumber: 1n, blockTimestamp: 2n });
  it("matches the live snapshot: our CR == TroveManager.getCurrentICR", () => {
    const p = buildTrovePosition(rawTrove(), priceR);
    expect(p.debtAmount).toBe(2_822_249_630_000_000_000_000n + 1_095_482_047_436_824_697n);
    // The cast reads were separate calls a few blocks apart (interest accrues per second), so only near-equality holds
    // here; the LIVE test asserts exact equality inside one multicall/block.
    const ours = (p.collateralAmount * priceR.usd) / p.debtAmount;
    expect(p.collateralRatio).toBe(1_856_197_717_780_521_340n); // protocol value is passed through untouched
    const diff = ours > p.collateralRatio ? ours - p.collateralRatio : p.collateralRatio - ours;
    expect(diff * 10n ** 8n < p.collateralRatio).toBe(true); // < 1e-8 relative
    expect(p.liquidationPriceUsd).toBe(((p.debtAmount * pct(110)) + p.collateralAmount - 1n) / p.collateralAmount);
    expect(p.status).toBe("active");
  });
  it("status codes", () => {
    expect([0, 1, 2, 3, 4].map(troveStatusFromCode)).toEqual([null, "active", "closed", "liquidated", "redeemed"]);
  });
  it("maxRepay / closeCost mirror BorrowerOperations", () => {
    const p = buildTrovePosition(rawTrove(), priceR);
    expect(maxRepay(p)).toBe(p.debtAmount - e18(200) - e18(1800));
    expect(closeCost(p)).toBe(p.debtAmount - e18(200));
    const small = buildTrovePosition(rawTrove({ principal: e18(1_900), interest: 0n }), priceR);
    expect(maxRepay(small)).toBe(0n);
  });
  it("NICR = coll × 1e20 / principal", () => {
    expect(nominalICR(e18(1), e18(40_000))).toBe((e18(1) * 10n ** 20n) / e18(40_000));
  });
});

describe("price reading", () => {
  const base = { answer: 74_000n * 10n ** 18n, updatedAt: 1000n, decimals: 18, blockNumber: 5n, blockTimestamp: 1007n };
  it("PriceFeed OK ⇒ fresh", () => {
    const r = buildPriceReading({ ...base, fetchPrice: { ok: true, value: usd(74_001) } });
    expect(r).toMatchObject({ usd: usd(74_001), source: "mezo-pricefeed", stale: false, updatedAt: 1000, sourceAddress: MUSD_PROTOCOL.priceFeed });
  });
  it("PriceFeed reverts ⇒ precompile value, stale with reason", () => {
    const r = buildPriceReading({ ...base, blockTimestamp: 1095n, fetchPrice: { ok: false, error: "PriceFeed: Oracle is stale." } });
    expect(r.usd).toBe(usd(74_000));
    expect(r.source).toBe("mezo-oracle-precompile");
    expect(r.stale).toBe(true);
    expect(r.staleReason).toMatch(/95s/);
  });
  it("never invents a price", () => {
    expect(() => buildPriceReading({ ...base, answer: 0n, fetchPrice: { ok: false, error: "x" } })).toThrow();
    expect(() => buildPriceReading({ ...base, decimals: null, fetchPrice: { ok: false, error: "x" } })).toThrow();
  });
  it("scales oracle digits like PriceFeed", () => {
    expect(scaleTo18(7_400_000_000_000n, 8)).toBe(usd(74_000));
    expect(scaleTo18(1n, 18)).toBe(1n);
  });
});

describe("discoverAll", () => {
  it("never throws; failing adapter ⇒ status error", async () => {
    const saved = [...adapters];
    adapters.splice(0, adapters.length,
      { ...saved[0], discover: async () => { throw new Error("rpc down"); } },
      { ...saved[1], discover: async () => [] },
    );
    try {
      const r = await discoverAll("0x0000000000000000000000000000000000000001" as Address);
      expect(r.positions).toEqual([]);
      expect(r.protocols[0]).toMatchObject({ id: "mezo-musd-trove", status: "error", error: "rpc down", positions: 0 });
      expect(r.protocols[1]).toMatchObject({ id: "morpho-blue", status: "ok", positions: 0 });
    } finally {
      adapters.splice(0, adapters.length, ...saved);
    }
  });
});

