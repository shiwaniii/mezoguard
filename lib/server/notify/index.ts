/**
 * Channel fan-out. One notification_deliveries row per (notification, channel) — unique, so fan-out is idempotent.
 * Retryable provider failures (network, 429, 5xx) are retried up to MAX_ATTEMPTS with exponential backoff; the final
 * outcome (sent | failed | skipped + reason) is recorded with the attempt count. A notification's `delivered_at` is
 * set once every channel has a row, so a crash mid-fan-out resumes on the next cycle without re-sending.
 */
import "../guard";
import type { Db } from "../db";
import { deliveriesFor, getUser, insertDelivery, markDelivered, undeliveredNotifications, type Channel, type NotificationRow } from "../db/repo";
import { renderText } from "./message";
import { sendEmail } from "./email";
import { sendTelegram } from "./telegram";
import { deliverBrowser, deliverInApp } from "./inapp";
import type { ChannelResult, FetchLike } from "./types";
import { log } from "../log";

export const MAX_ATTEMPTS = 3;

export interface DeliverOpts {
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  baseDelayMs?: number;
}

export interface DeliverySummary {
  sent: number;
  failed: number;
  skipped: number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function withRetries(fn: () => Promise<ChannelResult>, opts: DeliverOpts): Promise<{ result: ChannelResult; attempts: number }> {
  const sleep = opts.sleep ?? defaultSleep;
  const base = opts.baseDelayMs ?? 500;
  let attempts = 0;
  let result: ChannelResult;
  for (;;) {
    attempts++;
    result = await fn();
    if (result.status !== "failed" || !result.retryable || attempts >= MAX_ATTEMPTS) break;
    await sleep(base * 2 ** (attempts - 1));
  }
  return { result, attempts };
}

async function channelsFor(db: Db, n: NotificationRow): Promise<Channel[]> {
  const set = new Set<Channel>(["in_app"]);
  if (n.rule_id) {
    const r = await db.query<{ notification_channels: Channel[] }>(`select notification_channels from alert_rules where id = $1`, [n.rule_id]);
    for (const c of r[0]?.notification_channels ?? []) set.add(c);
  }
  return [...set];
}

export async function deliverNotification(db: Db, n: NotificationRow, opts: DeliverOpts = {}): Promise<DeliverySummary> {
  const sum: DeliverySummary = { sent: 0, failed: 0, skipped: 0 };
  const channels = await channelsFor(db, n);
  const done = new Set((await deliveriesFor(db, [n.id])).map((d) => d.channel));
  const user = await getUser(db, n.user_id);
  const rendered = renderText({ headline: n.message, severity: n.severity, payload: n.payload, recommendedAction: n.recommended_action });
  const fetchImpl = opts.fetchImpl ?? fetch;

  for (const ch of channels) {
    if (done.has(ch)) continue;
    const { result, attempts } = await withRetries(async () => {
      switch (ch) {
        case "in_app":
          return deliverInApp();
        case "browser":
          return deliverBrowser();
        case "email":
          return sendEmail(user?.email ?? null, rendered, fetchImpl);
        case "telegram":
          return sendTelegram(user?.telegram_chat_id ?? null, rendered.text, fetchImpl);
        default:
          return { status: "skipped", reason: `unknown channel ${String(ch)}` } as ChannelResult;
      }
    }, opts);
    await insertDelivery(db, {
      notificationId: n.id,
      channel: ch,
      status: result.status,
      providerId: result.status === "sent" ? result.providerId ?? null : null,
      error: result.status === "failed" ? result.error : result.status === "skipped" ? result.reason : null,
      attempts,
    });
    sum[result.status]++;
    if (result.status === "failed") log.warn("delivery failed", { notificationId: n.id, channel: ch, attempts, error: result.error });
  }
  await markDelivered(db, n.id);
  return sum;
}

/** Delivers every notification whose fan-out hasn't completed (new ones from this cycle + any interrupted earlier). */
export async function deliverPending(db: Db, opts: DeliverOpts = {}): Promise<DeliverySummary> {
  const total: DeliverySummary = { sent: 0, failed: 0, skipped: 0 };
  for (const n of await undeliveredNotifications(db)) {
    try {
      const s = await deliverNotification(db, n, opts);
      total.sent += s.sent;
      total.failed += s.failed;
      total.skipped += s.skipped;
    } catch (e) {
      log.error("delivery fan-out error", { notificationId: n.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return total;
}

export { emailConfigured } from "./email";
export { telegramConfigured } from "./telegram";
