import { describe, it, expect } from "vitest";
import { createPgliteDb } from "@/lib/server/db";
import { migrate } from "@/lib/server/db/migrate";
import * as repo from "@/lib/server/db/repo";
import { makeDb, trove, OWNER } from "./helpers";

describe("migrations", () => {
  it("apply idempotently and create every table; gen_random_uuid works without pgcrypto", async () => {
    const db = createPgliteDb("memory://");
    await migrate(db);
    await migrate(db);
    const t = await db.query<{ table_name: string }>(`select table_name from information_schema.tables where table_schema='public' order by 1`);
    expect(t.map((r) => r.table_name)).toEqual([
      "alert_rule_state", "alert_rules", "indexed_events", "indexer_cursors", "loan_positions", "notification_deliveries",
      "notifications", "protective_actions", "protocols", "risk_snapshots", "tracked_wallets", "users", "worker_heartbeats",
    ]);
    const u = await repo.upsertUser(db, OWNER);
    expect(u.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(u.wallet_address).toBe(OWNER.toLowerCase());
    expect((await db.query(`select * from protocols`)).length).toBe(2);
    await db.close();
  });

  it("round-trips numeric(78,0) bigints exactly (incl. the zero-debt ∞ sentinel)", async () => {
    const db = await makeDb();
    const p = { ...trove(), collateralRatio: 2n ** 256n - 1n, debtAmount: 123456789012345678901234567890n };
    const row = await repo.upsertPosition(db, p, "healthy");
    expect(BigInt(row.collateral_ratio)).toBe(2n ** 256n - 1n);
    expect(BigInt(row.debt_amount)).toBe(123456789012345678901234567890n);
    expect(typeof row.onchain_block).toBe("string");
    await db.close();
  });

  it("users upsert is idempotent; tracked wallets unique per user", async () => {
    const db = await makeDb();
    const a = await repo.upsertUser(db, OWNER);
    const b = await repo.upsertUser(db, OWNER.toLowerCase());
    expect(a.id).toBe(b.id);
    await repo.addTrackedWallet(db, a.id, "0x1111111111111111111111111111111111111111", "x");
    await repo.addTrackedWallet(db, a.id, "0x1111111111111111111111111111111111111111", null);
    expect(await repo.listTrackedWallets(db, a.id)).toHaveLength(1);
    const ws = await repo.walletsToMonitor(db);
    expect(ws.map((w) => w.wallet).sort()).toEqual(["0x017ff5fb886e90f9e5adb405d8efddffc1162dd2", "0x1111111111111111111111111111111111111111"]);
    await db.close();
  });
});
