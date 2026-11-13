/**
 * Browser-safe adapters for the simulator and charts. The adapters in lib/protocols carry RPC code, so the browser
 * uses the same pure `repricePosition` they delegate to (lib/risk/valuation): Trove ICR = coll × price / debt,
 * Morpho ratio = coll × oraclePrice / 1e36 / borrowAssets with the oracle derived from the USD price.
 */
import { repricePosition } from "@/lib/risk";
import type { Position, ProtocolAdapter, ProtocolId } from "@/lib/risk/types";

const WAD = 10n ** 18n;
export { repricePosition };

function clientAdapter(id: ProtocolId, label: string): ProtocolAdapter {
  return {
    id,
    label,
    discover: () => Promise.reject(new Error("Discovery runs on the server")),
    refresh: () => Promise.reject(new Error("Refresh runs on the server")),
    reprice: repricePosition,
  };
}

export const clientAdapters: Record<ProtocolId, ProtocolAdapter> = {
  "mezo-musd-trove": clientAdapter("mezo-musd-trove", "MUSD Trove"),
  "morpho-blue": clientAdapter("morpho-blue", "Morpho Blue"),
};

/** True when the position's collateral moves with BTC (BTC collateral). MUSD-collateral markets do not. */
export function tracksBtc(p: Position): boolean {
  return p.collateralAsset.symbol.toUpperCase() === "BTC";
}

/**
 * The simulator moves one "BTC price". Each position's own oracle is scaled by the same proportion:
 * newPrice = ownPrice × simulatedBtc / currentBtc. Non-BTC collateral keeps its price.
 */
export function scaledCollateralPrice(p: Position, simulatedBtcUsd: bigint, currentBtcUsd: bigint): bigint {
  if (!tracksBtc(p) || currentBtcUsd <= 0n) return p.price.usd;
  return (p.price.usd * simulatedBtcUsd) / currentBtcUsd;
}

/** BTC price change as a 1e18 fraction (e.g. -0.1e18 for -10%). */
export function pctChange(from: bigint, to: bigint): bigint {
  if (from === 0n) return 0n;
  return ((to - from) * WAD) / from;
}

export function applyPct(price: bigint, pct: number): bigint {
  // pct in whole percent, e.g. -10 → price × 0.90 (basis-point precision)
  const bps = BigInt(Math.round(pct * 100));
  return (price * (10_000n + bps)) / 10_000n;
}
