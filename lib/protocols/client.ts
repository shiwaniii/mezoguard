/**
 * viem PublicClient for Mezo testnet + chunked getLogs helper.
 *
 * - http transport with retry (exponential backoff, viem's built-in `retryCount`/`retryDelay`) and a per-request timeout.
 * - `batch.multicall` coalesces concurrent `readContract` calls into Multicall3 (deployed at the canonical address).
 * - `getLogsChunked` splits a block range into windows of ≤ LOG_RANGE_CAP (rpc.test.mezo.org rejects > 10,000 blocks)
 *   and runs them with a concurrency limit.
 */
import {
  createPublicClient,
  http,
  parseAbi,
  toEventSelector,
  type AbiEvent,
  type Address,
  type Hex,
  type Log,
  type PublicClient,
} from "viem";
import { LOG_RANGE_CAP, mezoTestnet } from "@/lib/chain/config";

/** Multicall3 helpers that let one aggregate call also report the block it ran in. */
export const multicall3Abi = parseAbi([
  "function getBlockNumber() view returns (uint256 blockNumber)",
  "function getCurrentBlockTimestamp() view returns (uint256 timestamp)",
]);
export const MULTICALL3: Address = mezoTestnet.contracts.multicall3.address;

/** Calldata bytes per Multicall3 chunk. viem's default (1 KiB) produces too many round trips for 300+ trove scans. */
export const MULTICALL_BATCH_BYTES = 24_000;

let cached: PublicClient | undefined;

export function createMezoClient(rpcUrl?: string): PublicClient {
  const url = rpcUrl ?? mezoTestnet.rpcUrls.default.http[0];
  const client = createPublicClient({
    chain: mezoTestnet,
    transport: http(url, {
      retryCount: 4,
      // viem backs off exponentially: delay * 2^attempt (300, 600, 1200, 2400 ms).
      retryDelay: 300,
      timeout: 20_000,
    }),
    batch: { multicall: { batchSize: MULTICALL_BATCH_BYTES, wait: 10 } },
  });
  return client as unknown as PublicClient;
}

export function getPublicClient(): PublicClient {
  if (!cached) cached = createMezoClient();
  return cached;
}

/** Test hook: replace the singleton (e.g. with a mock). */
export function setPublicClient(c: PublicClient | undefined): void {
  cached = c;
}

/** Splits [from, to] (inclusive) into windows where `end - start ≤ cap`. */
export function chunkRange(from: bigint, to: bigint, cap: bigint = LOG_RANGE_CAP): { from: bigint; to: bigint }[] {
  if (to < from) return [];
  if (cap < 0n) throw new Error("cap must be ≥ 0");
  const out: { from: bigint; to: bigint }[] = [];
  for (let s = from; s <= to; s += cap + 1n) {
    const e = s + cap > to ? to : s + cap;
    out.push({ from: s, to: e });
  }
  return out;
}

/** Runs `fn` over `items` with at most `limit` in flight; preserves order of results. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

export interface ChunkedLogsQuery {
  address: Address;
  /** topic0 is derived from `event` unless `topic0` is given (single selector or OR-list). */
  event?: AbiEvent;
  topic0?: Hex | Hex[];
  /** Raw topic filter after topic0. `null` = wildcard. */
  topics?: (Hex | Hex[] | null)[];
  fromBlock: bigint;
  toBlock: bigint;
  concurrency?: number;
}

/**
 * eth_getLogs over an arbitrary range, chunked to ≤ LOG_RANGE_CAP blocks per request.
 * Uses raw topics so callers can filter on any indexed position (e.g. onBehalf as topic2 or topic3).
 */
export async function getLogsChunked(client: PublicClient, q: ChunkedLogsQuery): Promise<Log[]> {
  const topic0 = q.topic0 ?? (q.event ? toEventSelector(q.event) : null);
  if (!topic0) throw new Error("getLogsChunked: event or topic0 required");
  const topics = [topic0, ...(q.topics ?? [])];
  const windows = chunkRange(q.fromBlock, q.toBlock);
  const results = await mapLimit(windows, q.concurrency ?? 12, async (w) => {
    return (await client.request({
      method: "eth_getLogs",
      params: [{ address: q.address, topics, fromBlock: toHex(w.from), toBlock: toHex(w.to) }],
    })) as unknown as RawLog[];
  });
  return results.flat().map(normalizeRawLog);
}

interface RawLog {
  address: Address;
  topics: Hex[];
  data: Hex;
  blockNumber: Hex | null;
  transactionHash: Hex | null;
  logIndex: Hex | null;
  blockHash: Hex | null;
  transactionIndex: Hex | null;
  removed?: boolean;
}

function toHex(n: bigint): Hex {
  return `0x${n.toString(16)}`;
}

function normalizeRawLog(l: RawLog): Log {
  return {
    address: l.address,
    topics: l.topics as [Hex, ...Hex[]],
    data: l.data,
    blockNumber: l.blockNumber ? BigInt(l.blockNumber) : null,
    transactionHash: l.transactionHash,
    logIndex: l.logIndex ? Number(BigInt(l.logIndex)) : null,
    blockHash: l.blockHash,
    transactionIndex: l.transactionIndex ? Number(BigInt(l.transactionIndex)) : null,
    removed: l.removed ?? false,
  } as Log;
}

/** Left-pads an address to a 32-byte topic. */
export function addressTopic(a: Address): Hex {
  return `0x${a.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
}

/** Extracts the address from a 32-byte topic. */
export function topicToAddress(t: Hex): Address {
  return `0x${t.slice(-40)}` as Address;
}
