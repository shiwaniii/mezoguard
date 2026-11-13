import type { NextRequest } from "next/server";
import { deleteRule, getRule, updateRule } from "@/lib/server/db/repo";
import { ruleDTO } from "@/lib/server/dto";
import { apiError, handle, isUuid, json, readJson, requireSession } from "@/lib/server/http";
import { normalizeThreshold, parseChannels, parseCooldown } from "@/lib/server/rules";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handle(async (req: NextRequest, ctx: Ctx) => {
  const s = requireSession(req);
  if (s instanceof Response) return s;
  const { id } = await ctx.params;
  const existing = isUuid(id) ? await getRule(s.db, s.session.uid, id) : null;
  if (!existing) return apiError(404, "Not found", "NOT_FOUND");
  const b = await readJson<Record<string, unknown>>(req);
  if (!b) return apiError(400, "JSON body required", "BAD_REQUEST");
  const patch: Parameters<typeof updateRule>[3] = {};
  if (b.threshold !== undefined) {
    const th = normalizeThreshold(existing.trigger_type, String(b.threshold));
    if (!th.ok) return apiError(400, th.error, "BAD_THRESHOLD");
    patch.threshold = th.value;
  }
  if (b.channels !== undefined) {
    const c = parseChannels(b.channels);
    if (!c) return apiError(400, "channels must be a non-empty subset of in_app|email|telegram|browser", "BAD_CHANNELS");
    patch.channels = c;
  }
  if (b.cooldownMinutes !== undefined) {
    const c = parseCooldown(b.cooldownMinutes);
    if (c === null) return apiError(400, "cooldownMinutes must be an integer 1..10080", "BAD_COOLDOWN");
    patch.cooldownMinutes = c;
  }
  if (b.enabled !== undefined) patch.enabled = Boolean(b.enabled);
  await updateRule(s.db, s.session.uid, id, patch);
  const row = await getRule(s.db, s.session.uid, id);
  return row ? json(ruleDTO(row)) : apiError(404, "Not found", "NOT_FOUND");
});

export const DELETE = handle(async (req: NextRequest, ctx: Ctx) => {
  const s = requireSession(req);
  if (s instanceof Response) return s;
  const { id } = await ctx.params;
  if (!isUuid(id) || !(await deleteRule(s.db, s.session.uid, id))) return apiError(404, "Not found", "NOT_FOUND");
  return json({ ok: true });
});
