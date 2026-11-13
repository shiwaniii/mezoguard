/**
 * Renders the alert content shared by every channel (brief §Feature 7): wallet, protocol, position id, CR, BTC price,
 * liquidation price, risk level, recommended action with amounts, timestamp and a deep link.
 */
import "../guard";
import { fmtPct, fmtRatio, fmtUnits, fmtUsd } from "@/lib/format";
import type { Position, Recommendation, RiskAssessment, PriceReading } from "@/lib/risk/types";
import type { NotificationPayload } from "../db/repo";

export const PROTOCOL_LABEL: Record<Position["protocol"], string> = {
  "mezo-musd-trove": "Mezo MUSD Trove",
  "morpho-blue": "Morpho Blue",
};

export function appUrl(): string {
  return (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "");
}

export function positionLink(p: Pick<Position, "protocol" | "positionId">): string {
  return `${appUrl()}/positions/${p.protocol}/${encodeURIComponent(p.positionId)}`;
}

/** "Repay 512.3 MUSD or add 0.0123 BTC to reach 176% (estimate)". null when nothing is needed. */
export function recommendedActionText(p: Position, r: Recommendation | null): string | null {
  if (!r) return null;
  const parts: string[] = [];
  if (r.repayAmount > 0n && r.repayFeasible) parts.push(`repay ${fmtUnits(r.repayAmount, p.debtAsset.decimals)} ${p.debtAsset.symbol}`);
  if (r.addCollateral > 0n) parts.push(`add ${fmtUnits(r.addCollateral, p.collateralAsset.decimals, 6)} ${p.collateralAsset.symbol}`);
  if (!parts.length) {
    return r.repayNote ? `No repay possible: ${r.repayNote}` : null;
  }
  const s = parts.join(" or ");
  return `${s[0].toUpperCase()}${s.slice(1)} to reach ${fmtRatio(r.targetRatio)} (estimate)${r.repayNote ? `. Note: ${r.repayNote}` : ""}`;
}

export function buildPayload(args: {
  position: Position;
  assessment: RiskAssessment;
  btcPrice: PriceReading | null;
  recommendation: Recommendation | null;
  now: Date;
}): NotificationPayload {
  const { position: p, assessment: a, btcPrice } = args;
  const btc = btcPrice ?? p.price;
  return {
    wallet: p.owner,
    protocol: p.protocol,
    positionId: p.positionId,
    collateralRatio: p.collateralRatio.toString(),
    btcPrice: btc.usd.toString(),
    liquidationPrice: p.liquidationPriceUsd.toString(),
    riskLevel: a.level,
    link: positionLink(p),
    timestamp: args.now.toISOString(),
    priceStale: btc.stale || p.price.stale || a.stale,
    display: {
      collateralRatio: fmtRatio(p.collateralRatio),
      liquidationRatio: fmtRatio(p.liquidationRatio),
      btcPrice: fmtUsd(btc.usd),
      liquidationPrice: fmtUsd(p.liquidationPriceUsd),
      priceDeclineBuffer: fmtPct(a.priceDeclineBuffer, 1),
      collateral: `${fmtUnits(p.collateralAmount, p.collateralAsset.decimals, 6)} ${p.collateralAsset.symbol}`,
      debt: `${fmtUnits(p.debtAmount, p.debtAsset.decimals)} ${p.debtAsset.symbol}`,
      protocol: PROTOCOL_LABEL[p.protocol],
    },
  };
}

export interface RenderInput {
  headline: string;
  severity: string;
  payload: NotificationPayload;
  recommendedAction: string | null;
}

/** Single-paragraph message stored in notifications.message (also the in-app text). */
export function messageLine(r: RenderInput): string {
  const d = (r.payload.display ?? {}) as Record<string, string>;
  return `${r.headline}. ${d.protocol ?? r.payload.protocol} position ${short(r.payload.positionId)}: CR ${d.collateralRatio ?? "?"}, liquidation at ${d.liquidationPrice ?? "?"} (BTC ${d.btcPrice ?? "?"}), level ${r.payload.riskLevel.toUpperCase()}.`;
}

/** Multi-line plain text used by email + Telegram. */
export function renderText(r: RenderInput): { subject: string; text: string } {
  const p = r.payload;
  const d = (p.display ?? {}) as Record<string, string>;
  const lines = [
    `MezoGuard alert [${r.severity.toUpperCase()}]`,
    r.headline,
    "",
    `Wallet: ${p.wallet}`,
    `Protocol: ${d.protocol ?? p.protocol}`,
    `Position: ${p.positionId}`,
    `Collateral ratio: ${d.collateralRatio ?? p.collateralRatio}${d.liquidationRatio ? ` (liquidation at ${d.liquidationRatio})` : ""}`,
    `BTC price: ${d.btcPrice ?? p.btcPrice}${p.priceStale ? " (STALE — not real-time)" : ""}`,
    `Liquidation price: ${d.liquidationPrice ?? p.liquidationPrice}`,
    `Risk level: ${p.riskLevel.toUpperCase()}`,
    `Recommended action: ${r.recommendedAction ?? "none at current price"}`,
    `Time: ${p.timestamp}`,
    "",
    `Open: ${p.link}`,
  ];
  return { subject: `MezoGuard ${r.severity.toUpperCase()}: ${r.headline}`.slice(0, 180), text: lines.join("\n") };
}

const short = (id: string) => (id.length > 24 ? `${id.slice(0, 10)}…${id.slice(-6)}` : id);
