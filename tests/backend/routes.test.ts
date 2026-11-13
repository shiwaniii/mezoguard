import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

vi.mock("@/lib/protocols", () => ({
  discoverAll: vi.fn(async () => ({ positions: [], protocols: [] })),
  readBtcPrice: vi.fn(async () => ({ usd: 74_000n * 10n ** 18n, source: "mezo-pricefeed", sourceAddress: "0x86bCF0841622a5dAC14A313a15f96A95421b9366", updatedAt: 0, blockNumber: 1n, stale: false })),
  refreshPosition: vi.fn(async () => null),
  getPublicClient: vi.fn(),
}));

import { NextRequest } from "next/server";
import { setDb, type Db } from "@/lib/server/db";
import { resetRateLimits } from "@/lib/server/ratelimit";
import * as nonceRoute from "@/app/api/auth/nonce/route";
import * as verifyRoute from "@/app/api/auth/verify/route";
import * as sessionRoute from "@/app/api/session/route";
import * as walletsRoute from "@/app/api/wallets/route";
import * as rulesRoute from "@/app/api/alerts/rules/route";
import * as ruleRoute from "@/app/api/alerts/rules/[id]/route";
import * as notificationsRoute from "@/app/api/notifications/route";
import * as settingsRoute from "@/app/api/settings/route";
import * as runRoute from "@/app/api/worker/run/route";
import * as healthRoute from "@/app/api/worker/health/route";
import { makeDb } from "./helpers";

process.env.MEZOGUARD_LOG = "silent";
process.env.SESSION_SECRET = "test-secret-0123456789abcdef";

const account = privateKeyToAccount(generatePrivateKey());
let db: Db;
beforeEach(async () => {
  db = await makeDb();
  setDb(db);
  resetRateLimits();
});
afterEach(async () => {
  setDb(null);
  await db.close();
});

const req = (url: string, init: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string> } = {}) =>
  new NextRequest(`http://mezoguard.test${url}`, {
    method: init.method ?? "GET",
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    headers: { host: "mezoguard.test", ...(init.cookie ? { cookie: init.cookie } : {}), ...(init.headers ?? {}) },
  });
const cookieOf = (res: Response, name: string) => {
  const c = res.headers.getSetCookie().find((x) => x.startsWith(`${name}=`))!;
  return c.split(";")[0];
};

async function signIn(): Promise<string> {
  const n = await nonceRoute.GET(req(`/api/auth/nonce?address=${account.address}`));
  const { message } = await n.json();
  const signature = await account.signMessage({ message });
  const v = await verifyRoute.POST(req("/api/auth/verify", { method: "POST", body: { address: account.address, message, signature }, cookie: cookieOf(n, "mg_nonce") }));
  expect(v.status).toBe(200);
  const set = v.headers.getSetCookie().join("\n");
  expect(set).toMatch(/mg_session=.*HttpOnly/i);
  expect(set).toMatch(/SameSite=lax/i);
  return cookieOf(v, "mg_session");
}

describe("API routes", () => {
  it("sign-in → session → wallets → rules → notifications", async () => {
    expect(await (await sessionRoute.GET(req("/api/session"))).json()).toEqual({ address: null, userId: null, dbEnabled: true });
    expect((await walletsRoute.GET(req("/api/wallets"))).status).toBe(401);
    const cookie = await signIn();
    const s = await (await sessionRoute.GET(req("/api/session", { cookie }))).json();
    expect(s.address).toBe(account.address);

    const w = await walletsRoute.POST(req("/api/wallets", { method: "POST", cookie, body: { walletAddress: "0x1111111111111111111111111111111111111111", label: "friend" } }));
    expect(w.status).toBe(201);
    expect(await w.json()).toMatchObject({ label: "friend", trackingStatus: "active" });

    const bad = await rulesRoute.POST(req("/api/alerts/rules", { method: "POST", cookie, body: { triggerType: "cr_below", threshold: "abc" } }));
    expect(bad.status).toBe(400);
    const r = await rulesRoute.POST(req("/api/alerts/rules", { method: "POST", cookie, body: { triggerType: "cr_below", threshold: "250", channels: ["in_app", "email"] } }));
    expect(r.status).toBe(201);
    const rule = await r.json();
    expect(rule).toMatchObject({ walletAddress: account.address, positionId: null, triggerType: "cr_below", threshold: "250", cooldownMinutes: 60, enabled: true });
    const p = await ruleRoute.PATCH(req(`/api/alerts/rules/${rule.id}`, { method: "PATCH", cookie, body: { enabled: false } }), { params: Promise.resolve({ id: rule.id }) });
    expect((await p.json()).enabled).toBe(false);

    const st = await settingsRoute.PUT(req("/api/settings", { method: "PUT", cookie, body: { email: "a@b.co", telegramChatId: "12345" } }));
    expect(await st.json()).toMatchObject({ email: "a@b.co", telegramChatId: "12345", channelsAvailable: { email: false, telegram: false } });

    const ns = await notificationsRoute.GET(req("/api/notifications?unread=1", { cookie }));
    expect(await ns.json()).toEqual([]);
  });

  it("DB disabled → 503 DB_DISABLED on session routes", async () => {
    setDb(null);
    const res = await walletsRoute.GET(req("/api/wallets"));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "DB_DISABLED" });
    expect(await (await sessionRoute.GET(req("/api/session"))).json()).toMatchObject({ dbEnabled: false });
  });

  it("worker/run requires the bearer CRON_SECRET; health reflects the heartbeat", async () => {
    process.env.CRON_SECRET = "cron-secret-abcdef";
    expect((await runRoute.POST(req("/api/worker/run", { method: "POST" }))).status).toBe(401);
    expect((await runRoute.POST(req("/api/worker/run", { method: "POST", headers: { authorization: "Bearer wrong-secret-xxxxx" } }))).status).toBe(401);
    expect((await healthRoute.GET()).status).toBe(503);
    const ok = await runRoute.GET(req("/api/worker/run", { headers: { authorization: "Bearer cron-secret-abcdef" } }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ worker: "cron", status: "ok" });
    const h = await healthRoute.GET();
    expect(h.status).toBe(200);
    expect(await h.json()).toMatchObject({ worker: "cron", healthy: true, runs: 1, lastStatus: "ok" });
  });
});
