/**
 * MUSD Trove adapter (Mezo's Liquity-v1-style CDP). See docs/MEZO_INTEGRATION.md.
 *
 * Discovery: TroveManager.getTroveStatus(owner) — one Trove per address, 1 = active (exact, no indexing).
 * Status enum (ITroveManager.Status): 0 nonExistent, 1 active, 2 closedByOwner, 3 closedByLiquidation, 4 closedByRedemption.
 *
 * NOTE on getEntireDebtAndColl: the deployed TroveManager ALREADY adds pending redistribution into the returned
 * coll/principal/interest (research/musd/TroveManager.sol L797-801: `coll += pendingCollateral; principal +=
 * pendingPrincipal; interest += pendingInterest;`). The pending* outputs are informational. So:
 *   debt = principal + interest      coll = coll        (adding pending again would double count)
 * This equals TroveManager._getCurrentTroveAmounts, i.e. what getCurrentICR uses.
 */
import type { Address, PublicClient } from "viem";
import { BTC_TOKEN, MEZO_TESTNET_ID, MUSD_PROTOCOL } from "@/lib/chain/config";
import { borrowerOperationsAbi, hintHelpersAbi, sortedTrovesAbi, troveManagerAbi } from "@/lib/chain/abis";
import type { Position, PriceReading, ProtocolAdapter, TroveParams, TroveRedemption } from "@/lib/risk/types";
import { liquidationPrice } from "@/lib/risk/liquidation";
import { analyzeRedemption, type TroveQueueEntry } from "@/lib/risk/redemption";
import { repricePosition } from "@/lib/risk/valuation";
import { closeCostFor, maxRepayFor } from "@/lib/risk/recommend";
import { toUsd } from "@/lib/risk/math";
import { MULTICALL3, getPublicClient, multicall3Abi } from "@/lib/protocols/client";
import { readBtcPriceWith } from "@/lib/protocols/price";

export const TROVE_STATUS = ["nonExistent", "active", "closed", "liquidated", "redeemed"] as const;

export function troveStatusFromCode(code: number): Position["status"] | null {
  switch (code) {
    case 1:
      return "active";
    case 2:
      return "closed";
    case 3:
      return "liquidated";
    case 4:
      return "redeemed";
    default:
      return null;
  }
}

const TM = { address: MUSD_PROTOCOL.troveManager, abi: troveManagerAbi } as const;
const BO = { address: MUSD_PROTOCOL.borrowerOperations, abi: borrowerOperationsAbi } as const;
const ST = { address: MUSD_PROTOCOL.sortedTroves, abi: sortedTrovesAbi } as const;
const MC = { address: MULTICALL3, abi: multicall3Abi } as const;

export const BTC_ASSET = { symbol: "BTC", address: BTC_TOKEN, decimals: 18 };
export const MUSD_ASSET = { symbol: "MUSD", address: MUSD_PROTOCOL.musd as Address, decimals: 18 };

export interface RawTroveReads {
  owner: Address;
  statusCode: number;
  coll: bigint;
  principal: bigint;
  interest: bigint;
  pendingCollateral: bigint;
  pendingPrincipal: bigint;
  pendingInterest: bigint;
  icr: bigint;
  interestRateBps: number;
  maxBorrowingCapacity: bigint;
  params: TroveParams;
  blockNumber: bigint;
}

/** Pure: raw reads + price → Position. */
export function buildTrovePosition(r: RawTroveReads, price: PriceReading, redemption?: TroveRedemption, readAt = Date.now()): Position {
  const status = troveStatusFromCode(r.statusCode) ?? "closed";
  const debt = r.principal + r.interest;
  const p: Position = {
    protocol: "mezo-musd-trove",
    positionId: r.owner,
    owner: r.owner,
    chainId: MEZO_TESTNET_ID,
    collateralAsset: BTC_ASSET,
    collateralAmount: r.coll,
    debtAsset: MUSD_ASSET,
    debtAmount: debt,
    debtPrincipal: r.principal,
    debtInterest: r.interest,
    collateralValueUsd: toUsd(r.coll, 18, price.usd),
    debtValueUsd: debt, // MUSD at $1 (the protocol's own accounting unit)
    collateralRatio: r.icr,
    liquidationRatio: r.params.mcr,
    liquidationPriceUsd: 0n,
    price,
    status,
    params: r.params,
    redemption,
    interestRateBps: r.interestRateBps,
    maxBorrowingCapacity: r.maxBorrowingCapacity,
    blockNumber: r.blockNumber,
    readAt,
  };
  p.liquidationPriceUsd = liquidationPrice(p);
  return p;
}

export async function readTroveRaw(client: PublicClient, owner: Address, price: bigint): Promise<RawTroveReads> {
  const r = await client.multicall({
    allowFailure: false,
    contracts: [
      { ...TM, functionName: "getTroveStatus", args: [owner] },
      { ...TM, functionName: "getEntireDebtAndColl", args: [owner] },
      { ...TM, functionName: "getCurrentICR", args: [owner, price] },
      { ...TM, functionName: "getTroveInterestRate", args: [owner] },
      { ...TM, functionName: "getTroveMaxBorrowingCapacity", args: [owner] },
      { ...BO, functionName: "MCR" },
      { ...BO, functionName: "CCR" },
      { ...BO, functionName: "minNetDebt" },
      { ...BO, functionName: "MUSD_GAS_COMPENSATION" },
      { ...BO, functionName: "borrowingRate" },
      { ...BO, functionName: "redemptionRate" },
      { ...TM, functionName: "checkRecoveryMode", args: [price] },
      { ...TM, functionName: "getTCR", args: [price] },
      { ...TM, functionName: "getEntireSystemColl" },
      { ...TM, functionName: "getEntireSystemDebt" },
      { ...MC, functionName: "getBlockNumber" },
    ],
  });
  const [status, dc, icr, rate, maxCap, mcr, ccr, minNetDebt, gasComp, borrowingRate, redemptionRate, recovery, tcr, sysColl, sysDebt, bn] = r;
  const [coll, principal, interest, pendingCollateral, pendingPrincipal, pendingInterest] = dc;
  return {
    owner,
    statusCode: Number(status),
    coll, principal, interest, pendingCollateral, pendingPrincipal, pendingInterest,
    icr,
    interestRateBps: Number(rate),
    maxBorrowingCapacity: maxCap,
    params: {
      kind: "trove", mcr, ccr, minNetDebt, gasCompensation: gasComp, borrowingRate, redemptionRate,
      recoveryMode: recovery, tcr, systemColl: sysColl, systemDebt: sysDebt,
    },
    blockNumber: bn,
  };
}

// ───────────────────────────── Redemption queue (cached) ─────────────────────────────

export const REDEMPTION_CACHE_MS = 30_000;
let queueCache: { at: number; price: bigint; entries: TroveQueueEntry[] } | undefined;

/** Clears the redemption queue cache (tests). */
export function clearTroveCaches() {
  queueCache = undefined;
}

/**
 * All active Troves with NICR, ICR at `price`, and total debt. SortedTroves is a linked list (getPrev is sequential),
 * so instead of 344 dependent round trips we read the TroveOwners array (same membership: active Troves only) and
 * NICRs with batched multicalls, then sort by NICR — the exact key SortedTroves orders by. Cross-checked: the lowest
 * NICR must equal SortedTroves.getLast() (else we fall back to walking the list).
 */
export async function readTroveQueue(client: PublicClient, price: bigint): Promise<TroveQueueEntry[]> {
  if (queueCache && Date.now() - queueCache.at < REDEMPTION_CACHE_MS) return queueCache.entries;
  const [count, last, size] = await client.multicall({
    allowFailure: false,
    contracts: [
      { ...TM, functionName: "getTroveOwnersCount" },
      { ...ST, functionName: "getLast" },
      { ...ST, functionName: "getSize" },
    ],
  });
  const n = Number(count);
  const owners = (await client.multicall({
    allowFailure: false,
    contracts: Array.from({ length: n }, (_, i) => ({ ...TM, functionName: "getTroveFromTroveOwnersArray" as const, args: [BigInt(i)] as const })),
  })) as Address[];
  let ordered = owners;
  const perTrove = await client.multicall({
    allowFailure: false,
    contracts: owners.flatMap((o) => [
      { ...TM, functionName: "getNominalICR" as const, args: [o] as const },
      { ...TM, functionName: "getCurrentICR" as const, args: [o, price] as const },
      { ...TM, functionName: "getEntireDebtAndColl" as const, args: [o] as const },
    ]),
  });
  let entries: TroveQueueEntry[] = ordered.map((owner, i) => {
    const nicr = perTrove[3 * i] as bigint;
    const icr = perTrove[3 * i + 1] as bigint;
    const dc = perTrove[3 * i + 2] as readonly bigint[];
    return { owner, nicr, icr, debt: dc[1] + dc[2] };
  });
  const lowest = entries.reduce<TroveQueueEntry | undefined>((m, e) => (!m || e.nicr < m.nicr ? e : m), undefined);
  const lastEntry = entries.find((e) => e.owner.toLowerCase() === last.toLowerCase());
  // Ties in NICR are allowed (any equal-NICR trove may be last), so compare keys, not addresses.
  if (Number(size) !== n || (lowest && (!lastEntry || lastEntry.nicr !== lowest.nicr))) {
    // Membership/order mismatch — walk the list itself (slow path, sequential).
    ordered = await walkSortedTroves(client);
    entries = entries.filter((e) => ordered.some((o) => o.toLowerCase() === e.owner.toLowerCase()));
  }
  queueCache = { at: Date.now(), price, entries };
  return entries;
}

async function walkSortedTroves(client: PublicClient): Promise<Address[]> {
  const out: Address[] = [];
  let cur = (await client.readContract({ ...ST, functionName: "getLast" })) as Address;
  const zero = "0x0000000000000000000000000000000000000000";
  for (let i = 0; i < 10_000 && cur.toLowerCase() !== zero; i++) {
    out.push(cur);
    cur = (await client.readContract({ ...ST, functionName: "getPrev", args: [cur] })) as Address;
  }
  return out;
}

// ───────────────────────────── Adapter ─────────────────────────────

async function readPosition(client: PublicClient, owner: Address, withRedemption = true): Promise<Position | null> {
  const price = await readBtcPriceWith(client);
  const raw = await readTroveRaw(client, owner, price.usd);
  if (raw.statusCode === 0) return null;
  let redemption: TroveRedemption | undefined;
  if (withRedemption && raw.statusCode === 1) {
    try {
      const q = await readTroveQueue(client, price.usd);
      redemption = analyzeRedemption(q, owner, raw.params.mcr, raw.params.systemDebt);
    } catch {
      redemption = undefined; // exposure is advisory; never fail the position read over it
    }
  }
  return buildTrovePosition(raw, price, redemption);
}

export function createMezoTroveAdapter(getClient: () => PublicClient = getPublicClient): ProtocolAdapter {
  return {
    id: "mezo-musd-trove",
    label: "Mezo MUSD Trove",
    async discover(owner: Address): Promise<Position[]> {
      const client = getClient();
      const status = await client.readContract({ ...TM, functionName: "getTroveStatus", args: [owner] });
      if (Number(status) !== 1) return [];
      const p = await readPosition(client, owner);
      return p && p.status === "active" ? [p] : [];
    },
    async refresh(positionId: string): Promise<Position | null> {
      if (!/^0x[0-9a-fA-F]{40}$/.test(positionId)) return null;
      return readPosition(getClient(), positionId as Address);
    },
    reprice: repricePosition,
  };
}

export const mezoTroveAdapter: ProtocolAdapter = createMezoTroveAdapter();

// ───────────────────────────── Pure helpers for tx forms ─────────────────────────────

/** debt − gasComp − minNetDebt, ≥ 0 (BorrowerOperations._requireAtLeastMinNetDebt). */
export function maxRepay(p: Position): bigint {
  if (p.params.kind !== "trove") throw new Error("maxRepay: not a Trove position");
  return maxRepayFor(p);
}

/** debt − gasComp (closeTrove burns this from the caller; the gas compensation is burned from the GasPool). */
export function closeCost(p: Position): bigint {
  if (p.params.kind !== "trove") throw new Error("closeCost: not a Trove position");
  return closeCostFor(p);
}

/** NICR as SortedTroves keys it: coll × 1e20 / principal (LiquityMath._computeNominalCR). */
export function nominalICR(coll: bigint, principal: bigint): bigint {
  if (principal === 0n) return 2n ** 256n - 1n;
  return (coll * 10n ** 20n) / principal;
}

/**
 * Insert hints for a Trove that will end up with (coll, debt). `debt` must be the resulting PRINCIPAL (NICR ignores
 * interest — TroveManager re-inserts with coll × 1e20 / principal). HintHelpers.getApproxHint with 15·√n trials, then
 * SortedTroves.findInsertPosition.
 */
export async function getHints(client: PublicClient, coll: bigint, debt: bigint): Promise<{ upper: Address; lower: Address }> {
  const nicr = nominalICR(coll, debt);
  const size = await client.readContract({ ...ST, functionName: "getSize" });
  const trials = BigInt(Math.max(15, Math.ceil(15 * Math.sqrt(Number(size)))));
  const seed = BigInt(Math.floor(Math.random() * 1e15));
  const [hint] = await client.readContract({
    address: MUSD_PROTOCOL.hintHelpers,
    abi: hintHelpersAbi,
    functionName: "getApproxHint",
    args: [nicr, trials, seed],
  });
  const [upper, lower] = await client.readContract({ ...ST, functionName: "findInsertPosition", args: [nicr, hint, hint] });
  return { upper, lower };
}
