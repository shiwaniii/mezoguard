/**
 * Morpho Blue adapter. See docs/MEZO_INTEGRATION.md §Morpho.
 *
 * Discovery (events only produce CANDIDATES; state always comes from `position(id, owner)`):
 *  1. Markets = MORPHO_MARKETS ∪ CreateMarket events (params re-read on-chain via idToMarketParams).
 *  2. Owner candidates = Borrow(onBehalf = owner, topic2) ∪ SupplyCollateral(onBehalf = owner, topic3).
 *     Sources: (a) RPC eth_getLogs from MORPHO.deployBlock in ≤ LOG_RANGE_CAP windows, run with a concurrency limit.
 *     One global, incrementally-advanced index of [CreateMarket, Borrow, SupplyCollateral] (topic0 OR-filter) serves
 *     every owner — cheaper than one 340-window scan per owner and the cursor is reused across owners.
 *     (b) Blockscout's etherscan-compatible logs API (`/api?module=logs&action=getLogs`), which DOES support topic
 *     filters over the whole range in one request (the v2 `/addresses/{a}/logs` endpoint does not).
 *     If (b) answers and (a) has not finished its first full scan, we don't block on (a); it keeps warming.
 *  3. position(id, owner) is read for EVERY known market (a handful) ∪ candidates, so discovery is exact whenever the
 *     market list is complete; zero borrow + zero collateral are dropped.
 *
 * Debt: market() accrued to the block timestamp with IRM.borrowRateView + wTaylorCompounded, then borrowShares →
 * assets rounded UP (virtual shares 1e6 / virtual assets 1), exactly as Morpho's SharesMathLib.
 */
import type { Address, ContractFunctionParameters, Hex, PublicClient } from "viem";
import {
  BTC_TOKEN, EXPLORER_API, MEZO_TESTNET_ID, MORPHO, MORPHO_MARKETS, MUSDC_TESTNET, MUSD_PROTOCOL,
  type MorphoMarketConfig,
} from "@/lib/chain/config";
import { erc20Abi, morphoAbi, morphoIrmAbi, morphoOracleAbi } from "@/lib/chain/abis";
import type { MorphoParams, Position, PriceReading, ProtocolAdapter } from "@/lib/risk/types";
import { liquidationPrice } from "@/lib/risk/liquidation";
import { stableToUsd, toUsd, WAD } from "@/lib/risk/math";
import {
  morphoCollateralRatio, morphoLiquidationRatio, morphoOracleToUsd, repricePosition,
} from "@/lib/risk/valuation";
import {
  MULTICALL3, addressTopic, getLogsChunked, getPublicClient, mapLimit, multicall3Abi, topicToAddress,
} from "@/lib/protocols/client";
import { readBtcPriceWith } from "@/lib/protocols/price";
import {
  SECONDS_PER_YEAR, accrueInterest, borrowAssetsOf, type MorphoMarketState,
} from "@/lib/protocols/morpho-math";

const MORPHO_ADDR = MORPHO.morpho as Address;
const M = { address: MORPHO_ADDR, abi: morphoAbi } as const;
const MC = { address: MULTICALL3, abi: multicall3Abi } as const;

const EV_CREATE = morphoAbi.find((x) => x.type === "event" && x.name === "CreateMarket")!;
const EV_BORROW = morphoAbi.find((x) => x.type === "event" && x.name === "Borrow")!;
const EV_SUPPLY_COLL = morphoAbi.find((x) => x.type === "event" && x.name === "SupplyCollateral")!;
export const TOPIC = {
  CreateMarket: "0xac4b2400f169220b0c0afdde7a0b32e775ba727ea1cb30b35f935cdaab8683ac" as Hex,
  Borrow: "0x570954540bed6b1304a87dfe815a5eda4a648f7097a16240dcd85c9b5fd42a43" as Hex,
  SupplyCollateral: "0xa3b9472a1399e17e123f3c2e6586c23e504184d504de59cdaa2b375e880c6184" as Hex,
};

/** Etherscan-compatible Blockscout endpoint (EXPLORER_API is the v2 REST root). */
export const BLOCKSCOUT_ETHERSCAN_API = EXPLORER_API.replace(/\/v2\/?$/, "");
const BLOCKSCOUT_MAX_RESULTS = 1000;

export interface MarketInfo {
  id: Hex;
  label: string;
  loanToken: Address;
  collateralToken: Address;
  oracle: Address;
  irm: Address;
  lltv: bigint;
  loanAsset: { symbol: string; address: Address; decimals: number };
  collateralAsset: { symbol: string; address: Address; decimals: number };
}

function fromConfig(c: MorphoMarketConfig): MarketInfo {
  return {
    id: c.id.toLowerCase() as Hex,
    label: c.label,
    loanToken: c.loanToken,
    collateralToken: c.collateralToken,
    oracle: c.oracle,
    irm: c.irm,
    lltv: c.lltv,
    loanAsset: { symbol: c.loanSymbol, address: c.loanToken, decimals: c.loanDecimals },
    collateralAsset: { symbol: c.collateralSymbol, address: c.collateralToken, decimals: c.collateralDecimals },
  };
}

const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Tokens we can value in USD (loan assets at $1, BTC at the Mezo price). Other markets are skipped with a warning. */
function knownSymbol(token: Address): "BTC" | "MUSD" | "mUSDC" | null {
  if (eq(token, BTC_TOKEN)) return "BTC";
  if (eq(token, MUSD_PROTOCOL.musd)) return "MUSD";
  if (eq(token, MUSDC_TESTNET)) return "mUSDC";
  return null;
}

// ───────────────────────────── Event index (global, in-memory) ─────────────────────────────

interface IndexState {
  /** Last block fully scanned (inclusive). */
  cursor: bigint;
  markets: Set<Hex>;
  /** owner(lowercase) → market ids seen in Borrow/SupplyCollateral onBehalf. */
  owners: Map<string, Set<Hex>>;
  fullScanDone: boolean;
}

const index: IndexState = { cursor: MORPHO.deployBlock - 1n, markets: new Set(), owners: new Map(), fullScanDone: false };
let indexing: Promise<void> | undefined;
const marketInfoCache = new Map<string, MarketInfo>();
export const morphoWarnings: string[] = [];

export function resetMorphoCaches() {
  index.cursor = MORPHO.deployBlock - 1n;
  index.markets.clear();
  index.owners.clear();
  index.fullScanDone = false;
  indexing = undefined;
  marketInfoCache.clear();
  morphoWarnings.length = 0;
}

export function getIndexSnapshot() {
  return { cursor: index.cursor, fullScanDone: index.fullScanDone, markets: [...index.markets], owners: index.owners.size };
}

function addOwner(owner: Address, id: Hex) {
  const k = owner.toLowerCase();
  if (!index.owners.has(k)) index.owners.set(k, new Set());
  index.owners.get(k)!.add(id.toLowerCase() as Hex);
}

/** Advances the global RPC index to the head. Single-flight. */
export function ensureIndex(client: PublicClient, concurrency = 12): Promise<void> {
  if (!indexing) {
    indexing = (async () => {
      const head = await client.getBlockNumber();
      if (head <= index.cursor) return;
      const logs = await getLogsChunked(client, {
        address: MORPHO_ADDR,
        topic0: [TOPIC.CreateMarket, TOPIC.Borrow, TOPIC.SupplyCollateral],
        fromBlock: index.cursor + 1n,
        toBlock: head,
        concurrency,
      });
      for (const l of logs) {
        const t0 = l.topics[0]?.toLowerCase();
        const id = l.topics[1]?.toLowerCase() as Hex | undefined;
        if (!id) continue;
        if (t0 === TOPIC.CreateMarket) index.markets.add(id);
        else if (t0 === TOPIC.Borrow && l.topics[2]) addOwner(topicToAddress(l.topics[2]), id);
        else if (t0 === TOPIC.SupplyCollateral && l.topics[3]) addOwner(topicToAddress(l.topics[3]), id);
      }
      index.cursor = head;
      index.fullScanDone = true;
    })().finally(() => {
      indexing = undefined;
    });
  }
  return indexing;
}

interface EtherscanLog { topics: (Hex | null)[] }

async function blockscoutLogs(params: Record<string, string>, timeoutMs: number): Promise<EtherscanLog[]> {
  const qs = new URLSearchParams({
    module: "logs", action: "getLogs", address: MORPHO_ADDR, fromBlock: MORPHO.deployBlock.toString(), toBlock: "latest", ...params,
  });
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BLOCKSCOUT_ETHERSCAN_API}?${qs}`, { signal: ctl.signal, headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`Blockscout HTTP ${res.status}`);
    const body = (await res.json()) as { status?: string; message?: string; result?: unknown };
    if (Array.isArray(body.result)) {
      if (body.result.length >= BLOCKSCOUT_MAX_RESULTS) throw new Error("Blockscout result truncated");
      return body.result as EtherscanLog[];
    }
    // "No logs found" comes back as status 0 with an empty/non-array result.
    if (/no (records|logs) found/i.test(body.message ?? "")) return [];
    throw new Error(`Blockscout: ${body.message ?? "bad response"}`);
  } finally {
    clearTimeout(t);
  }
}

/** Candidates from Blockscout (one request per event type). Throws if Blockscout is unavailable/incomplete. */
export async function blockscoutCandidates(owner: Address, timeoutMs = 8000): Promise<{ markets: Hex[]; ownerMarkets: Hex[] }> {
  const ot = addressTopic(owner);
  const [created, borrows, supplies] = await Promise.all([
    blockscoutLogs({ topic0: TOPIC.CreateMarket }, timeoutMs),
    blockscoutLogs({ topic0: TOPIC.Borrow, topic2: ot, topic0_2_opr: "and" }, timeoutMs),
    blockscoutLogs({ topic0: TOPIC.SupplyCollateral, topic3: ot, topic0_3_opr: "and" }, timeoutMs),
  ]);
  const id = (l: EtherscanLog) => (l.topics[1] ?? "").toLowerCase() as Hex;
  // Defensive: re-check the owner topic client-side.
  const ownerMarkets = [
    ...borrows.filter((l) => (l.topics[2] ?? "").toLowerCase() === ot).map(id),
    ...supplies.filter((l) => (l.topics[3] ?? "").toLowerCase() === ot).map(id),
  ];
  return { markets: created.map(id).filter(Boolean), ownerMarkets };
}

// ───────────────────────────── Market info ─────────────────────────────

export async function getMarketInfo(client: PublicClient, id: Hex): Promise<MarketInfo | null> {
  const key = id.toLowerCase();
  const cached = marketInfoCache.get(key);
  if (cached) return cached;
  const [loanToken, collateralToken, oracle, irm, lltv] = await client.readContract({ ...M, functionName: "idToMarketParams", args: [id] });
  const zero = /^0x0{40}$/i;
  if (zero.test(loanToken)) return null; // not a market
  const cfg = MORPHO_MARKETS.find((m) => eq(m.id, id));
  let info: MarketInfo;
  if (cfg) {
    // Allowlisted: labels/decimals from config, but on-chain params win if they ever differ.
    info = { ...fromConfig(cfg), loanToken, collateralToken, oracle, irm, lltv };
    if (!eq(cfg.oracle, oracle) || cfg.lltv !== lltv || !eq(cfg.irm, irm)) {
      morphoWarnings.push(`Market ${cfg.label}: on-chain params differ from config; using on-chain values.`);
    }
  } else {
    const ls = knownSymbol(loanToken);
    const cs = knownSymbol(collateralToken);
    if (!ls || ls === "BTC" || !cs || zero.test(oracle)) {
      morphoWarnings.push(`Morpho market ${id} skipped: tokens ${loanToken}/${collateralToken} have no USD valuation in MezoGuard.`);
      return null;
    }
    const [ld, cd] = await client.multicall({
      allowFailure: false,
      contracts: [
        { address: loanToken, abi: erc20Abi, functionName: "decimals" },
        { address: collateralToken, abi: erc20Abi, functionName: "decimals" },
      ],
    });
    info = {
      id: key as Hex, label: `${cs} / ${ls}`, loanToken, collateralToken, oracle, irm, lltv,
      loanAsset: { symbol: ls, address: loanToken, decimals: Number(ld) },
      collateralAsset: { symbol: cs, address: collateralToken, decimals: Number(cd) },
    };
  }
  marketInfoCache.set(key, info);
  return info;
}

// ───────────────────────────── Position building (pure) ─────────────────────────────

export interface RawMorphoReads {
  owner: Address;
  market: MarketInfo;
  borrowShares: bigint;
  collateral: bigint;
  state: MorphoMarketState;
  /** Per-second borrow rate (WAD) from IRM.borrowRateView. */
  borrowRate: bigint;
  oraclePrice: bigint;
  blockNumber: bigint;
  blockTimestamp: bigint;
  /** Mezo PriceFeed BTC price (USD 1e18) for collateralValueUsd; undefined → Morpho oracle USD is used. */
  mezoBtcUsd?: bigint;
}

export function morphoPositionId(id: Hex, owner: Address) {
  return `${id.toLowerCase()}:${owner}`;
}

export function buildMorphoPosition(r: RawMorphoReads, readAt = Date.now()): Position {
  const { market: mk } = r;
  const accrued = accrueInterest(r.state, r.borrowRate, r.blockTimestamp);
  const debt = borrowAssetsOf(r.borrowShares, accrued);
  const ld = mk.loanAsset.decimals;
  const cd = mk.collateralAsset.decimals;
  const oracleUsd = morphoOracleToUsd(r.oraclePrice, cd, ld);
  const price: PriceReading = {
    usd: oracleUsd,
    source: "morpho-oracle",
    sourceAddress: mk.oracle,
    updatedAt: Number(r.blockTimestamp),
    blockNumber: r.blockNumber,
    stale: false,
  };
  const params: MorphoParams = {
    kind: "morpho",
    marketId: mk.id,
    marketLabel: mk.label,
    loanToken: mk.loanToken,
    collateralToken: mk.collateralToken,
    oracle: mk.oracle,
    irm: mk.irm,
    lltv: mk.lltv,
    oraclePrice: r.oraclePrice,
    borrowApr: r.borrowRate * SECONDS_PER_YEAR,
  };
  const collUsd =
    mk.collateralAsset.symbol === "BTC"
      ? toUsd(r.collateral, cd, r.mezoBtcUsd ?? oracleUsd)
      : toUsd(r.collateral, cd, WAD); // MUSD collateral at $1
  const p: Position = {
    protocol: "morpho-blue",
    positionId: morphoPositionId(mk.id, r.owner),
    owner: r.owner,
    chainId: MEZO_TESTNET_ID,
    collateralAsset: mk.collateralAsset,
    collateralAmount: r.collateral,
    debtAsset: mk.loanAsset,
    debtAmount: debt,
    collateralValueUsd: collUsd,
    debtValueUsd: stableToUsd(debt, ld),
    collateralRatio: morphoCollateralRatio(r.collateral, r.oraclePrice, debt),
    liquidationRatio: morphoLiquidationRatio(mk.lltv),
    liquidationPriceUsd: 0n,
    price,
    status: r.borrowShares === 0n && r.collateral === 0n ? "closed" : "active",
    params,
    blockNumber: r.blockNumber,
    readAt,
  };
  p.liquidationPriceUsd = liquidationPrice(p);
  return p;
}

// ───────────────────────────── Live reads ─────────────────────────────

/** Reads (market, owner) for every market in one block. Returns raw reads for non-empty positions (or all if keepEmpty). */
export async function readMorphoPositions(
  client: PublicClient, owner: Address, markets: MarketInfo[], keepEmpty = false,
): Promise<RawMorphoReads[]> {
  if (markets.length === 0) return [];
  const contracts: ContractFunctionParameters[] = [
    { ...MC, functionName: "getBlockNumber" },
    { ...MC, functionName: "getCurrentBlockTimestamp" },
    ...markets.flatMap((m): ContractFunctionParameters[] => [
      { ...M, functionName: "position", args: [m.id, owner] },
      { ...M, functionName: "market", args: [m.id] },
      { address: m.oracle, abi: morphoOracleAbi, functionName: "price" },
    ]),
  ];
  const first = await client.multicall({ allowFailure: true, contracts });
  const bn = first[0];
  const ts = first[1];
  if (bn.status !== "success" || ts.status !== "success") throw new Error("Multicall3 block info failed");
  const blockNumber = bn.result as bigint;
  const blockTimestamp = ts.result as bigint;

  const open: { m: MarketInfo; pos: readonly [bigint, bigint, bigint]; mkt: readonly bigint[]; price: bigint }[] = [];
  markets.forEach((m, i) => {
    const pos = first[2 + 3 * i];
    const mkt = first[3 + 3 * i];
    const pr = first[4 + 3 * i];
    if (pos.status !== "success") throw new Error(`position(${m.label}) failed`);
    const p = pos.result as readonly [bigint, bigint, bigint];
    if (!keepEmpty && p[1] === 0n && p[2] === 0n) return;
    if (mkt.status !== "success") throw new Error(`market(${m.label}) failed`);
    if (pr.status !== "success") throw new Error(`oracle price for ${m.label} failed`);
    open.push({ m, pos: p, mkt: mkt.result as readonly bigint[], price: pr.result as bigint });
  });
  if (open.length === 0) return [];

  // borrowRateView at the SAME block as the market() snapshot.
  const rates = await client.multicall({
    allowFailure: true,
    blockNumber,
    contracts: open.map(({ m, mkt }) => ({
      address: m.irm,
      abi: morphoIrmAbi,
      functionName: "borrowRateView" as const,
      args: [
        { loanToken: m.loanToken, collateralToken: m.collateralToken, oracle: m.oracle, irm: m.irm, lltv: m.lltv },
        {
          totalSupplyAssets: mkt[0], totalSupplyShares: mkt[1], totalBorrowAssets: mkt[2],
          totalBorrowShares: mkt[3], lastUpdate: mkt[4], fee: mkt[5],
        },
      ] as const,
    })),
  });

  return open.map(({ m, pos, mkt, price }, i) => {
    const rr = rates[i];
    const zeroIrm = /^0x0{40}$/i.test(m.irm);
    if (rr.status !== "success" && !zeroIrm) throw new Error(`borrowRateView(${m.label}) failed`);
    return {
      owner,
      market: m,
      borrowShares: pos[1],
      collateral: pos[2],
      state: {
        totalSupplyAssets: mkt[0], totalSupplyShares: mkt[1], totalBorrowAssets: mkt[2],
        totalBorrowShares: mkt[3], lastUpdate: mkt[4], fee: mkt[5],
      },
      borrowRate: rr.status === "success" ? (rr.result as bigint) : 0n,
      oraclePrice: price,
      blockNumber,
      blockTimestamp,
    };
  });
}

async function mezoBtcUsdOrUndefined(client: PublicClient): Promise<bigint | undefined> {
  try {
    return (await readBtcPriceWith(client)).usd;
  } catch {
    return undefined;
  }
}

export interface MorphoDiscoverOptions {
  /** Wait for the full RPC event scan even if Blockscout answered (used by tests / the worker). */
  waitForRpcIndex?: boolean;
  concurrency?: number;
}

export async function discoverMorpho(client: PublicClient, owner: Address, opts: MorphoDiscoverOptions = {}): Promise<Position[]> {
  const idxPromise = ensureIndex(client, opts.concurrency);
  idxPromise.catch(() => undefined); // observed below
  let bs: { markets: Hex[]; ownerMarkets: Hex[] } | undefined;
  try {
    bs = await blockscoutCandidates(owner);
  } catch {
    bs = undefined;
  }
  if (!bs || opts.waitForRpcIndex || index.fullScanDone) {
    // No fast path, or the index only needs an incremental top-up: wait for it.
    try {
      await idxPromise;
    } catch (e) {
      if (!bs) throw new Error(`Morpho discovery failed: RPC log scan and Blockscout both unavailable (${(e as Error).message})`);
    }
  }
  const ids = new Set<string>(MORPHO_MARKETS.map((m) => m.id.toLowerCase()));
  for (const id of index.markets) ids.add(id);
  for (const id of index.owners.get(owner.toLowerCase()) ?? []) ids.add(id);
  for (const id of bs?.markets ?? []) ids.add(id);
  for (const id of bs?.ownerMarkets ?? []) ids.add(id);

  const infos = (await mapLimit([...ids], 6, (id) => getMarketInfo(client, id as Hex))).filter((x): x is MarketInfo => !!x);
  const [raws, btc] = await Promise.all([readMorphoPositions(client, owner, infos), mezoBtcUsdOrUndefined(client)]);
  return raws.map((r) => buildMorphoPosition({ ...r, mezoBtcUsd: btc }));
}

export function createMorphoMarketAdapter(getClient: () => PublicClient = getPublicClient, opts: MorphoDiscoverOptions = {}): ProtocolAdapter {
  return {
    id: "morpho-blue",
    label: "Morpho Blue",
    discover: (owner) => discoverMorpho(getClient(), owner, opts),
    async refresh(positionId: string): Promise<Position | null> {
      const m = /^(0x[0-9a-fA-F]{64}):(0x[0-9a-fA-F]{40})$/.exec(positionId);
      if (!m) return null;
      const client = getClient();
      const info = await getMarketInfo(client, m[1] as Hex);
      if (!info) return null;
      const [raws, btc] = await Promise.all([
        readMorphoPositions(client, m[2] as Address, [info], true),
        mezoBtcUsdOrUndefined(client),
      ]);
      return raws[0] ? buildMorphoPosition({ ...raws[0], mezoBtcUsd: btc }) : null;
    },
    reprice: repricePosition,
  };
}

export const morphoMarketAdapter: ProtocolAdapter = createMorphoMarketAdapter();

/** Unused-import guard for event ABI items referenced in docs. */
export const MORPHO_EVENTS = { EV_CREATE, EV_BORROW, EV_SUPPLY_COLL };
