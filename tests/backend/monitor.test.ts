import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Address } from "viem";
import type { Position, PriceReading } from "@/lib/risk/types";

const chain = vi.hoisted(() => ({
  positions: new Map<string, Position[]>(),
  price: null as PriceReading | null,
  discoverError: null as Error | null,
  priceError: null as Error | null,
  refreshed: new Map<string, Position | null>(),
  discoverCalls: [] as string[],
}));

vi.mock("@/lib/protocols", () => ({
  discoverAll: vi.fn(async (owner: Address) => {
    chain.discoverCalls.push(owner.toLowerCase());
    if (chain.discoverError) throw chain.discoverError;
    const ps = chain.positions.get(owner.toLowerCase()) ?? [];
    return {
      positions: ps,
      protocols: [
        { id: "mezo-musd-trove", label: "Mezo MUSD Trove", status: "ok", positions: ps.filter((p) => p.protocol === "mezo-musd-trove").length },
        { id: "morpho-blue", label: "Morpho Blue", status: "ok", positions: 0 },
      ],
    };
  }),
  readBtcPrice: vi.fn(async () => {
    if (chain.priceError) throw chain.priceError;
    return chain.price;
  }),
  refreshPosition: vi.fn(async (_p: string, id: string) => chain.refreshed.get(id.toLowerCase()) ?? null),
  getPublicClient: vi.fn(),
}));

import type { Db } from "@/lib/server/db";
import * as repo from "@/lib/server/db/repo";
import { runMonitorCycle } from "@/lib/server/monitor";
import { makeDb, trove, price, priceForCr, OWNER, OTHER, WAD } from "./helpers";

process.env.MEZOGUARD_LOG = "silent";
process.env.APP_URL = "https://mezoguard.test";

let db: Db;
let clock: Date;
let userId: string;
const noSleep = { sleep: async () => {} };

const run = (extra: Parameters<typeof runMonitorCycle>[0] = {}) =>
  runMonitorCycle({ db, now: () => clock, deliver: noSleep, ...extra });
const advance = (minutes: number) => (clock = new Date(clock.getTime() + minutes * 60_000));
function setCr(crPercent: bigint, opts: { stale?: boolean; owner?: Address } = {}) {
  const p = priceForCr(crPercent);
  const t = trove({ priceUsd: p, stale: opts.stale, owner: opts.owner });
  chain.positions.set((opts.owner ?? OWNER).toLowerCase(), [t]);
  chain.price = price(p, opts.stale ?? false);
  return t;
}
async function addRule(r: Partial<{ trigger: string; threshold: string; channels: repo.Channel[]; cooldown: number }> = {}) {
  return repo.createRule(db, {
    userId, wallet: OWNER, positionUuid: null, triggerType: (r.trigger ?? "cr_below") as never, threshold: r.threshold ?? "250",
    channels: r.channels ?? ["in_app"], cooldownMinutes: r.cooldown ?? 60, enabled: true,
  });
}
const notifications = () => db.query<repo.NotificationRow>(`select * from notifications order by created_at, id`);

beforeEach(async () => {
  db = await makeDb();
  clock = new Date("2026-11-09T12:00:00Z");
  chain.positions.clear();
  chain.refreshed.clear();
  chain.discoverCalls = [];
  chain.discoverError = null;
  chain.priceError = null;
  userId = (await repo.upsertUser(db, OWNER)).id;
  delete process.env.RESEND_API_KEY;
  delete process.env.ALERT_FROM_EMAIL;
  delete process.env.TELEGRAM_BOT_TOKEN;
});
afterEach(async () => {
  await db.close();
});

describe("wallet tracking", () => {
  it("scans each user's own wallet plus active tracked wallets, not paused ones", async () => {
    await repo.addTrackedWallet(db, userId, OTHER, "friend");
    const paused = await repo.addTrackedWallet(db, userId, "0x2222222222222222222222222222222222222222", null);
    await repo.updateTrackedWallet(db, userId, paused.id, { trackingStatus: "paused" });
    setCr(186n);
    const r = await run();
    expect(r.status).toBe("ok");
    expect(chain.discoverCalls.sort()).toEqual([OTHER.toLowerCase(), OWNER.toLowerCase()].sort());
    expect(r.positions).toBe(1);
    const pos = await repo.activePositionsForWallet(db, OWNER);
    expect(pos).toHaveLength(1);
    expect(BigInt(pos[0].collateral_ratio) / 10n ** 16n).toBe(186n);
    const snaps = await db.query(`select * from risk_snapshots`);
    expect(snaps).toHaveLength(1);
  });

  it("marks a vanished position closed and reports a real liquidation", async () => {
    await addRule();
    setCr(186n);
    await run();
    chain.positions.set(OWNER.toLowerCase(), []);
    chain.refreshed.set(OWNER.toLowerCase(), { ...trove({ priceUsd: priceForCr(100n) }), status: "liquidated" });
    advance(1);
    const r = await run();
    expect(r.closedPositions).toBe(1);
    const rows = await db.query<{ status: string }>(`select status from loan_positions`);
    expect(rows[0].status).toBe("liquidated");
    const n = (await notifications()).filter((x) => x.alert_type === "position_liquidated");
    expect(n).toHaveLength(1);
    expect(n[0].severity).toBe("critical");
  });
});

describe("edge-triggered rules", () => {
  it("fires once on crossing and not again while the condition holds", async () => {
    const rule = await addRule();
    setCr(186n);
    const r1 = await run();
    expect(r1.notifications).toBe(1);
    advance(1);
    const r2 = await run();
    expect(r2.notifications).toBe(0);
    advance(120); // even after cooldown — no new crossing
    expect((await run()).notifications).toBe(0);
    const ns = await notifications();
    expect(ns).toHaveLength(1);
    const n = ns[0];
    expect(n.rule_id).toBe(rule.id);
    expect(n.alert_type).toBe("cr_below");
    expect(n.severity).toBe("watch");
    expect(n.dedupe_key).toMatch(/^rule:.+:pos:.+:e1$/);
    // every field required by the brief
    expect(n.payload).toMatchObject({
      wallet: OWNER, protocol: "mezo-musd-trove", positionId: OWNER, riskLevel: "healthy",
      link: `https://mezoguard.test/positions/mezo-musd-trove/${OWNER}`,
    });
    expect(BigInt(n.payload.collateralRatio as string) / 10n ** 16n).toBe(186n);
    expect(BigInt(n.payload.btcPrice as string)).toBe(priceForCr(186n));
    expect(BigInt(n.payload.liquidationPrice as string)).toBeGreaterThan(0n);
    expect(n.payload.timestamp).toBe("2026-11-09T12:00:00.000Z");
    expect(n.message).toContain("186.");
    expect(n.message).toContain("below your 250% alert");
    expect(n.recommended_action).toMatch(/^Repay [\d,.]+ MUSD or add [\d.]+ BTC to reach/);
    const d = await repo.deliveriesFor(db, [n.id]);
    expect(d.map((x) => [x.channel, x.status])).toEqual([["in_app", "sent"]]);
  });

  it("re-arms only after the condition clears past the hysteresis band", async () => {
    await addRule({ cooldown: 1 });
    setCr(186n);
    await run();
    advance(5);
    setCr(252n); // above 250 but inside the 2 % band (re-arm at 255)
    const r = await run();
    expect(r.notifications).toBe(0);
    advance(5);
    setCr(186n);
    expect((await run()).notifications).toBe(0); // never re-armed
    advance(5);
    setCr(260n); // clears → re-arm + resolve
    await run();
    const resolved = await db.query<{ resolved_at: Date | null }>(`select resolved_at from notifications`);
    expect(resolved[0].resolved_at).not.toBeNull();
    advance(5);
    setCr(186n);
    const r2 = await run();
    expect(r2.notifications).toBe(1);
    const ns = await notifications();
    expect(ns.map((x) => x.dedupe_key.split(":").pop())).toEqual(["e1", "e2"]);
  });

  it("respects the cooldown after a re-arm, then fires when it expires", async () => {
    await addRule({ cooldown: 60 });
    setCr(186n);
    await run(); // t0 fire
    advance(5);
    setCr(300n); // re-arm
    await run();
    advance(5);
    setCr(186n); // crossing inside cooldown
    const r = await run();
    expect(r.notifications).toBe(0);
    expect(r.suppressedCooldown).toBe(1);
    advance(51); // t0 + 61 min
    const r2 = await run();
    expect(r2.notifications).toBe(1);
    expect(await notifications()).toHaveLength(2);
  });

  it("escalates with a new notification when risk worsens (bypassing cooldown), once per level", async () => {
    await addRule({ cooldown: 600 });
    setCr(186n); // healthy
    await run();
    advance(1);
    setCr(135n); // high (< 143 %)
    const r = await run();
    expect(r.escalations).toBe(1);
    advance(1);
    expect((await run()).notifications).toBe(0); // same level → nothing
    advance(1);
    setCr(115n); // critical (< 121 %)
    expect((await run()).escalations).toBe(1);
    const ns = await notifications();
    expect(ns.map((n) => [n.alert_type, n.severity])).toEqual([
      ["cr_below", "watch"],
      ["risk_escalation", "high"],
      ["risk_escalation", "critical"],
    ]);
    expect(ns[1].message).toContain("Risk worsened from HEALTHY to HIGH");
  });

  it("is idempotent: re-running with lost edge state never duplicates (dedupe_key)", async () => {
    await addRule();
    setCr(186n);
    await run();
    await db.query(`delete from alert_rule_state`);
    const r = await run(); // same clock, state gone → would re-fire epoch 1 → dedupe conflict
    expect(r.notifications).toBe(0);
    expect(await notifications()).toHaveLength(1);
    const d = await db.query(`select * from notification_deliveries`);
    expect(d).toHaveLength(1);
  });

  it("level_at_least fires when the level reaches the threshold", async () => {
    await addRule({ trigger: "level_at_least", threshold: "high" });
    setCr(150n); // watch
    expect((await run()).notifications).toBe(0);
    advance(1);
    setCr(140n); // high
    expect((await run()).notifications).toBe(1);
  });

  it("btc_drop_pct measures from the first observed price, then from the last fire", async () => {
    await addRule({ trigger: "btc_drop_pct", threshold: "10", cooldown: 1 });
    setCr(200n); // seed reference
    expect((await run()).notifications).toBe(0);
    advance(2);
    setCr(185n); // -7.5 %
    expect((await run()).notifications).toBe(0);
    advance(2);
    setCr(179n); // -10.5 %
    expect((await run()).notifications).toBe(1);
    advance(2);
    setCr(170n); // -5 % from the new reference
    expect((await run()).notifications).toBe(0);
  });

  it("liquidation_price_within_pct fires when the price buffer shrinks to the threshold", async () => {
    await addRule({ trigger: "liquidation_price_within_pct", threshold: "30" });
    setCr(186n); // buffer = 1 - 110/186 ≈ 40.9 %
    expect((await run()).notifications).toBe(0);
    advance(1);
    setCr(150n); // ≈ 26.7 %
    expect((await run()).notifications).toBe(1);
  });

  it("redemption: detects a partial redemption (coll and debt both down, no user tx)", async () => {
    await addRule({ trigger: "redemption", threshold: "high" });
    setCr(186n);
    await run();
    advance(1);
    const p = priceForCr(186n);
    chain.positions.set(OWNER.toLowerCase(), [trove({ priceUsd: p, coll: 60_000_000_000_000_000n, debt: 2_000n * WAD, block: 2000n })]);
    const r = await run();
    expect(r.notifications).toBe(1);
    const n = (await notifications())[0];
    expect(n.alert_type).toBe("redemption");
    expect(n.dedupe_key).toMatch(/:redeemed:2000$/);
  });
});

describe("stale price", () => {
  it("snapshots flagged stale, no price alerts, one data-unavailable notice per cooldown", async () => {
    await addRule({ cooldown: 30 });
    await addRule({ trigger: "level_at_least", threshold: "watch", cooldown: 30 });
    setCr(150n, { stale: true });
    const r = await run();
    expect(r.priceStale).toBe(true);
    expect(r.suppressedStale).toBe(2);
    const ns = await notifications();
    expect(ns).toHaveLength(1);
    expect(ns[0].alert_type).toBe("data_unavailable");
    expect(ns[0].severity).toBe("info");
    const snaps = await db.query<{ price_stale: boolean }>(`select price_stale from risk_snapshots`);
    expect(snaps[0].price_stale).toBe(true);
    advance(5);
    expect((await run()).notifications).toBe(0); // same cooldown window
    advance(30);
    expect((await run()).notifications).toBe(1); // next window
    // fresh price again → the real alerts fire
    advance(1);
    setCr(150n);
    const r2 = await run();
    expect(r2.notifications).toBe(2);
    expect((await notifications()).filter((n) => n.alert_type !== "data_unavailable")).toHaveLength(2);
  });
});

describe("deliveries", () => {
  it("records skipped (with reason) when channel credentials are missing — never 'sent'", async () => {
    await repo.updateUserSettings(db, userId, { email: "user@example.com", telegramChatId: "12345" });
    await addRule({ channels: ["in_app", "email", "telegram", "browser"] });
    setCr(186n);
    const r = await run();
    expect(r.deliveries).toEqual({ sent: 1, failed: 0, skipped: 3 });
    const d = await db.query<repo.DeliveryRow>(`select * from notification_deliveries order by channel`);
    const by = Object.fromEntries(d.map((x) => [x.channel, x]));
    expect(by.email.status).toBe("skipped");
    expect(by.email.error).toMatch(/RESEND_API_KEY/);
    expect(by.telegram.status).toBe("skipped");
    expect(by.telegram.error).toMatch(/TELEGRAM_BOT_TOKEN/);
    expect(by.in_app.status).toBe("sent");
    expect(by.browser.status).toBe("skipped");
    const n = await db.query<{ delivered_at: Date | null }>(`select delivered_at from notifications`);
    expect(n[0].delivered_at).not.toBeNull();
  });

  it("retries a failing provider with backoff and records attempts", async () => {
    process.env.RESEND_API_KEY = "re_test_key_123456";
    process.env.ALERT_FROM_EMAIL = "alerts@mezoguard.test";
    process.env.TELEGRAM_BOT_TOKEN = "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef";
    await repo.updateUserSettings(db, userId, { email: "user@example.com", telegramChatId: "999" });
    await addRule({ channels: ["email", "telegram"] });
    setCr(186n);
    let emailCalls = 0;
    const sleeps: number[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("resend")) {
        emailCalls++;
        const body = JSON.parse(String(init?.body));
        expect(body.text).toContain("Recommended action:");
        expect(body.text).toContain(`Wallet: ${OWNER}`);
        if (emailCalls < 3) return new Response(JSON.stringify({ message: "upstream" }), { status: 503 });
        return new Response(JSON.stringify({ id: "em_1" }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: false, description: "Bad Request: chat not found" }), { status: 400 });
    });
    const r = await run({ deliver: { fetchImpl, sleep: async (ms) => void sleeps.push(ms), baseDelayMs: 100 } });
    expect(r.deliveries).toEqual({ sent: 2, failed: 1, skipped: 0 });
    const d = await db.query<repo.DeliveryRow>(`select * from notification_deliveries order by channel`);
    const by = Object.fromEntries(d.map((x) => [x.channel, x]));
    expect(by.email).toMatchObject({ status: "sent", attempts: 3, provider_id: "em_1" });
    expect(by.telegram).toMatchObject({ status: "failed", attempts: 1 }); // 400 is not retryable
    expect(by.telegram.error).not.toContain(process.env.TELEGRAM_BOT_TOKEN);
    expect(sleeps).toEqual([100, 200]);
  });

  it("gives up after 3 attempts on a persistent outage", async () => {
    process.env.RESEND_API_KEY = "re_test_key_123456";
    process.env.ALERT_FROM_EMAIL = "alerts@mezoguard.test";
    await repo.updateUserSettings(db, userId, { email: "user@example.com" });
    await addRule({ channels: ["email"] });
    setCr(186n);
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await run({ deliver: { fetchImpl, sleep: async () => {} } });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const d = await db.query<repo.DeliveryRow>(`select * from notification_deliveries where channel = 'email'`);
    expect(d[0]).toMatchObject({ status: "failed", attempts: 3 });
    // rerun does not resend (unique per channel + delivered_at set)
    advance(1);
    await run({ deliver: { fetchImpl, sleep: async () => {} } });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});

describe("failures", () => {
  it("RPC failure: the cycle records the error and heartbeat but does not throw", async () => {
    await addRule();
    chain.discoverError = new Error("HTTP request failed: rpc.test.mezo.org 502");
    chain.priceError = new Error("PriceFeed reverted");
    const r = await run();
    expect(r.status).toBe("error");
    expect(r.errors.join(" ")).toMatch(/502/);
    expect(r.errors.join(" ")).toMatch(/PriceFeed/);
    const hb = await repo.getHeartbeat(db, "monitor");
    expect(hb).toMatchObject({ last_status: "error", runs: "1" });
    expect(hb!.last_error).toMatch(/502/);
    expect(hb!.last_run_finished_at).not.toBeNull();
    // recovers next cycle
    chain.discoverError = null;
    chain.priceError = null;
    setCr(186n);
    advance(1);
    const r2 = await run();
    expect(r2.status).toBe("ok");
    expect((await repo.getHeartbeat(db, "monitor"))!.runs).toBe("2");
  });

  it("adapter error never closes positions", async () => {
    setCr(186n);
    await run();
    const { discoverAll } = await import("@/lib/protocols");
    vi.mocked(discoverAll).mockResolvedValueOnce({
      positions: [],
      protocols: [
        { id: "mezo-musd-trove", label: "Mezo MUSD Trove", status: "error", error: "timeout", positions: 0 },
        { id: "morpho-blue", label: "Morpho Blue", status: "ok", positions: 0 },
      ],
    });
    advance(1);
    const r = await run();
    expect(r.status).toBe("partial");
    expect(r.closedPositions).toBe(0);
    expect((await repo.activePositionsForWallet(db, OWNER))).toHaveLength(1);
  });

  it("no database → skipped, no throw", async () => {
    const r = await runMonitorCycle({ db: null });
    expect(r.status).toBe("skipped");
  });
});
