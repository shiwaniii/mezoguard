/** Live portfolio reads for the HTTP API (works without a database). */
import "./guard";
import type { Address } from "viem";
import { discoverAll, readBtcPrice, refreshPosition } from "@/lib/protocols";
import { assess, recommend, summarize, toWire } from "@/lib/risk";
import type { PortfolioResponse, PositionDetailResponse } from "@/lib/api-types";
import type { ProtocolId } from "@/lib/risk/types";
import { MEZO_TESTNET_ID } from "@/lib/chain/config";
import { TtlCache } from "./cache";
import { getDb } from "./db";
import { findPosition, snapshotHistory } from "./db/repo";

export const PORTFOLIO_TTL_MS = 10_000;
const portfolioCache = new TtlCache<PortfolioResponse>(PORTFOLIO_TTL_MS);

export async function buildPortfolio(owner: Address): Promise<PortfolioResponse> {
  const [{ positions, protocols }, btcPrice] = await Promise.all([discoverAll(owner), readBtcPrice()]);
  const readAt = Date.now();
  return {
    owner,
    chainId: MEZO_TESTNET_ID,
    positions: positions.map((p) => toWire(p)),
    assessments: positions.map((p) => toWire(assess(p))),
    recommendations: positions.map((p) => toWire(recommend(p))),
    summary: toWire(summarize(owner, positions)),
    btcPrice: toWire(btcPrice),
    protocols,
    readAt,
  };
}

export async function getPortfolioCached(owner: Address): Promise<{ value: PortfolioResponse; cached: boolean }> {
  return portfolioCache.get(owner.toLowerCase(), () => buildPortfolio(owner));
}

export const PROTOCOL_IDS: ProtocolId[] = ["mezo-musd-trove", "morpho-blue"];

export async function buildPositionDetail(protocol: ProtocolId, positionId: string): Promise<PositionDetailResponse | null> {
  const p = await refreshPosition(protocol, positionId);
  if (!p) return null;
  const db = getDb();
  let history: PositionDetailResponse["history"] = [];
  let historyAvailable = false;
  if (db) {
    try {
      const row = await findPosition(db, protocol, p.positionId);
      if (row) {
        historyAvailable = true;
        history = (await snapshotHistory(db, row.id)).map((s) => ({
          timestamp: new Date(s.timestamp).toISOString(),
          btcPrice: s.btc_price,
          collateralRatio: s.collateral_ratio,
          riskLevel: s.risk_level,
          liquidationPrice: s.liquidation_price,
          priceStale: s.price_stale,
        }));
      }
    } catch {
      historyAvailable = false;
    }
  }
  return { position: toWire(p), assessment: toWire(assess(p)), recommendation: toWire(recommend(p)), history, historyAvailable };
}
