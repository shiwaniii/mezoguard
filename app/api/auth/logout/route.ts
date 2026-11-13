import type { SessionResponse } from "@/lib/api-types";
import { getDb } from "@/lib/server/db";
import { handle, json } from "@/lib/server/http";
import { cookieOptions, SESSION_COOKIE } from "@/lib/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = handle(async () => {
  const res = json<SessionResponse>({ address: null, userId: null, dbEnabled: getDb() !== null });
  res.cookies.set(SESSION_COOKIE, "", cookieOptions(0));
  return res;
});
