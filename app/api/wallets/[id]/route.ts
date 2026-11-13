import type { NextRequest } from "next/server";
import { deleteTrackedWallet, updateTrackedWallet } from "@/lib/server/db/repo";
import { walletDTO } from "@/lib/server/dto";
import { apiError, handle, isUuid, json, readJson, requireSession } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handle(async (req: NextRequest, ctx: Ctx) => {
  const s = requireSession(req);
  if (s instanceof Response) return s;
  const { id } = await ctx.params;
  if (!isUuid(id)) return apiError(404, "Not found", "NOT_FOUND");
  const body = await readJson<{ label?: string | null; trackingStatus?: string }>(req);
  if (!body) return apiError(400, "JSON body required", "BAD_REQUEST");
  if (body.trackingStatus !== undefined && body.trackingStatus !== "active" && body.trackingStatus !== "paused") {
    return apiError(400, "trackingStatus must be active|paused", "BAD_REQUEST");
  }
  const row = await updateTrackedWallet(s.db, s.session.uid, id, {
    label: body.label === undefined ? undefined : typeof body.label === "string" ? body.label.trim().slice(0, 64) || null : null,
    trackingStatus: body.trackingStatus as "active" | "paused" | undefined,
  });
  return row ? json(walletDTO(row)) : apiError(404, "Not found", "NOT_FOUND");
});

export const DELETE = handle(async (req: NextRequest, ctx: Ctx) => {
  const s = requireSession(req);
  if (s instanceof Response) return s;
  const { id } = await ctx.params;
  if (!isUuid(id) || !(await deleteTrackedWallet(s.db, s.session.uid, id))) return apiError(404, "Not found", "NOT_FOUND");
  return json({ ok: true });
});
