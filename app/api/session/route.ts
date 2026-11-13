import type { NextRequest } from "next/server";
import type { SessionResponse } from "@/lib/api-types";
import { getDb } from "@/lib/server/db";
import { getSession, handle, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = handle(async (req: NextRequest) => {
  const dbEnabled = getDb() !== null;
  const s = dbEnabled ? getSession(req) : null;
  return json<SessionResponse>({ address: s?.addr ?? null, userId: s?.uid ?? null, dbEnabled });
});
