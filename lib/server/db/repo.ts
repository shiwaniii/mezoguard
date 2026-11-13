/**
 * Typed repositories over schema.sql. Wallet addresses are stored lowercase. numeric(78,0) columns travel as
 * decimal strings and are converted to bigint at the edges (`big()`); never through JS numbers.
 */
import "../guard";
import type { Db } from "./index";
import { pgTextArray } from "./index";
import type { AlertTriggerType } from "@/lib/api-types";
import type { Position, RiskLevel, ProtocolId } from "@/lib/risk/types";

export const lc = (a: string) => a.toLowerCase();
export const big = (v: unknown): bigint => (v === null || v === undefined ? 0n : BigInt(String(v)));
const iso = (d: unknown): string | null => (d ? new Date(d as string).toISOString() : null);

// ---------------- users ----------------
export interface UserRow {
  id: string;
  wallet_address: string;
  email: string | null;
  telegram_chat_id: string | null;
  timezone: string;
  created_at: Date;
  last_active_at: Date;
}

export async function upsertUser(db: Db, wallet: string): Promise<UserRow> {
  const rows = await db.query<UserRow>(
    `insert into users (wallet_address) values ($1)
     on conflict (wallet_address) do update set last_active_at = now()
     returning *`,
    [lc(wallet)],
  );
  return rows[0];
}

export async function getUser(db: Db, id: string): Promise<UserRow | null> {
  return (await db.query<UserRow>(`select * from users where id = $1`, [id]))[0] ?? null;
}

export async function updateUserSettings(
  db: Db,
  id: string,
  s: { email?: string | null; telegramChatId?: string | null; timezone?: string },
): Promise<UserRow | null> {
  const rows = await db.query<UserRow>(
    `update users set
       email = case when $2::boolean then $3 else email end,
       telegram_chat_id = case when $4::boolean then $5 else telegram_chat_id end,
       timezone = coalesce($6, timezone)
     where id = $1 returning *`,
    [id, s.email !== undefined, s.email ?? null, s.telegramChatId !== undefined, s.telegramChatId ?? null, s.timezone ?? null],
  );
  return rows[0] ?? null;
}

// ---------------- tracked wallets ----------------
export interface TrackedWalletRow {
  id: string;
  user_id: string;
  wallet_address: string;
  chain_id: number;
  label: string | null;
  tracking_status: "active" | "paused";
  created_at: Date;
}

export async function listTrackedWallets(db: Db, userId: string): Promise<TrackedWalletRow[]> {
  return db.query<TrackedWalletRow>(`select * from tracked_wallets where user_id = $1 order by created_at`, [userId]);
}

export async function addTrackedWallet(db: Db, userId: string, wallet: string, label: string | null): Promise<TrackedWalletRow> {
  const rows = await db.query<TrackedWalletRow>(
    `insert into tracked_wallets (user_id, wallet_address, label) values ($1, $2, $3)
     on conflict (user_id, wallet_address, chain_id) do update set label = coalesce(excluded.label, tracked_wallets.label)
     returning *`,
    [userId, lc(wallet), label],
  );
  return rows[0];
}

export async function updateTrackedWallet(
  db: Db,
  userId: string,
  id: string,
  patch: { label?: string | null; trackingStatus?: "active" | "paused" },
): Promise<TrackedWalletRow | null> {
  const rows = await db.query<TrackedWalletRow>(
    `update tracked_wallets set
       label = case when $3::boolean then $4 else label end,
       tracking_status = coalesce($5, tracking_status)
     where id = $1 and user_id = $2 returning *`,
    [id, userId, patch.label !== undefined, patch.label ?? null, patch.trackingStatus ?? null],
  );
  return rows[0] ?? null;
}

export async function deleteTrackedWallet(db: Db, userId: string, id: string): Promise<boolean> {
  const rows = await db.query(`delete from tracked_wallets where id = $1 and user_id = $2 returning id`, [id, userId]);
  return rows.length > 0;
}

/** Every wallet the monitor must scan: active tracked wallets + each user's own wallet, with the users watching it. */
export async function walletsToMonitor(db: Db): Promise<{ wallet: string; userIds: string[] }[]> {
  const rows = await db.query<{ wallet: string; user_ids: string[] }>(
    `select wallet, array_agg(distinct user_id::text) as user_ids from (
       select wallet_address as wallet, user_id from tracked_wallets where tracking_status = 'active' and chain_id = 31611
       union all
       select wallet_address as wallet, id as user_id from users
     ) w group by wallet order by wallet`,
  );
  return rows.map((r) => ({ wallet: r.wallet, userIds: r.user_ids }));
}

// ---------------- loan positions ----------------
export interface LoanPositionRow {
  id: string;
  wallet_address: string;
  protocol_id: ProtocolId;
  protocol_position_id: string;
  collateral_asset: string;
  collateral_amount: string;
  debt_asset: string;
  debt_amount: string;
  collateral_value: string;
  collateral_ratio: string;
  liquidation_price: string;
  risk_level: RiskLevel;
  status: string;
  last_synced_at: Date;
  onchain_updated_at: Date | null;
  onchain_block: string | null;
}

export async function upsertPosition(db: Db, p: Position, level: RiskLevel): Promise<LoanPositionRow> {
  const rows = await db.query<LoanPositionRow>(
    `insert into loan_positions (wallet_address, protocol_id, protocol_position_id, collateral_asset, collateral_amount,
        debt_asset, debt_amount, collateral_value, collateral_ratio, liquidation_price, risk_level, status,
        last_synced_at, onchain_updated_at, onchain_block)
     values ($1,$2,$3,$4,$5::text::numeric,$6,$7::text::numeric,$8::text::numeric,$9::text::numeric,$10::text::numeric,$11,$12,now(),$13,$14::text::bigint)
     on conflict (protocol_id, protocol_position_id) do update set
        wallet_address = excluded.wallet_address, collateral_asset = excluded.collateral_asset,
        collateral_amount = excluded.collateral_amount, debt_asset = excluded.debt_asset, debt_amount = excluded.debt_amount,
        collateral_value = excluded.collateral_value, collateral_ratio = excluded.collateral_ratio,
        liquidation_price = excluded.liquidation_price, risk_level = excluded.risk_level, status = excluded.status,
        last_synced_at = now(), onchain_updated_at = excluded.onchain_updated_at, onchain_block = excluded.onchain_block
     returning *`,
    [
      lc(p.owner), p.protocol, p.positionId, p.collateralAsset.symbol, p.collateralAmount.toString(), p.debtAsset.symbol,
      p.debtAmount.toString(), p.collateralValueUsd.toString(), p.collateralRatio.toString(), p.liquidationPriceUsd.toString(),
      level, p.status, new Date(p.readAt), p.blockNumber.toString(),
    ],
  );
  return rows[0];
}

export async function activePositionsForWallet(db: Db, wallet: string): Promise<LoanPositionRow[]> {
  return db.query<LoanPositionRow>(`select * from loan_positions where wallet_address = $1 and status = 'active'`, [lc(wallet)]);
}

export async function markPositionsClosed(db: Db, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await db.query(`update loan_positions set status = 'closed', last_synced_at = now() where id = any($1::text::uuid[])`, [pgTextArray(ids)]);
}

export async function findPosition(db: Db, protocol: string, protocolPositionId: string): Promise<LoanPositionRow | null> {
  return (
    (await db.query<LoanPositionRow>(`select * from loan_positions where protocol_id = $1 and lower(protocol_position_id) = lower($2)`, [
      protocol,
      protocolPositionId,
    ]))[0] ?? null
  );
}

export async function findPositionByAnyId(db: Db, idOrProtocolId: string, wallet?: string): Promise<LoanPositionRow | null> {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrProtocolId);
  const rows = await db.query<LoanPositionRow>(
    isUuid
      ? `select * from loan_positions where id = $1::uuid`
      : `select * from loan_positions where lower(protocol_position_id) = lower($1) and ($2::text is null or wallet_address = $2)`,
    isUuid ? [idOrProtocolId] : [idOrProtocolId, wallet ? lc(wallet) : null],
  );
  return rows[0] ?? null;
}

export async function getPositionsByIds(db: Db, ids: string[]): Promise<LoanPositionRow[]> {
  if (!ids.length) return [];
  return db.query<LoanPositionRow>(`select * from loan_positions where id = any($1::text::uuid[])`, [pgTextArray(ids)]);
}

// ---------------- snapshots ----------------
export interface SnapshotInput {
  positionId: string;
  btcPrice: bigint;
  priceStale: boolean;
  collateralValue: bigint;
  debtValue: bigint;
  collateralRatio: bigint;
  liquidationPrice: bigint;
  riskLevel: RiskLevel;
  blockNumber: bigint | null;
}

export async function insertSnapshot(db: Db, s: SnapshotInput): Promise<void> {
  await db.query(
    `insert into risk_snapshots (position_id, btc_price, price_stale, collateral_value, debt_value, collateral_ratio,
        liquidation_price, risk_level, block_number)
     values ($1, $2::text::numeric, $3, $4::text::numeric, $5::text::numeric, $6::text::numeric, $7::text::numeric, $8, $9::text::bigint)`,
    [
      s.positionId, s.btcPrice.toString(), s.priceStale, s.collateralValue.toString(), s.debtValue.toString(),
      s.collateralRatio.toString(), s.liquidationPrice.toString(), s.riskLevel, s.blockNumber === null ? null : s.blockNumber.toString(),
    ],
  );
}

export interface SnapshotRow {
  timestamp: Date;
  btc_price: string;
  collateral_ratio: string;
  risk_level: RiskLevel;
  liquidation_price: string;
  price_stale: boolean;
}

export async function snapshotHistory(db: Db, positionUuid: string, limit = 500): Promise<SnapshotRow[]> {
  const rows = await db.query<SnapshotRow>(
    `select timestamp, btc_price, collateral_ratio, risk_level, liquidation_price, price_stale
     from risk_snapshots where position_id = $1 order by timestamp desc limit $2`,
    [positionUuid, limit],
  );
  return rows.reverse();
}

// ---------------- alert rules ----------------
export type Channel = "in_app" | "email" | "telegram" | "browser";
export interface AlertRuleRow {
  id: string;
  user_id: string;
  wallet_address: string;
  position_id: string | null;
  trigger_type: AlertTriggerType;
  threshold: string;
  notification_channels: Channel[];
  cooldown_minutes: number;
  enabled: boolean;
  created_at: Date;
}

export async function listRules(db: Db, userId: string): Promise<(AlertRuleRow & { protocol_position_id: string | null })[]> {
  return db.query(
    `select r.*, lp.protocol_position_id from alert_rules r left join loan_positions lp on lp.id = r.position_id
     where r.user_id = $1 order by r.created_at`,
    [userId],
  );
}

export async function getRule(db: Db, userId: string, id: string) {
  return (
    (await db.query<AlertRuleRow & { protocol_position_id: string | null }>(
      `select r.*, lp.protocol_position_id from alert_rules r left join loan_positions lp on lp.id = r.position_id
       where r.user_id = $1 and r.id = $2`,
      [userId, id],
    ))[0] ?? null
  );
}

export async function createRule(
  db: Db,
  r: { userId: string; wallet: string; positionUuid: string | null; triggerType: AlertTriggerType; threshold: string; channels: Channel[]; cooldownMinutes: number; enabled: boolean },
): Promise<AlertRuleRow> {
  const rows = await db.query<AlertRuleRow>(
    `insert into alert_rules (user_id, wallet_address, position_id, trigger_type, threshold, notification_channels, cooldown_minutes, enabled)
     values ($1, $2, $3, $4, $5, $6::text::text[], $7, $8) returning *`,
    [r.userId, lc(r.wallet), r.positionUuid, r.triggerType, r.threshold, pgTextArray(r.channels), r.cooldownMinutes, r.enabled],
  );
  return rows[0];
}

export async function updateRule(
  db: Db,
  userId: string,
  id: string,
  patch: { threshold?: string; channels?: Channel[]; cooldownMinutes?: number; enabled?: boolean },
): Promise<AlertRuleRow | null> {
  const rows = await db.query<AlertRuleRow>(
    `update alert_rules set
       threshold = coalesce($3, threshold),
       notification_channels = coalesce($4::text::text[], notification_channels),
       cooldown_minutes = coalesce($5, cooldown_minutes),
       enabled = coalesce($6, enabled)
     where id = $1 and user_id = $2 returning *`,
    [id, userId, patch.threshold ?? null, patch.channels ? pgTextArray(patch.channels) : null, patch.cooldownMinutes ?? null, patch.enabled ?? null],
  );
  // A changed threshold is a new rule definition: re-arm all its edge state.
  if (rows[0] && patch.threshold !== undefined) await db.query(`delete from alert_rule_state where rule_id = $1`, [id]);
  return rows[0] ?? null;
}

export async function deleteRule(db: Db, userId: string, id: string): Promise<boolean> {
  return (await db.query(`delete from alert_rules where id = $1 and user_id = $2 returning id`, [id, userId])).length > 0;
}

export async function enabledRulesForWallet(db: Db, wallet: string): Promise<AlertRuleRow[]> {
  return db.query<AlertRuleRow>(`select * from alert_rules where wallet_address = $1 and enabled = true order by created_at`, [lc(wallet)]);
}

// ---------------- rule state ----------------
export interface RuleStateRow {
  rule_id: string;
  position_id: string;
  armed: boolean;
  last_fired_at: Date | null;
  last_value: string | null;
}

export async function getRuleState(db: Db, ruleId: string, positionId: string): Promise<RuleStateRow | null> {
  return (await db.query<RuleStateRow>(`select * from alert_rule_state where rule_id = $1 and position_id = $2`, [ruleId, positionId]))[0] ?? null;
}

export async function putRuleState(db: Db, s: { ruleId: string; positionId: string; armed: boolean; lastFiredAt: Date | null; lastValue: string | null }) {
  await db.query(
    `insert into alert_rule_state (rule_id, position_id, armed, last_fired_at, last_value) values ($1, $2, $3, $4, $5)
     on conflict (rule_id, position_id) do update set armed = excluded.armed, last_fired_at = excluded.last_fired_at, last_value = excluded.last_value`,
    [s.ruleId, s.positionId, s.armed, s.lastFiredAt, s.lastValue],
  );
}

// ---------------- notifications ----------------
export type Severity = "info" | "watch" | "high" | "critical";
export interface NotificationPayload {
  wallet: string;
  protocol: ProtocolId;
  positionId: string;
  collateralRatio: string;
  btcPrice: string;
  liquidationPrice: string;
  riskLevel: RiskLevel;
  link: string;
  timestamp: string;
  /** Extra fields (not in the DTO contract) used by channel renderers. */
  [extra: string]: unknown;
}
export interface NotificationRow {
  id: string;
  user_id: string;
  position_id: string | null;
  rule_id: string | null;
  alert_type: string;
  severity: Severity;
  message: string;
  recommended_action: string | null;
  payload: NotificationPayload;
  dedupe_key: string;
  created_at: Date;
  delivered_at: Date | null;
  read_at: Date | null;
  resolved_at: Date | null;
}

/** Inserts unless dedupe_key exists. Returns the new row, or null if it was a duplicate. */
export async function insertNotification(
  db: Db,
  n: { userId: string; positionId: string | null; ruleId: string | null; alertType: string; severity: Severity; message: string; recommendedAction: string | null; payload: NotificationPayload; dedupeKey: string },
): Promise<NotificationRow | null> {
  const rows = await db.query<NotificationRow>(
    `insert into notifications (user_id, position_id, rule_id, alert_type, severity, message, recommended_action, payload, dedupe_key)
     values ($1, $2, $3, $4, $5, $6, $7, $8::text::jsonb, $9)
     on conflict (dedupe_key) do nothing returning *`,
    [n.userId, n.positionId, n.ruleId, n.alertType, n.severity, n.message, n.recommendedAction, JSON.stringify(n.payload), n.dedupeKey],
  );
  return rows[0] ?? null;
}

export async function listNotifications(db: Db, userId: string, unreadOnly: boolean, limit = 100): Promise<NotificationRow[]> {
  return db.query<NotificationRow>(
    `select * from notifications where user_id = $1 and ($2::boolean = false or read_at is null) order by created_at desc limit $3`,
    [userId, unreadOnly, limit],
  );
}

export async function markNotificationRead(db: Db, userId: string, id: string): Promise<boolean> {
  return (await db.query(`update notifications set read_at = coalesce(read_at, now()) where id = $1 and user_id = $2 returning id`, [id, userId])).length > 0;
}

/** Notifications whose channel fan-out hasn't completed (crash-safe resume), newest first, last 24 h. */
export async function undeliveredNotifications(db: Db): Promise<NotificationRow[]> {
  return db.query<NotificationRow>(
    `select * from notifications where delivered_at is null and created_at > now() - interval '24 hours' order by created_at`,
  );
}

export async function markDelivered(db: Db, id: string): Promise<void> {
  await db.query(`update notifications set delivered_at = now() where id = $1`, [id]);
}

/** Mark open notifications for a rule/position resolved (condition cleared). */
export async function resolveNotifications(db: Db, ruleId: string, positionId: string): Promise<void> {
  await db.query(`update notifications set resolved_at = now() where rule_id = $1 and position_id = $2 and resolved_at is null`, [ruleId, positionId]);
}

// ---------------- deliveries ----------------
export interface DeliveryRow {
  id: string;
  notification_id: string;
  channel: string;
  status: "sent" | "failed" | "skipped";
  provider_id: string | null;
  error: string | null;
  attempts: number;
  created_at: Date;
}

export async function insertDelivery(
  db: Db,
  d: { notificationId: string; channel: string; status: "sent" | "failed" | "skipped"; providerId?: string | null; error?: string | null; attempts: number },
): Promise<boolean> {
  const rows = await db.query(
    `insert into notification_deliveries (notification_id, channel, status, provider_id, error, attempts)
     values ($1, $2, $3, $4, $5, $6) on conflict (notification_id, channel) do nothing returning id`,
    [d.notificationId, d.channel, d.status, d.providerId ?? null, d.error ?? null, d.attempts],
  );
  return rows.length > 0;
}

export async function deliveriesFor(db: Db, notificationIds: string[]): Promise<DeliveryRow[]> {
  if (!notificationIds.length) return [];
  return db.query<DeliveryRow>(
    `select * from notification_deliveries where notification_id = any($1::text::uuid[]) order by id`,
    [pgTextArray(notificationIds)],
  );
}

// ---------------- protective actions ----------------
export async function insertProtectiveAction(
  db: Db,
  a: { wallet: string; positionUuid: string | null; actionType: string; estimatedAmount: bigint; txHash: string; status: "submitted" | "confirmed" | "failed" },
): Promise<{ id: string; inserted: boolean }> {
  const rows = await db.query<{ id: string }>(
    `insert into protective_actions (wallet_address, position_id, action_type, estimated_amount, transaction_hash, status)
     values ($1, $2, $3, $4::text::numeric, $5, $6)
     on conflict (transaction_hash) do update set status = excluded.status returning id, (xmax = 0) as inserted`,
    [lc(a.wallet), a.positionUuid, a.actionType, a.estimatedAmount.toString(), lc(a.txHash), a.status],
  );
  const r = rows[0] as unknown as { id: string; inserted: boolean };
  return { id: r.id, inserted: Boolean(r.inserted) };
}

/** Confirmed protective actions by this wallet since `since` (used to tell user-driven debt/coll changes from redemptions). */
export async function recentActions(db: Db, wallet: string, since: Date): Promise<{ action_type: string; created_at: Date }[]> {
  return db.query(`select action_type, created_at from protective_actions where wallet_address = $1 and created_at >= $2`, [lc(wallet), since]);
}

// ---------------- cursors ----------------
export async function getCursor(db: Db, key: string): Promise<bigint | null> {
  const r = (await db.query<{ block_number: string }>(`select block_number from indexer_cursors where key = $1`, [key]))[0];
  return r ? big(r.block_number) : null;
}
export async function setCursor(db: Db, key: string, block: bigint): Promise<void> {
  await db.query(
    `insert into indexer_cursors (key, block_number) values ($1, $2::text::bigint)
     on conflict (key) do update set block_number = excluded.block_number, updated_at = now()`,
    [key, block.toString()],
  );
}

// ---------------- heartbeats ----------------
export interface HeartbeatRow {
  worker: string;
  last_run_started_at: Date | null;
  last_run_finished_at: Date | null;
  last_status: string | null;
  last_error: string | null;
  runs: string;
}
export async function heartbeatStart(db: Db, worker: string, at: Date): Promise<void> {
  await db.query(
    `insert into worker_heartbeats (worker, last_run_started_at, last_status, runs) values ($1, $2, 'running', 1)
     on conflict (worker) do update set last_run_started_at = excluded.last_run_started_at, last_status = 'running',
       runs = worker_heartbeats.runs + 1`,
    [worker, at],
  );
}
export async function heartbeatFinish(db: Db, worker: string, at: Date, status: string, error: string | null): Promise<void> {
  await db.query(`update worker_heartbeats set last_run_finished_at = $2, last_status = $3, last_error = $4 where worker = $1`, [
    worker, at, status, error,
  ]);
}
export async function getHeartbeat(db: Db, worker?: string): Promise<HeartbeatRow | null> {
  const rows = await db.query<HeartbeatRow>(
    worker
      ? `select * from worker_heartbeats where worker = $1`
      : `select * from worker_heartbeats order by last_run_finished_at desc nulls last limit 1`,
    worker ? [worker] : [],
  );
  return rows[0] ?? null;
}

export { iso };

export async function setPositionStatus(db: Db, id: string, status: string): Promise<void> {
  await db.query(`update loan_positions set status = $2, last_synced_at = now() where id = $1`, [id, status]);
}
