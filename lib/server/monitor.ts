/**
 * One monitoring cycle (brief §7.3):
 *  1. heartbeat start            2. read BTC price (Mezo PriceFeed; stale flag)
 *  3. load wallets: active tracked wallets + every user's own wallet
 *  4. discoverAll(wallet) per wallet (live chain, never events alone)
 *  5. upsert loan_positions; positions that vanished (from a protocol that scanned OK) are re-read and marked
 *     closed / liquidated / redeemed
 *  6. risk_snapshots row per position (price_stale flagged)
 *  7. evaluate enabled alert rules (edge-triggered, cooldown, escalation) — price-dependent rules are NOT evaluated
 *     on stale data; instead one "data unavailable" info notice per cooldown window
 *  8. insert notifications (dedupe_key unique → idempotent)
 *  9. deliver to channels (unique per channel, retries with backoff)
 * 10. heartbeat finish (ok | partial | error, last error)
 * Never throws: every failure is recorded in the report + heartbeat.
 */
import "./guard";
import type { Address } from "viem";
import { getAddress } from "viem";
import type { Position, PriceReading, RiskAssessment, Recommendation, ProtocolId } from "@/lib/risk/types";
import type { ProtocolStatus } from "@/lib/api-types";
import { discoverAll as realDiscoverAll, readBtcPrice as realReadBtcPrice, refreshPosition as realRefreshPosition } from "@/lib/protocols";
import { assess as realAssess, recommend as realRecommend } from "@/lib/risk";
import { getDb, type Db } from "./db";
import * as repo from "./db/repo";
import { evaluateRule, isPriceDependent, parsePercent } from "./alerts";
import { buildPayload, messageLine, recommendedActionText } from "./notify/message";
import { deliverPending, type DeliverOpts, type DeliverySummary } from "./notify";
import { log } from "./log";

export const DEFAULT_WORKER = "monitor";

export interface MonitorDeps {
  discoverAll: (owner: Address) => Promise<{ positions: Position[]; protocols: ProtocolStatus[] }>;
  readBtcPrice: () => Promise<PriceReading>;
  refreshPosition: (protocol: ProtocolId, positionId: string) => Promise<Position | null>;
  assess: (p: Position) => RiskAssessment;
  recommend: (p: Position, targetRatio?: bigint) => Recommendation;
}

export interface MonitorOpts {
  db?: Db | null;
  worker?: string;
  now?: () => Date;
  deps?: Partial<MonitorDeps>;
  deliver?: DeliverOpts;
}

export interface CycleReport {
  worker: string;
  status: "ok" | "partial" | "error" | "skipped";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  priceStale: boolean;
  wallets: number;
  positions: number;
  snapshots: number;
  closedPositions: number;
  notifications: number;
  escalations: number;
  suppressedStale: number;
  suppressedCooldown: number;
  deliveries: DeliverySummary;
  errors: string[];
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);
let running = false;

export async function runMonitorCycle(opts: MonitorOpts = {}): Promise<CycleReport> {
  const now = opts.now ?? (() => new Date());
  const worker = opts.worker ?? DEFAULT_WORKER;
  const deps: MonitorDeps = {
    discoverAll: realDiscoverAll,
    readBtcPrice: realReadBtcPrice,
    refreshPosition: realRefreshPosition,
    assess: (p) => realAssess(p),
    recommend: (p, target) => realRecommend(p, target),
    ...opts.deps,
  };
  const started = now();
  const report: CycleReport = {
    worker, status: "ok", startedAt: started.toISOString(), finishedAt: started.toISOString(), durationMs: 0, priceStale: false,
    wallets: 0, positions: 0, snapshots: 0, closedPositions: 0, notifications: 0, escalations: 0, suppressedStale: 0,
    suppressedCooldown: 0, deliveries: { sent: 0, failed: 0, skipped: 0 }, errors: [],
  };
  const finish = (status: CycleReport["status"]) => {
    const end = now();
    report.status = status;
    report.finishedAt = end.toISOString();
    report.durationMs = end.getTime() - started.getTime();
    return report;
  };

  const db = opts.db === undefined ? getDb() : opts.db;
  if (!db) {
    report.errors.push("database not configured (set DATABASE_URL or MEZOGUARD_DB=pglite)");
    return finish("skipped");
  }
  if (running) {
    report.errors.push("a cycle is already running in this process");
    return finish("skipped");
  }
  running = true;
  let walletsOk = 0;
  try {
    // 1. heartbeat
    try {
      await repo.heartbeatStart(db, worker, started);
    } catch (e) {
      report.errors.push(`heartbeat: ${errMsg(e)}`);
      return finish("error");
    }

    // 2. BTC price
    let btc: PriceReading | null = null;
    try {
      btc = await deps.readBtcPrice();
      report.priceStale = btc.stale;
    } catch (e) {
      report.priceStale = true;
      report.errors.push(`price: ${errMsg(e)}`);
    }

    // 3. wallets
    const wallets = await repo.walletsToMonitor(db);
    report.wallets = wallets.length;

    for (const w of wallets) {
      try {
        await processWallet(db, w.wallet, deps, btc, now, report);
        walletsOk++;
      } catch (e) {
        report.errors.push(`wallet ${w.wallet}: ${errMsg(e)}`);
        log.error("wallet cycle failed", { wallet: w.wallet, error: errMsg(e) });
      }
    }

    // 9. deliveries
    try {
      report.deliveries = await deliverPending(db, opts.deliver);
    } catch (e) {
      report.errors.push(`deliveries: ${errMsg(e)}`);
    }

    const status: CycleReport["status"] =
      report.errors.length === 0 ? "ok" : walletsOk === 0 && report.wallets > 0 ? "error" : "partial";
    finish(status);
  } catch (e) {
    report.errors.push(errMsg(e));
    finish("error");
  } finally {
    running = false;
    // 10. heartbeat finish
    try {
      await repo.heartbeatFinish(db, worker, new Date(report.finishedAt), report.status, report.errors.length ? report.errors.join(" | ").slice(0, 2000) : null);
    } catch (e) {
      log.error("heartbeat finish failed", { error: errMsg(e) });
    }
  }
  return report;
}

async function processWallet(
  db: Db,
  wallet: string,
  deps: MonitorDeps,
  btc: PriceReading | null,
  now: () => Date,
  report: CycleReport,
) {
  const owner = getAddress(wallet);
  // 4. discover
  const { positions, protocols } = await deps.discoverAll(owner);
  for (const s of protocols) if (s.status === "error") report.errors.push(`${wallet} ${s.id}: ${s.error ?? "adapter error"}`);
  const okProtocols = new Set(protocols.filter((s) => s.status === "ok").map((s) => s.id));

  const before = await repo.activePositionsForWallet(db, wallet);
  const rules = await repo.enabledRulesForWallet(db, wallet);
  const seen = new Set<string>();

  for (const p of positions) {
    report.positions++;
    const prev = await repo.findPosition(db, p.protocol, p.positionId);
    const a = deps.assess(p);
    let rec: Recommendation | null = null;
    try {
      rec = deps.recommend(p);
    } catch (e) {
      log.warn("recommend failed", { positionId: p.positionId, error: errMsg(e) });
    }
    const stale = p.price.stale || a.stale;

    // 5. upsert
    const row = await repo.upsertPosition(db, p, a.level);
    seen.add(row.id);

    // 6. snapshot
    await repo.insertSnapshot(db, {
      positionId: row.id,
      btcPrice: btc && p.collateralAsset.symbol === "BTC" ? btc.usd : p.price.usd,
      priceStale: stale || (btc?.stale ?? false),
      collateralValue: p.collateralValueUsd,
      debtValue: p.debtValueUsd,
      collateralRatio: p.collateralRatio,
      liquidationPrice: p.liquidationPriceUsd,
      riskLevel: a.level,
      blockNumber: p.blockNumber,
    });
    report.snapshots++;

    // 7–8. rules
    const applicable = rules.filter((r) => r.position_id === null || r.position_id === row.id);
    if (!applicable.length) continue;
    const userAction = prev
      ? (await repo.recentActions(db, wallet, new Date(prev.last_synced_at))).some((x) => ["repay", "close", "automation_repay", "add_collateral"].includes(x.action_type))
      : false;
    const t = now();
    const payload = buildPayload({ position: p, assessment: a, btcPrice: btc, recommendation: rec, now: t });
    const action = recommendedActionText(p, rec);
    const staleCooldownByUser = new Map<string, number>();

    for (const rule of applicable) {
      const state = await repo.getRuleState(db, rule.id, row.id);
      const d = evaluateRule({ rule, positionUuid: row.id, position: p, assessment: a, previous: prev, stale, userActionSincePrevious: userAction, state, now: t });
      if (d.suppressed === "stale" && isPriceDependent(rule.trigger_type)) {
        report.suppressedStale++;
        const cur = staleCooldownByUser.get(rule.user_id);
        staleCooldownByUser.set(rule.user_id, Math.min(cur ?? Infinity, Math.max(1, rule.cooldown_minutes)));
      }
      if (d.suppressed === "cooldown") report.suppressedCooldown++;
      // cr_below: recommend getting back 5 % above the user's own threshold when that is above the default target.
      let ruleAction = action;
      if (d.notify && rule.trigger_type === "cr_below" && rec) {
        const t = parsePercent(rule.threshold);
        const target = t !== null ? t + t / 20n : 0n;
        if (target > rec.targetRatio) {
          try {
            ruleAction = recommendedActionText(p, deps.recommend(p, target));
          } catch {
            /* keep default */
          }
        }
      }
      await db.transaction(async (tx) => {
        if (d.notify) {
          const n = await repo.insertNotification(tx, {
            userId: rule.user_id,
            positionId: row.id,
            ruleId: rule.id,
            alertType: d.notify.alertType,
            severity: d.notify.severity,
            message: messageLine({ headline: d.notify.headline, severity: d.notify.severity, payload, recommendedAction: ruleAction }),
            recommendedAction: ruleAction,
            payload: { ...payload, headline: d.notify.headline, kind: d.notify.kind },
            dedupeKey: d.notify.dedupeKey,
          });
          if (n) {
            report.notifications++;
            if (d.notify.kind === "escalate") report.escalations++;
            log.info("notification", { id: n.id, rule: rule.id, type: d.notify.alertType, severity: d.notify.severity, dedupeKey: d.notify.dedupeKey });
          }
        }
        if (d.state) await repo.putRuleState(tx, { ruleId: rule.id, positionId: row.id, ...d.state });
        if (d.resolved) await repo.resolveNotifications(tx, rule.id, row.id);
      });
    }

    // Stale data: one info notice per user/position per cooldown window instead of price alerts.
    for (const [userId, cooldownMin] of staleCooldownByUser) {
      const bucket = Math.floor(t.getTime() / (cooldownMin * 60_000));
      const headline = `Price data unavailable — alerts for this position are paused until a fresh price arrives${p.price.staleReason ? ` (${p.price.staleReason})` : ""}`;
      const n = await repo.insertNotification(db, {
        userId,
        positionId: row.id,
        ruleId: null,
        alertType: "data_unavailable",
        severity: "info",
        message: messageLine({ headline, severity: "info", payload, recommendedAction: null }),
        recommendedAction: null,
        payload: { ...payload, headline, kind: "stale" },
        dedupeKey: `stale:${userId}:${row.id}:${cooldownMin}m:${bucket}`,
      });
      if (n) report.notifications++;
    }
  }

  // 5b. vanished positions (only for protocols that scanned OK — an adapter error never means "closed")
  for (const old of before) {
    if (seen.has(old.id) || !okProtocols.has(old.protocol_id)) continue;
    let fresh: Position | null = null;
    try {
      fresh = await deps.refreshPosition(old.protocol_id, old.protocol_position_id);
    } catch (e) {
      report.errors.push(`refresh ${old.protocol_position_id}: ${errMsg(e)}`);
      continue;
    }
    const status = fresh && fresh.status !== "active" ? fresh.status : "closed";
    await repo.setPositionStatus(db, old.id, status);
    report.closedPositions++;
    if (fresh && (status === "liquidated" || status === "redeemed")) {
      const userIds = [...new Set(rules.filter((r) => r.position_id === null || r.position_id === old.id).map((r) => r.user_id))];
      let a: RiskAssessment;
      try {
        a = deps.assess(fresh);
      } catch {
        continue;
      }
      a = { ...a, level: status === "liquidated" ? "liquidatable" : a.level };
      const t = now();
      const payload = buildPayload({ position: fresh, assessment: a, btcPrice: btc, recommendation: null, now: t });
      const headline = status === "liquidated" ? "Your position was liquidated" : "Your Trove was fully redeemed and closed";
      for (const userId of userIds) {
        const n = await repo.insertNotification(db, {
          userId,
          positionId: old.id,
          ruleId: null,
          alertType: `position_${status}`,
          severity: status === "liquidated" ? "critical" : "high",
          message: messageLine({ headline, severity: status === "liquidated" ? "critical" : "high", payload, recommendedAction: null }),
          recommendedAction: null,
          payload: { ...payload, headline, kind: "closed" },
          dedupeKey: `closed:${old.id}:${status}:${userId}`,
        });
        if (n) report.notifications++;
      }
    }
  }
}
