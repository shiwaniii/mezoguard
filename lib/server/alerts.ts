/**
 * Alert rule evaluation — edge-triggered, cooldown-aware, escalating, idempotent. Pure decision logic; the monitor
 * persists the decision (notification insert + alert_rule_state update) in one transaction.
 *
 * State per (rule, position) lives in alert_rule_state: `armed` (next crossing fires), `last_fired_at`, and
 * `last_value` = JSON { epoch, level, ref?, value? }. `epoch` counts fires and is part of the dedupe_key, so re-running
 * a cycle can never insert the same notification twice. See docs/ALERT_SYSTEM.md.
 */
import "./guard";
import { parseUnits } from "viem";
import type { AlertTriggerType } from "@/lib/api-types";
import type { Position, RiskAssessment, RiskLevel } from "@/lib/risk/types";
import { RISK_ORDER } from "@/lib/risk/types";
import { fmtPct, fmtRatio } from "@/lib/format";
import type { AlertRuleRow, LoanPositionRow, RuleStateRow, Severity } from "./db/repo";

export const TRIGGER_TYPES: AlertTriggerType[] = ["cr_below", "btc_drop_pct", "level_at_least", "redemption", "liquidation_price_within_pct"];
export const LEVELS: RiskLevel[] = ["healthy", "watch", "high", "critical", "liquidatable"];
const EXPOSURES = ["low", "moderate", "high"] as const;
type Exposure = (typeof EXPOSURES)[number];

const WAD = 10n ** 18n;
/** Re-arm hysteresis: condition must clear by 2 % (relative) of the threshold. */
const HYSTERESIS_BPS = 200n;

/** "250" → 2.5e18 (percent → 1e18 fraction). Up to 4 decimals. */
export function parsePercent(s: string): bigint | null {
  const t = s.trim();
  if (!/^\d{1,6}(\.\d{1,4})?$/.test(t)) return null;
  return parseUnits(t, 16);
}

/** Validates/normalises a threshold for a trigger type. Returns the canonical string or an error. */
export function normalizeThreshold(type: AlertTriggerType, raw: string | undefined | null): { ok: true; value: string } | { ok: false; error: string } {
  const s = (raw ?? "").toString().trim().toLowerCase();
  switch (type) {
    case "cr_below": {
      const v = parsePercent(s);
      if (v === null || v <= WAD || v > 100n * WAD) return { ok: false, error: "cr_below threshold must be a percent between 100 and 10000, e.g. \"200\"" };
      return { ok: true, value: s };
    }
    case "btc_drop_pct":
    case "liquidation_price_within_pct": {
      const v = parsePercent(s);
      if (v === null || v <= 0n || v >= WAD) return { ok: false, error: `${type} threshold must be a percent between 0 and 100, e.g. "10"` };
      return { ok: true, value: s };
    }
    case "level_at_least":
      if (!(LEVELS as string[]).includes(s) || s === "healthy") return { ok: false, error: "level_at_least threshold must be one of watch|high|critical|liquidatable" };
      return { ok: true, value: s };
    case "redemption": {
      const v = s || "high";
      if (!(EXPOSURES as readonly string[]).includes(v) || v === "low") return { ok: false, error: "redemption threshold must be \"moderate\" or \"high\"" };
      return { ok: true, value: v };
    }
  }
}

/** Whether a trigger needs a fresh price (suppressed while the price is stale). */
export function isPriceDependent(type: AlertTriggerType): boolean {
  return type !== "redemption";
}

export function levelSeverity(level: RiskLevel): Severity {
  switch (level) {
    case "healthy":
      return "info";
    case "watch":
      return "watch";
    case "high":
      return "high";
    default:
      return "critical";
  }
}
const SEV_ORDER: Record<Severity, number> = { info: 0, watch: 1, high: 2, critical: 3 };
/** Rule fires are at least "watch" (the user asked to be told). */
export const fireSeverity = (level: RiskLevel): Severity => (SEV_ORDER[levelSeverity(level)] < 1 ? "watch" : levelSeverity(level));

export interface StoredState {
  epoch: number;
  level?: RiskLevel;
  /** btc_drop_pct reference price (1e18 USD, decimal string). */
  ref?: string;
  value?: string;
}

export function readState(row: RuleStateRow | null): { armed: boolean; lastFiredAt: Date | null; s: StoredState } {
  if (!row) return { armed: true, lastFiredAt: null, s: { epoch: 0 } };
  let s: StoredState = { epoch: 0 };
  try {
    if (row.last_value) s = { ...(JSON.parse(row.last_value) as StoredState) }; if (typeof s.epoch !== "number") s.epoch = 0;
  } catch {
    /* corrupt → defaults */
  }
  return { armed: row.armed, lastFiredAt: row.last_fired_at ? new Date(row.last_fired_at) : null, s };
}

export interface EvalInput {
  rule: AlertRuleRow;
  positionUuid: string;
  position: Position;
  assessment: RiskAssessment;
  /** loan_positions row as it was BEFORE this cycle's upsert (null = first time seen). */
  previous: LoanPositionRow | null;
  /** price stale (position price or assessment) — suppresses price-dependent triggers. */
  stale: boolean;
  /** A user protective action (repay/add/close) was recorded since the previous sync. */
  userActionSincePrevious: boolean;
  state: RuleStateRow | null;
  now: Date;
}

export type DecisionKind = "fire" | "escalate" | "event";
export interface Decision {
  /** null = nothing to send. */
  notify: null | { kind: DecisionKind; dedupeKey: string; alertType: string; severity: Severity; headline: string };
  /** New state to persist (null = leave unchanged). */
  state: null | { armed: boolean; lastFiredAt: Date | null; lastValue: string };
  /** Condition cleared → mark the rule's open notifications resolved. */
  resolved: boolean;
  /** Why nothing fired (diagnostics). */
  suppressed?: "stale" | "cooldown" | "not_applicable";
}

interface Cond {
  active: boolean;
  /** Condition has cleared past the hysteresis band (re-arm allowed). */
  cleared: boolean;
  value: string;
  headline: string;
}

function condition(inp: EvalInput, s: StoredState): Cond | null {
  const { rule, position: p, assessment: a } = inp;
  switch (rule.trigger_type) {
    case "cr_below": {
      const t = parsePercent(rule.threshold)!;
      const cr = p.collateralRatio;
      return {
        active: cr < t,
        cleared: cr >= t + (t * HYSTERESIS_BPS) / 10000n,
        value: cr.toString(),
        headline: `Collateral ratio ${fmtRatio(cr)} is below your ${rule.threshold}% alert`,
      };
    }
    case "liquidation_price_within_pct": {
      const x = parsePercent(rule.threshold)!;
      const buf = a.priceDeclineBuffer;
      return {
        active: buf <= x,
        cleared: buf >= x + (x * HYSTERESIS_BPS) / 10000n,
        value: buf.toString(),
        headline: `Price is within ${fmtPct(buf, 1)} of liquidation (alert at ${rule.threshold}%)`,
      };
    }
    case "level_at_least": {
      const want = RISK_ORDER[rule.threshold as RiskLevel];
      const have = RISK_ORDER[a.level];
      return {
        active: have >= want,
        cleared: have < want,
        value: a.level,
        headline: `Risk level is ${a.level.toUpperCase()} (alert at ${rule.threshold} or worse)`,
      };
    }
    case "btc_drop_pct": {
      const x = parsePercent(rule.threshold)!;
      const price = p.price.usd;
      const ref = s.ref ? BigInt(s.ref) : null;
      if (ref === null || ref <= 0n) return null; // seeded below, never fires on first observation
      const trigger = ref - (ref * x) / WAD;
      const drop = ((ref - price) * WAD) / ref;
      return {
        active: price <= trigger,
        cleared: price > trigger,
        value: price.toString(),
        headline: `${p.collateralAsset.symbol} price fell ${fmtPct(drop, 1)} since your reference price (alert at ${rule.threshold}%)`,
      };
    }
    case "redemption": {
      if (!p.redemption) return null;
      const want = EXPOSURES.indexOf(rule.threshold as Exposure);
      const have = EXPOSURES.indexOf(p.redemption.exposure);
      return {
        active: have >= want,
        cleared: have < want,
        value: p.redemption.exposure,
        headline: `Redemption exposure is ${p.redemption.exposure.toUpperCase()}: ${p.redemption.queuePosition} of ${p.redemption.queueSize} in the redemption queue`,
      };
    }
  }
}

/** Detects a redemption hit since the previous sync: coll AND debt both fell with no user action, or status redeemed. */
export function detectRedemption(inp: Pick<EvalInput, "position" | "previous" | "userActionSincePrevious">): boolean {
  const { position: p, previous } = inp;
  if (p.protocol !== "mezo-musd-trove") return false;
  if (p.status === "redeemed") return true;
  if (!previous || inp.userActionSincePrevious) return false;
  const prevColl = BigInt(previous.collateral_amount);
  const prevDebt = BigInt(previous.debt_amount);
  return p.collateralAmount < prevColl && p.debtAmount < prevDebt;
}

export function evaluateRule(inp: EvalInput): Decision {
  const { rule, positionUuid, position: p, assessment: a, now } = inp;
  const st = readState(inp.state);
  const base = `rule:${rule.id}:pos:${positionUuid}`;
  const cooldownMs = Math.max(0, rule.cooldown_minutes) * 60_000;
  const inCooldown = st.lastFiredAt !== null && now.getTime() - st.lastFiredAt.getTime() < cooldownMs;
  const persist = (armed: boolean, lastFiredAt: Date | null, s: StoredState) => ({ armed, lastFiredAt, lastValue: JSON.stringify(s) });

  if (rule.trigger_type === "redemption" && p.protocol !== "mezo-musd-trove") {
    return { notify: null, state: null, resolved: false, suppressed: "not_applicable" };
  }

  // Redemption *events* are one-shot (each hit is distinct, keyed by block) and bypass arming/cooldown.
  if (rule.trigger_type === "redemption" && detectRedemption(inp)) {
    return {
      notify: {
        kind: "event",
        dedupeKey: `${base}:redeemed:${p.blockNumber.toString()}`,
        alertType: "redemption",
        severity: "high",
        headline: p.status === "redeemed"
          ? "Your Trove was redeemed against"
          : "Your Trove was partially redeemed: collateral and debt both decreased without a recorded repay",
      },
      state: persist(st.armed, now, { ...st.s, level: a.level, value: p.redemption?.exposure }),
      resolved: false,
    };
  }

  if (inp.stale && isPriceDependent(rule.trigger_type)) {
    return { notify: null, state: null, resolved: false, suppressed: "stale" };
  }

  // btc_drop_pct: seed the reference price on first observation (≈ rule creation time).
  if (rule.trigger_type === "btc_drop_pct" && !st.s.ref) {
    return { notify: null, state: persist(true, st.lastFiredAt, { ...st.s, ref: p.price.usd.toString(), level: a.level }), resolved: false };
  }

  const c = condition(inp, st.s);
  if (!c) return { notify: null, state: null, resolved: false, suppressed: "not_applicable" };

  if (c.active) {
    if (st.armed) {
      if (inCooldown) {
        return { notify: null, state: persist(true, st.lastFiredAt, { ...st.s, value: c.value }), resolved: false, suppressed: "cooldown" };
      }
      const epoch = st.s.epoch + 1;
      // btc_drop_pct measures each further drop from the price at the last fire → stays armed with a new ref.
      const isDrop = rule.trigger_type === "btc_drop_pct";
      return {
        notify: { kind: "fire", dedupeKey: `${base}:e${epoch}`, alertType: rule.trigger_type, severity: fireSeverity(a.level), headline: c.headline },
        state: persist(isDrop, now, { epoch, level: a.level, value: c.value, ref: isDrop ? p.price.usd.toString() : st.s.ref }),
        resolved: false,
      };
    }
    // Already fired for this crossing: escalate if the risk level got worse since (bypasses cooldown).
    const lastLevel = st.s.level ?? "healthy";
    if (RISK_ORDER[a.level] > RISK_ORDER[lastLevel]) {
      return {
        notify: {
          kind: "escalate",
          dedupeKey: `${base}:e${st.s.epoch}:esc:${a.level}`,
          alertType: "risk_escalation",
          severity: fireSeverity(a.level),
          headline: `Risk worsened from ${lastLevel.toUpperCase()} to ${a.level.toUpperCase()} — ${c.headline}`,
        },
        state: persist(false, now, { ...st.s, level: a.level, value: c.value }),
        resolved: false,
      };
    }
    return { notify: null, state: persist(false, st.lastFiredAt, { ...st.s, value: c.value }), resolved: false };
  }

  // Condition inactive.
  if (!st.armed && c.cleared) {
    return { notify: null, state: persist(true, st.lastFiredAt, { ...st.s, level: a.level, value: c.value }), resolved: true };
  }
  return { notify: null, state: persist(st.armed, st.lastFiredAt, { ...st.s, value: c.value }), resolved: false };
}
