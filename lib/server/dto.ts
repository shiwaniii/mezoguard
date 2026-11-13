/** DB row → HTTP DTO mappers (lib/api-types). */
import "./guard";
import type { AlertRuleDTO, NotificationDTO, TrackedWalletDTO, SettingsDTO, WorkerHealthDTO } from "@/lib/api-types";
import type { AlertRuleRow, DeliveryRow, HeartbeatRow, NotificationRow, TrackedWalletRow, UserRow } from "./db/repo";
import { emailConfigured } from "./notify/email";
import { telegramConfigured } from "./notify/telegram";
import { getAddress } from "viem";

const iso = (d: Date | string) => new Date(d).toISOString();
const checksum = (a: string) => {
  try {
    return getAddress(a);
  } catch {
    return a;
  }
};

export function walletDTO(r: TrackedWalletRow): TrackedWalletDTO {
  return { id: r.id, walletAddress: checksum(r.wallet_address), label: r.label, trackingStatus: r.tracking_status, createdAt: iso(r.created_at) };
}

/** `positionId` is the protocol position id (Trove borrower / `${marketId}:${owner}`), not the DB uuid. */
export function ruleDTO(r: AlertRuleRow & { protocol_position_id?: string | null }): AlertRuleDTO {
  return {
    id: r.id,
    walletAddress: checksum(r.wallet_address),
    positionId: r.position_id ? r.protocol_position_id ?? r.position_id : null,
    triggerType: r.trigger_type,
    threshold: r.threshold,
    channels: r.notification_channels,
    cooldownMinutes: r.cooldown_minutes,
    enabled: r.enabled,
    createdAt: iso(r.created_at),
  };
}

export function notificationDTO(n: NotificationRow, deliveries: DeliveryRow[]): NotificationDTO {
  const p = n.payload;
  return {
    id: n.id,
    alertType: n.alert_type,
    severity: n.severity,
    message: n.message,
    recommendedAction: n.recommended_action,
    payload: {
      wallet: p.wallet, protocol: p.protocol, positionId: p.positionId, collateralRatio: p.collateralRatio, btcPrice: p.btcPrice,
      liquidationPrice: p.liquidationPrice, riskLevel: p.riskLevel, link: p.link, timestamp: p.timestamp,
    },
    createdAt: iso(n.created_at),
    readAt: n.read_at ? iso(n.read_at) : null,
    resolvedAt: n.resolved_at ? iso(n.resolved_at) : null,
    deliveries: deliveries
      .filter((d) => d.notification_id === n.id)
      .map((d) => (d.error ? { channel: d.channel, status: d.status, error: d.error } : { channel: d.channel, status: d.status })),
  };
}

export function settingsDTO(u: UserRow): SettingsDTO {
  return {
    email: u.email,
    telegramChatId: u.telegram_chat_id,
    timezone: u.timezone,
    channelsAvailable: { email: emailConfigured(), telegram: telegramConfigured() },
  };
}

export function intervalSeconds(): number {
  const n = Number(process.env.MONITOR_INTERVAL_SECONDS ?? 60);
  return Number.isFinite(n) && n >= 5 ? n : 60;
}

export function healthDTO(h: HeartbeatRow | null, worker: string, now = Date.now()): WorkerHealthDTO {
  if (!h) return { worker, lastRunStartedAt: null, lastRunFinishedAt: null, lastStatus: null, lastError: null, runs: 0, healthy: false };
  const fin = h.last_run_finished_at ? new Date(h.last_run_finished_at).getTime() : 0;
  const healthy = fin > 0 && now - fin < 3 * intervalSeconds() * 1000 && h.last_status !== "error";
  return {
    worker: h.worker,
    lastRunStartedAt: h.last_run_started_at ? iso(h.last_run_started_at) : null,
    lastRunFinishedAt: h.last_run_finished_at ? iso(h.last_run_finished_at) : null,
    lastStatus: h.last_status,
    lastError: h.last_error,
    runs: Number(h.runs),
    healthy,
  };
}
