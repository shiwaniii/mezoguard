import type { NextRequest } from "next/server";
import type { SessionResponse } from "@/lib/api-types";
import { getDb } from "@/lib/server/db";
import { upsertUser } from "@/lib/server/db/repo";
import { apiError, dbDisabled, handle, json, limit, readJson, requestDomain } from "@/lib/server/http";
import { cookieOptions, createSessionToken, NONCE_COOKIE, SESSION_COOKIE, SessionConfigError, verifySignIn } from "@/lib/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = handle(async (req: NextRequest) => {
  const limited = limit(req, "auth", 20, 0.2);
  if (limited) return limited;
  const db = getDb();
  if (!db) return dbDisabled();
  const body = await readJson<{ address?: string; message?: string; signature?: string }>(req);
  if (!body?.address || !body.message || !body.signature) return apiError(400, "address, message and signature are required", "BAD_REQUEST");
  try {
    const v = await verifySignIn({
      address: body.address,
      message: body.message,
      signature: body.signature,
      nonceCookie: req.cookies.get(NONCE_COOKIE)?.value,
      domain: requestDomain(req),
    });
    if (!v.ok) return apiError(401, v.error, "BAD_SIGNATURE");
    const user = await upsertUser(db, v.address);
    const { token, maxAge } = createSessionToken(user.id, v.address);
    const res = json<SessionResponse>({ address: v.address, userId: user.id, dbEnabled: true });
    res.cookies.set(SESSION_COOKIE, token, cookieOptions(maxAge));
    res.cookies.set(NONCE_COOKIE, "", cookieOptions(0)); // single use
    return res;
  } catch (e) {
    if (e instanceof SessionConfigError) return apiError(503, e.message, "SESSION_DISABLED");
    throw e;
  }
});
