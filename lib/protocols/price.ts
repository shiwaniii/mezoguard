/**
 * BTC/USD from Mezo. One Multicall3 aggregate (same block) reads:
 *   PriceFeed.fetchPrice()          — reverts if the precompile's updatedAt is > 60 s old (PriceFeed.MAX_PRICE_DELAY)
 *   precompile latestRoundData()    — answer + updatedAt (provenance)
 *   precompile decimals()           — to scale the raw answer to 1e18 exactly like PriceFeed._scalePriceByDigits
 *   Multicall3 block number/timestamp
 * fetchPrice OK  → source "mezo-pricefeed", stale=false.
 * fetchPrice reverts → precompile value, source "mezo-oracle-precompile", stale=true + reason. Never invents a price:
 * if the precompile also fails or answers ≤ 0, this throws.
 */
import type { PublicClient } from "viem";
import { MUSD_PROTOCOL } from "@/lib/chain/config";
import { aggregatorV3Abi, priceFeedAbi } from "@/lib/chain/abis";
import type { PriceReading } from "@/lib/risk/types";
import { MULTICALL3, multicall3Abi } from "@/lib/protocols/client";

export const PRICEFEED_MAX_DELAY_SECONDS = 60;

export function scaleTo18(raw: bigint, decimals: number): bigint {
  if (decimals > 18) return raw / 10n ** BigInt(decimals - 18);
  if (decimals < 18) return raw * 10n ** BigInt(18 - decimals);
  return raw;
}

export interface RawPriceReads {
  fetchPrice: { ok: true; value: bigint } | { ok: false; error: string };
  answer: bigint;
  updatedAt: bigint;
  /** null if decimals() failed. */
  decimals: number | null;
  blockNumber: bigint;
  blockTimestamp: bigint;
}

/** Pure: turns the raw reads into a PriceReading. Exported for tests. */
export function buildPriceReading(r: RawPriceReads): PriceReading {
  const updatedAt = Number(r.updatedAt);
  if (r.fetchPrice.ok) {
    return {
      usd: r.fetchPrice.value,
      source: "mezo-pricefeed",
      sourceAddress: MUSD_PROTOCOL.priceFeed,
      updatedAt,
      blockNumber: r.blockNumber,
      stale: false,
    };
  }
  if (r.decimals === null) throw new Error(`BTC price unavailable: PriceFeed reverted (${r.fetchPrice.error}) and oracle decimals() failed`);
  if (r.answer <= 0n) throw new Error(`BTC price unavailable: PriceFeed reverted (${r.fetchPrice.error}) and oracle answer is ${r.answer}`);
  const age = r.blockTimestamp - r.updatedAt;
  const stale =
    age > BigInt(PRICEFEED_MAX_DELAY_SECONDS)
      ? `oracle last updated ${age}s before block ${r.blockNumber} (PriceFeed max ${PRICEFEED_MAX_DELAY_SECONDS}s); PriceFeed.fetchPrice reverted`
      : `PriceFeed.fetchPrice reverted (${r.fetchPrice.error}); using oracle precompile value`;
  return {
    usd: scaleTo18(r.answer, r.decimals),
    source: "mezo-oracle-precompile",
    sourceAddress: MUSD_PROTOCOL.btcUsdOracle,
    updatedAt,
    blockNumber: r.blockNumber,
    stale: true,
    staleReason: stale,
  };
}

export async function readRawPrice(client: PublicClient, blockNumber?: bigint): Promise<RawPriceReads> {
  const res = await client.multicall({
    allowFailure: true,
    blockNumber,
    contracts: [
      { address: MUSD_PROTOCOL.priceFeed, abi: priceFeedAbi, functionName: "fetchPrice" },
      { address: MUSD_PROTOCOL.btcUsdOracle, abi: aggregatorV3Abi, functionName: "latestRoundData" },
      { address: MUSD_PROTOCOL.btcUsdOracle, abi: aggregatorV3Abi, functionName: "decimals" },
      { address: MULTICALL3, abi: multicall3Abi, functionName: "getBlockNumber" },
      { address: MULTICALL3, abi: multicall3Abi, functionName: "getCurrentBlockTimestamp" },
    ],
  });
  const [fp, round, dec, bn, ts] = res;
  if (round.status !== "success") throw new Error(`BTC oracle precompile read failed: ${String(round.error?.message ?? round.error)}`);
  if (bn.status !== "success" || ts.status !== "success") throw new Error("Multicall3 block info read failed");
  const [, answer, , updatedAt] = round.result;
  return {
    fetchPrice: fp.status === "success" ? { ok: true, value: fp.result } : { ok: false, error: shortError(fp.error) },
    answer,
    updatedAt,
    decimals: dec.status === "success" ? Number(dec.result) : null,
    blockNumber: bn.result,
    blockTimestamp: ts.result,
  };
}

export async function readBtcPriceWith(client: PublicClient, blockNumber?: bigint): Promise<PriceReading> {
  return buildPriceReading(await readRawPrice(client, blockNumber));
}

export function shortError(e: unknown): string {
  const any = e as { shortMessage?: string; message?: string } | undefined;
  const m = any?.shortMessage ?? any?.message ?? String(e);
  return m.split("\n")[0].slice(0, 200);
}
