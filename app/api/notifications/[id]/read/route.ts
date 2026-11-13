import type { NextRequest } from "next/server";
import { markNotificationRead } from "@/lib/server/db/repo";
import { apiError, handle, isUuid, json, requireSession } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const s = requireSession(req);
  if (s instanceof Response) return s;
  const { id } = await ctx.params;
  if (!isUuid(id) || !(await markNotificationRead(s.db, s.session.uid, id))) return apiError(404, "Not found", "NOT_FOUND");
  return json({ ok: true });
});
