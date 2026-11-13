import type { Address } from "viem";
import { assess, recommend, summarize, liquidationPrice, toWire } from "@/lib/risk";
import type { Position, PriceReading } from "@/lib/risk/types";
import type { PortfolioResponse, ProtocolStatus } from "@/lib/api-types";
import { BTC_TOKEN, MORPHO_MARKETS, MUSD_PROTOCOL } from "@/lib/chain/config";

export const OWNER = "0x017FF5FB886E90f9e5ADb405D8eFddffC1162dD2" as Address;
const WAD = 10n ** 18n;
export const BTC_PRICE = 74_130n * WAD;
export const MORPHO_BTC_PRICE = 76_970n * WAD;

export function price(usd: bigint, source: PriceReading["source"] = "mezo-pricefeed", stale = false): PriceReading {
  return {
    usd, source, sourceAddress: MUSD_PROTOCOL.priceFeed, updatedAt: Math.floor(Date.now() / 1000) - 7,
    blockNumber: 100n, stale, staleReason: stale ? "PriceFeed reverted: older than 60 s" : undefined,
  };
}

export function trove(opts: { coll?: bigint; debt?: bigint; priceUsd?: bigint; owner?: Address; stale?: boolean } = {}): Position {
  const coll = opts.coll ?? 70_900_000_000_000_000n; // 0.0709 BTC
  const debt = opts.debt ?? 2_823_340_000_000_000_000_000n; // 2,823.34 MUSD
  const px = opts.priceUsd ?? BTC_PRICE;
  const owner = opts.owner ?? OWNER;
  const p: Position = {
    protocol: "mezo-musd-trove",
    positionId: owner,
    owner,
    chainId: 31611,
    collateralAsset: { symbol: "BTC", address: BTC_TOKEN, decimals: 18 },
    collateralAmount: coll,
    debtAsset: { symbol: "MUSD", address: MUSD_PROTOCOL.musd, decimals: 18 },
    debtAmount: debt,
    debtPrincipal: debt - 1_090_000_000_000_000_000n,
    debtInterest: 1_090_000_000_000_000_000n,
    collateralValueUsd: (coll * px) / WAD,
    debtValueUsd: debt,
    collateralRatio: (coll * px) / debt,
    liquidationRatio: 11n * 10n ** 17n,
    liquidationPriceUsd: 0n,
    price: price(px, "mezo-pricefeed", opts.stale),
    status: "active",
    params: {
      kind: "trove", mcr: 11n * 10n ** 17n, ccr: 15n * 10n ** 17n, minNetDebt: 1800n * WAD, gasCompensation: 200n * WAD,
      borrowingRate: 0n, redemptionRate: 75n * 10n ** 14n, recoveryMode: false, tcr: 3n * WAD, systemColl: 0n, systemDebt: 0n,
    },
    redemption: { queuePosition: 12, queueSize: 344, debtAhead: 150_000n * WAD, debtAheadShare: 4n * 10n ** 16n, exposure: "moderate" },
    interestRateBps: 100,
    blockNumber: 100n,
    readAt: Date.now(),
  };
  p.liquidationPriceUsd = liquidationPrice(p);
  return p;
}

export function morpho(opts: { coll?: bigint; debt?: bigint; priceUsd?: bigint; owner?: Address } = {}): Position {
  const m = MORPHO_MARKETS[0]; // BTC / mUSDC
  const coll = opts.coll ?? 500_000_000_000_000_000n; // 0.5 BTC
  const debt = opts.debt ?? 20_000_000_000n; // 20,000 mUSDC (6 dec)
  const px = opts.priceUsd ?? MORPHO_BTC_PRICE;
  const owner = opts.owner ?? OWNER;
  const oraclePrice = px * 10n ** 6n; // usd(1e18) × 10^loanDec × 1e18 / 10^collDec
  const p: Position = {
    protocol: "morpho-blue",
    positionId: `${m.id}:${owner}`,
    owner,
    chainId: 31611,
    collateralAsset: { symbol: "BTC", address: BTC_TOKEN, decimals: 18 },
    collateralAmount: coll,
    debtAsset: { symbol: "mUSDC", address: m.loanToken, decimals: 6 },
    debtAmount: debt,
    collateralValueUsd: (coll * px) / WAD,
    debtValueUsd: debt * 10n ** 12n,
    collateralRatio: ((coll * oraclePrice) / 10n ** 36n) * WAD / debt,
    liquidationRatio: (WAD * WAD + m.lltv - 1n) / m.lltv,
    liquidationPriceUsd: 0n,
    price: price(px, "morpho-oracle"),
    status: "active",
    params: {
      kind: "morpho", marketId: m.id, marketLabel: m.label, loanToken: m.loanToken, collateralToken: m.collateralToken,
      oracle: m.oracle, irm: m.irm, lltv: m.lltv, oraclePrice,
    },
    blockNumber: 100n,
    readAt: Date.now(),
  };
  p.liquidationPriceUsd = liquidationPrice(p);
  return p;
}

export function portfolioResponse(
  positions: Position[],
  opts: { stale?: boolean; protocols?: ProtocolStatus[] } = {},
): PortfolioResponse {
  const btc = price(BTC_PRICE, "mezo-pricefeed", opts.stale);
  return {
    owner: OWNER,
    chainId: 31611,
    positions: positions.map((p) => toWire(p)),
    assessments: positions.map((p) => toWire(assess(p))),
    recommendations: positions.map((p) => toWire(recommend(p))),
    summary: toWire(summarize(OWNER, positions)),
    btcPrice: toWire(btc),
    protocols: opts.protocols ?? [
      { id: "mezo-musd-trove", label: "MUSD Trove", status: "ok", positions: positions.filter((p) => p.protocol === "mezo-musd-trove").length },
      { id: "morpho-blue", label: "Morpho Blue", status: "ok", positions: positions.filter((p) => p.protocol === "morpho-blue").length },
    ],
    readAt: Date.now() - 4000,
  };
}
