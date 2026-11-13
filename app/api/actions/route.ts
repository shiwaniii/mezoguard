import type { NextRequest } from "next/server";
import { getPublicClient } from "@/lib/protocols";
import { verifyAndRecordAction, type ActionInput } from "@/lib/server/actions";
import { getDb } from "@/lib/server/db";
import { apiError, dbDisabled, handle, json, limit, readJson } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST { walletAddress, txHash, actionType, estimatedAmount?, positionId? } — verified against the on-chain receipt. */
export const POST = handle(async (req: NextRequest) => {
  const limited = limit(req, "actions", 20, 0.5);
  if (limited) return limited;
  const db = getDb();
  if (!db) return dbDisabled();
  const body = await readJson<Record<string, unknown>>(req);
  if (!body) return apiError(400, "JSON body required", "BAD_REQUEST");
  const client = getPublicClient();
  const r = await verifyAndRecordAction(db, body as unknown as ActionInput, (hash) => client.getTransactionReceipt({ hash }));
  if (!r.ok) return apiError(r.httpStatus, r.error, r.code);
  return json({ ok: true, id: r.id, status: r.status, duplicate: r.duplicate });
});
