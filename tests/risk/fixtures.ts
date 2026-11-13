import type { Address, Hex } from "viem";
import type { MorphoParams, Position, PriceReading, ProtocolAdapter, TroveParams } from "@/lib/risk/types";
import { liquidationPrice } from "@/lib/risk/liquidation";
import {
  morphoCollateralRatio, morphoLiquidationRatio, repricePosition, troveCollateralRatio, usdToMorphoOracle,
} from "@/lib/risk/valuation";

export const E18 = 10n ** 18n;
export const e18 = (n: number | string) => {
  const [i, f = ""] = String(n).split(".");
  return BigInt(i) * E18 + BigInt((f + "0".repeat(18)).slice(0, 18));
};
export const usd = e18;
export const pct = (n: number | string) => e18(n) / 100n; // 110 → 1.1e18

export const OWNER = "0x1111111111111111111111111111111111111111" as Address;

export function price(usdV: bigint, extra: Partial<PriceReading> = {}): PriceReading {
  return {
    usd: usdV, source: "mezo-pricefeed", sourceAddress: "0x86bCF0841622a5dAC14A313a15f96A95421b9366",
    updatedAt: 1_794_208_804, blockNumber: 1n, stale: false, ...extra,
  };
}

export const troveParams = (o: Partial<TroveParams> = {}): TroveParams => ({
  kind: "trove", mcr: pct(110), ccr: pct(150), minNetDebt: e18(1800), gasCompensation: e18(200),
  borrowingRate: e18("0.001"), redemptionRate: e18("0.0075"), recoveryMode: false, tcr: pct(300),
  systemColl: e18(1000), systemDebt: e18(10_000_000), ...o,
});

/** Builds a Trove Position whose CR is computed independently (coll × price / debt). */
export function trove(collBtc: bigint, debt: bigint, priceUsd: bigint, o: Partial<Position> = {}, params: Partial<TroveParams> = {}): Position {
  const p: Position = {
    protocol: "mezo-musd-trove", positionId: OWNER, owner: OWNER, chainId: 31611,
    collateralAsset: { symbol: "BTC", address: "0x7b7C000000000000000000000000000000000000", decimals: 18 },
    collateralAmount: collBtc,
    debtAsset: { symbol: "MUSD", address: "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503", decimals: 18 },
    debtAmount: debt,
    collateralValueUsd: (collBtc * priceUsd) / E18,
    debtValueUsd: debt,
    collateralRatio: troveCollateralRatio(collBtc, debt, priceUsd),
    liquidationRatio: params.mcr ?? pct(110),
    liquidationPriceUsd: 0n,
    price: price(priceUsd),
    status: "active",
    params: troveParams(params),
    blockNumber: 1n,
    readAt: 0,
    ...o,
  };
  if (!o.liquidationPriceUsd) p.liquidationPriceUsd = liquidationPrice(p);
  return p;
}

export const MUSDC_ID = "0x1a7f8d1036936234ff8477741ba80d4a85f573fee4de1bccc779ecc7e5680b2e" as Hex;

/** Morpho position with BTC collateral. loanDecimals 6 (mUSDC) or 18 (MUSD). Price is the Morpho oracle in USD. */
export function morpho(collBtc: bigint, debt: bigint, oracleUsd: bigint, loanDecimals = 6, lltv = 77n * 10n ** 16n, o: Partial<Position> = {}): Position {
  const oraclePrice = usdToMorphoOracle(oracleUsd, 18, loanDecimals);
  const params: MorphoParams = {
    kind: "morpho", marketId: MUSDC_ID, marketLabel: loanDecimals === 6 ? "BTC / mUSDC" : "BTC / MUSD",
    loanToken: "0xe1a26db653708A2AD8F824E92Db9852410e33A59", collateralToken: "0x7b7C000000000000000000000000000000000000",
    oracle: "0x72fB16cC59Eb5E7ACF84f24d9f2605eE153E0e6C", irm: "0x0c97Fe017628636649ff374aD499529F91167441",
    lltv, oraclePrice,
  };
  const p: Position = {
    protocol: "morpho-blue", positionId: `${MUSDC_ID}:${OWNER}`, owner: OWNER, chainId: 31611,
    collateralAsset: { symbol: "BTC", address: "0x7b7C000000000000000000000000000000000000", decimals: 18 },
    collateralAmount: collBtc,
    debtAsset: { symbol: loanDecimals === 6 ? "mUSDC" : "MUSD", address: "0xe1a26db653708A2AD8F824E92Db9852410e33A59", decimals: loanDecimals },
    debtAmount: debt,
    collateralValueUsd: (collBtc * oracleUsd) / E18,
    debtValueUsd: debt * 10n ** BigInt(18 - loanDecimals),
    collateralRatio: morphoCollateralRatio(collBtc, oraclePrice, debt),
    liquidationRatio: morphoLiquidationRatio(lltv),
    liquidationPriceUsd: 0n,
    price: price(oracleUsd, { source: "morpho-oracle" }),
    status: "active",
    params,
    blockNumber: 1n,
    readAt: 0,
    ...o,
  };
  if (!o.liquidationPriceUsd) p.liquidationPriceUsd = liquidationPrice(p);
  return p;
}

export const stubAdapter = (id: Position["protocol"]): ProtocolAdapter => ({
  id, label: id, discover: async () => [], refresh: async () => null, reprice: repricePosition,
});
