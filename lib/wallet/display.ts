/** Display helpers that are not money formatting (money lives in lib/format). */
import type { ProtocolId, RiskLevel } from "@/lib/risk/types";

export const RISK_LABEL: Record<RiskLevel, string> = {
  healthy: "Healthy",
  watch: "Watch",
  high: "High risk",
  critical: "Critical",
  liquidatable: "Liquidatable",
};

export const RISK_HELP: Record<RiskLevel, string> = {
  healthy: "Plenty of room before liquidation.",
  watch: "Still safe, but worth keeping an eye on.",
  high: "A moderate BTC drop could put this loan at risk.",
  critical: "Close to liquidation. Act now.",
  liquidatable: "Below the liquidation line. It can be liquidated at any moment.",
};

export const PROTOCOL_LABEL: Record<ProtocolId, string> = {
  "mezo-musd-trove": "MUSD Trove",
  "morpho-blue": "Morpho Blue",
};

export const PROTOCOL_SLUG: Record<ProtocolId, string> = {
  "mezo-musd-trove": "trove",
  "morpho-blue": "morpho",
};

export function protocolFromSlug(slug: string): ProtocolId | null {
  if (slug === "trove" || slug === "mezo-musd-trove") return "mezo-musd-trove";
  if (slug === "morpho" || slug === "morpho-blue") return "morpho-blue";
  return null;
}

export function positionHref(protocol: ProtocolId, positionId: string): string {
  return `/positions/${PROTOCOL_SLUG[protocol]}/${encodeURIComponent(positionId)}`;
}

export function relativeTime(fromMs: number, nowMs: number = Date.now()): string {
  const s = Math.max(0, Math.round((nowMs - fromMs) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return `${d} d ago`;
}

/** 1e18 → JS number (display/charts only). */
export function toNum(v: bigint, decimals = 18): number {
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = v % base;
  return Number(whole) + Number(frac) / Number(base);
}

/** JS number of USD → 1e18 bigint (simulator input). */
export function usdToWad(n: number): bigint {
  if (!Number.isFinite(n) || n < 0) return 0n;
  return BigInt(Math.round(n * 100)) * 10n ** 16n;
}

export function compactUsd(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(n);
}
