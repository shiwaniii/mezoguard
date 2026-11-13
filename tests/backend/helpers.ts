import type { Address } from "viem";
import { createPgliteDb, type Db } from "@/lib/server/db";
import { migrate } from "@/lib/server/db/migrate";
import type { Position, PriceReading } from "@/lib/risk/types";
import { MUSD_PROTOCOL, BTC_TOKEN } from "@/lib/chain/config";

export const WAD = 10n ** 18n;
export const OWNER: Address = "0x017FF5FB886E90f9e5ADb405D8eFddffC1162dD2";
export const OTHER: Address = "0x1111111111111111111111111111111111111111";

export async function makeDb(): Promise<Db> {
  const db = createPgliteDb("memory://");
  await migrate(db);
  return db;
}

export function price(usd: bigint, stale = false): PriceReading {
  return {
    usd, source: "mezo-pricefeed", sourceAddress: MUSD_PROTOCOL.priceFeed, updatedAt: Math.floor(Date.now() / 1000),
    blockNumber: 1000n, stale, staleReason: stale ? "PriceFeed reverted (older than 60 s)" : undefined,
  };
}

/** A realistic Trove: 0.0709 BTC vs 2,823.34 MUSD (→ ~186 % at $74,130). CR is derived from the price. */
export function trove(opts: { owner?: Address; priceUsd?: bigint; coll?: bigint; debt?: bigint; stale?: boolean; block?: bigint; status?: Position["status"] } = {}): Position {
  const owner = opts.owner ?? OWNER;
  const priceUsd = opts.priceUsd ?? 74_130n * WAD;
  const coll = opts.coll ?? 70_900_000_000_000_000n; // 0.0709 BTC
  const debt = opts.debt ?? 2_823_340_000_000_000_000_000n; // 2,823.34 MUSD
  const mcr = 1_100_000_000_000_000_000n;
  const collUsd = (coll * priceUsd) / WAD;
  return {
    protocol: "mezo-musd-trove",
    positionId: owner,
    owner,
    chainId: 31611,
    collateralAsset: { symbol: "BTC", address: BTC_TOKEN, decimals: 18 },
    collateralAmount: coll,
    debtAsset: { symbol: "MUSD", address: MUSD_PROTOCOL.musd, decimals: 18 },
    debtAmount: debt,
    collateralValueUsd: collUsd,
    debtValueUsd: debt,
    collateralRatio: (collUsd * WAD) / debt,
    liquidationRatio: mcr,
    liquidationPriceUsd: (debt * mcr) / coll,
    price: price(priceUsd, opts.stale ?? false),
    status: opts.status ?? "active",
    params: {
      kind: "trove", mcr, ccr: 1_500_000_000_000_000_000n, minNetDebt: 1800n * WAD, gasCompensation: 200n * WAD,
      borrowingRate: 0n, redemptionRate: 7_500_000_000_000_000n, recoveryMode: false, tcr: 3n * WAD, systemColl: 0n, systemDebt: 0n,
    },
    redemption: { queuePosition: 200, queueSize: 344, debtAhead: 0n, debtAheadShare: 0n, exposure: "low" },
    interestRateBps: 100,
    blockNumber: opts.block ?? 1000n,
    readAt: Date.now(),
  };
}

/** Price at which `trove()` has the given CR percent. */
export function priceForCr(crPercent: bigint, coll = 70_900_000_000_000_000n, debt = 2_823_340_000_000_000_000_000n): bigint {
  const d = 100n * coll;
  return (crPercent * debt * WAD + d - 1n) / d; // round up so CR is never just below the target
}
