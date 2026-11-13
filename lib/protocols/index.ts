/** Protocol adapters — frozen public surface (docs/ARCHITECTURE.md). */
import type { Address } from "viem";
import type { ProtocolStatus } from "@/lib/api-types";
import type { Position, PriceReading, ProtocolAdapter, ProtocolId } from "@/lib/risk/types";
import { getPublicClient } from "@/lib/protocols/client";
import { readBtcPriceWith } from "@/lib/protocols/price";
import { mezoTroveAdapter } from "@/lib/protocols/mezo-trove";
import { morphoMarketAdapter } from "@/lib/protocols/morpho";
import { shortError } from "@/lib/protocols/price";

export { getPublicClient } from "@/lib/protocols/client";
export { mezoTroveAdapter, maxRepay, closeCost, getHints } from "@/lib/protocols/mezo-trove";
export { morphoMarketAdapter } from "@/lib/protocols/morpho";

export const adapters: ProtocolAdapter[] = [mezoTroveAdapter, morphoMarketAdapter];

export function getAdapter(id: ProtocolId): ProtocolAdapter | undefined {
  return adapters.find((a) => a.id === id);
}

/** Never throws: an adapter failure becomes status "error" (UI must not show "no loans" for it). */
export async function discoverAll(owner: Address): Promise<{ positions: Position[]; protocols: ProtocolStatus[] }> {
  const settled = await Promise.allSettled(adapters.map((a) => a.discover(owner)));
  const positions: Position[] = [];
  const protocols: ProtocolStatus[] = adapters.map((a, i) => {
    const r = settled[i];
    if (r.status === "fulfilled") {
      positions.push(...r.value);
      return { id: a.id, label: a.label, status: "ok", positions: r.value.length };
    }
    return { id: a.id, label: a.label, status: "error", error: shortError(r.reason), positions: 0 };
  });
  return { positions, protocols };
}

export function readBtcPrice(): Promise<PriceReading> {
  return readBtcPriceWith(getPublicClient());
}

export async function refreshPosition(protocol: ProtocolId, positionId: string): Promise<Position | null> {
  const a = getAdapter(protocol);
  if (!a) return null;
  return a.refresh(positionId);
}
