import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Hash, TransactionReceipt } from "viem";

const receipts = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/lib/protocols", () => ({
  getPublicClient: () => ({
    getTransactionReceipt: async ({ hash }: { hash: string }) => {
      const r = receipts.get(hash);
      if (!r) throw new Error("TransactionReceiptNotFoundError");
      return r;
    },
  }),
  discoverAll: vi.fn(),
  readBtcPrice: vi.fn(),
  refreshPosition: vi.fn(),
}));

import { NextRequest } from "next/server";
import { MORPHO, MUSD_PROTOCOL } from "@/lib/chain/config";
import { setDb, type Db } from "@/lib/server/db";
import { verifyAndRecordAction } from "@/lib/server/actions";
import { POST } from "@/app/api/actions/route";
import { resetRateLimits } from "@/lib/server/ratelimit";
import { makeDb, OWNER, OTHER } from "./helpers";

process.env.MEZOGUARD_LOG = "silent";
const H = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hash;
const receipt = (from: string, to: string | null, status: "success" | "reverted" = "success") =>
  ({ from, to, status, transactionHash: "0x", blockNumber: 1n }) as unknown as TransactionReceipt;

let db: Db;
beforeEach(async () => {
  db = await makeDb();
  setDb(db);
  receipts.clear();
  resetRateLimits();
});
afterEach(async () => {
  setDb(null);
  await db.close();
});

const post = (body: unknown) =>
  POST(new NextRequest("http://localhost/api/actions", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));

describe("POST /api/actions", () => {
  it("records a repay sent by the wallet to BorrowerOperations", async () => {
    receipts.set(H(1), receipt(OWNER, MUSD_PROTOCOL.borrowerOperations));
    const res = await post({ walletAddress: OWNER, txHash: H(1), actionType: "repay", estimatedAmount: "500000000000000000000" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, status: "confirmed", duplicate: false });
    const rows = await db.query<{ estimated_amount: string; status: string }>(`select * from protective_actions`);
    expect(rows).toHaveLength(1);
    expect(rows[0].estimated_amount).toBe("500000000000000000000");
    // idempotent
    const again = await post({ walletAddress: OWNER, txHash: H(1), actionType: "repay" });
    expect(await again.json()).toMatchObject({ ok: true, duplicate: true });
    expect(await db.query(`select * from protective_actions`)).toHaveLength(1);
  });

  it("rejects a tx to a non-allowlisted contract", async () => {
    receipts.set(H(2), receipt(OWNER, "0x000000000000000000000000000000000000dEaD"));
    const res = await post({ walletAddress: OWNER, txHash: H(2), actionType: "repay" });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: "WRONG_TARGET" });
    expect(await db.query(`select * from protective_actions`)).toHaveLength(0);
  });

  it("rejects a tx sent by someone else", async () => {
    receipts.set(H(3), receipt(OTHER, MORPHO.morpho));
    const res = await post({ walletAddress: OWNER, txHash: H(3), actionType: "repay" });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: "WRONG_SENDER" });
  });

  it("rejects contract creation (to = null), unknown receipts and bad input", async () => {
    receipts.set(H(4), receipt(OWNER, null));
    expect((await post({ walletAddress: OWNER, txHash: H(4), actionType: "repay" })).status).toBe(422);
    expect((await post({ walletAddress: OWNER, txHash: H(5), actionType: "repay" })).status).toBe(404);
    expect((await post({ walletAddress: "nope", txHash: H(5), actionType: "repay" })).status).toBe(400);
    expect((await post({ walletAddress: OWNER, txHash: H(5), actionType: "drain" })).status).toBe(400);
    expect((await post({ walletAddress: OWNER, txHash: H(5), actionType: "repay", estimatedAmount: "-1" })).status).toBe(400);
  });

  it("records a reverted tx as failed", async () => {
    const r = await verifyAndRecordAction(db, { walletAddress: OWNER, txHash: H(6), actionType: "add_collateral" }, async () =>
      receipt(OWNER, MUSD_PROTOCOL.borrowerOperations, "reverted"),
    );
    expect(r).toMatchObject({ ok: true, status: "failed" });
  });

  it("returns 503 DB_DISABLED without a database", async () => {
    setDb(null);
    const res = await post({ walletAddress: OWNER, txHash: H(1), actionType: "repay" });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "DB_DISABLED" });
  });
});

describe("frontend body aliases", () => {
  it("accepts { wallet, action: 'add-collateral' }", async () => {
    receipts.set(H(7), receipt(OWNER, MUSD_PROTOCOL.borrowerOperations));
    const res = await post({ txHash: H(7), wallet: OWNER, protocol: "mezo-musd-trove", positionId: OWNER, action: "add-collateral", chainId: 31611 });
    expect(res.status).toBe(200);
    const rows = await db.query<{ action_type: string }>(`select action_type from protective_actions`);
    expect(rows[0].action_type).toBe("add_collateral");
  });

  describe("Mezo Passport smart accounts (relayed Safe transactions)", () => {
    const SAFE_EXEC = "0x442e715f626346e8c54381002da614f62bee8d27386535b2521ec8540898556e";
    const RELAYER = "0x000000000000000000000000000000000000bee5";
    const log = (address: string, topic0 = "0x" + "11".repeat(32)) => ({ address, topics: [topic0], data: "0x" });
    const safeReceipt = (logs: ReturnType<typeof log>[], to: string = OWNER) =>
      ({ from: RELAYER, to, status: "success", transactionHash: "0x", blockNumber: 1n, logs }) as unknown as TransactionReceipt;

    it("records a repay the wallet's Safe executed against the Trove protocol", async () => {
      receipts.set(H(201), safeReceipt([log(MUSD_PROTOCOL.troveManager), log(OWNER, SAFE_EXEC)]));
      const res = await post({ walletAddress: OWNER, txHash: H(201), actionType: "repay" });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, status: "confirmed" });
    });

    it("records a Morpho repay executed by the Safe", async () => {
      receipts.set(H(202), safeReceipt([log(MORPHO.morpho), log(OWNER, SAFE_EXEC)]));
      expect((await post({ walletAddress: OWNER, txHash: H(202), actionType: "repay" })).status).toBe(200);
    });

    it("rejects a plain transfer to the Safe (no ExecutionSuccess)", async () => {
      receipts.set(H(203), safeReceipt([log(MUSD_PROTOCOL.troveManager)]));
      expect((await post({ walletAddress: OWNER, txHash: H(203), actionType: "repay" })).status).toBe(422);
    });

    it("rejects a Safe execution that touched no supported protocol", async () => {
      receipts.set(H(204), safeReceipt([log(OWNER, SAFE_EXEC), log(OTHER)]));
      expect((await post({ walletAddress: OWNER, txHash: H(204), actionType: "repay" })).status).toBe(422);
    });

    it("rejects another wallet's Safe transaction", async () => {
      receipts.set(H(205), safeReceipt([log(MUSD_PROTOCOL.troveManager), log(OTHER, SAFE_EXEC)], OTHER));
      expect((await post({ walletAddress: OWNER, txHash: H(205), actionType: "repay" })).status).toBe(422);
    });
  });
});
