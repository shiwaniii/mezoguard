/**
 * FROZEN — JSON shapes of the HTTP API (docs/ARCHITECTURE.md §API). bigint fields travel as decimal strings.
 * Use `serialize()` / `deserializePosition()` from lib/risk/serialize.ts (owned by the risk agent) to convert.
 */
import type { Position, RiskAssessment, PortfolioSummary, PriceReading, Recommendation, RiskLevel, ProtocolId } from "@/lib/risk/types";

/** Recursively turns bigint → string. */
export type Wire<T> = T extends bigint ? string
  : T extends (infer U)[] ? Wire<U>[]
  : T extends object ? { [K in keyof T]: Wire<T[K]> }
  : T;

export interface ProtocolStatus {
  id: ProtocolId;
  label: string;
  /** "ok" = scanned; "error" = adapter failed (positions from it are missing, show a warning, never "no loans"). */
  status: "ok" | "error";
  error?: string;
  positions: number;
}

export interface PortfolioResponse {
  owner: string;
  chainId: number;
  positions: Wire<Position>[];
  assessments: Wire<RiskAssessment>[];
  recommendations: Wire<Recommendation>[];
  summary: Wire<PortfolioSummary>;
  btcPrice: Wire<PriceReading>;
  protocols: ProtocolStatus[];
  /** Unix ms when read from chain. */
  readAt: number;
}

export interface PositionDetailResponse {
  position: Wire<Position>;
  assessment: Wire<RiskAssessment>;
  recommendation: Wire<Recommendation>;
  /** From risk_snapshots (empty if DB not configured or never tracked). */
  history: { timestamp: string; btcPrice: string; collateralRatio: string; riskLevel: RiskLevel; liquidationPrice: string; priceStale: boolean }[];
  historyAvailable: boolean;
}

export interface SessionResponse { address: string | null; userId: string | null; dbEnabled: boolean }

export type AlertTriggerType = "cr_below" | "btc_drop_pct" | "level_at_least" | "redemption" | "liquidation_price_within_pct";

export interface AlertRuleDTO {
  id: string;
  walletAddress: string;
  positionId: string | null;
  triggerType: AlertTriggerType;
  threshold: string;
  channels: ("in_app" | "email" | "telegram" | "browser")[];
  cooldownMinutes: number;
  enabled: boolean;
  createdAt: string;
}

export interface NotificationDTO {
  id: string;
  alertType: string;
  severity: "info" | "watch" | "high" | "critical";
  message: string;
  recommendedAction: string | null;
  payload: {
    wallet: string; protocol: ProtocolId; positionId: string; collateralRatio: string; btcPrice: string;
    liquidationPrice: string; riskLevel: RiskLevel; link: string; timestamp: string;
  };
  createdAt: string;
  readAt: string | null;
  resolvedAt: string | null;
  deliveries: { channel: string; status: "sent" | "failed" | "skipped"; error?: string }[];
}

export interface TrackedWalletDTO { id: string; walletAddress: string; label: string | null; trackingStatus: "active" | "paused"; createdAt: string }

export interface SettingsDTO { email: string | null; telegramChatId: string | null; timezone: string; channelsAvailable: { email: boolean; telegram: boolean } }

export interface WorkerHealthDTO {
  worker: string; lastRunStartedAt: string | null; lastRunFinishedAt: string | null; lastStatus: string | null;
  lastError: string | null; runs: number; healthy: boolean;
}

export interface ApiError { error: string; code?: string }
