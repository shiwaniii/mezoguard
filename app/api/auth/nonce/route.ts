import type { NextRequest } from "next/server";
import { getAddress, isAddress } from "viem";
import { apiError, handle, json, limit, requestDomain } from "@/lib/server/http";
import { cookieOptions, createNonce, NONCE_COOKIE, SessionConfigError } from "@/lib/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/auth/nonce?address=0x… → { message } (address optional but recommended; it is embedded in the message). */
export const GET = handle(async (req: NextRequest) => {
  const limited = limit(req, "auth", 20, 0.2);
  if (limited) return limited;
  const a = req.nextUrl.searchParams.get("address");
  if (a && !isAddress(a)) return apiError(400, "Invalid address", "BAD_ADDRESS");
  try {
    const n = createNonce(requestDomain(req), a ? getAddress(a) : null);
    const res = json({ message: n.message });
    res.cookies.set(NONCE_COOKIE, n.cookie, cookieOptions(n.maxAge));
    return res;
  } catch (e) {
    if (e instanceof SessionConfigError) return apiError(503, e.message, "SESSION_DISABLED");
    throw e;
  }
});
