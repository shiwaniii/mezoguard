import type { NextRequest } from "next/server";
import { createRule, getRule, getUser, listRules } from "@/lib/server/db/repo";
import { ruleDTO } from "@/lib/server/dto";
import { apiError, handle, json, readJson, requireSession } from "@/lib/server/http";
import { ensureTracked, normalizeThreshold, parseChannels, parseCooldown, parseTrigger, resolvePositionUuid, validAddress } from "@/lib/server/rules";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = handle(async (req: NextRequest) => {
  const s = requireSession(req);
  if (s instanceof Response) return s;
  return json((await listRules(s.db, s.session.uid)).map(ruleDTO));
});

export const POST = handle(async (req: NextRequest) => {
  const s = requireSession(req);
  if (s instanceof Response) return s;
  const b = await readJson<Record<string, unknown>>(req);
  if (!b) return apiError(400, "JSON body required", "BAD_REQUEST");
  const wallet = b.walletAddress ?? s.session.addr;
  if (!validAddress(wallet)) return apiError(400, "walletAddress must be a valid address", "BAD_ADDRESS");
  const trigger = parseTrigger(b.triggerType);
  if (!trigger) return apiError(400, "triggerType must be one of cr_below|btc_drop_pct|level_at_least|redemption|liquidation_price_within_pct", "BAD_TRIGGER");
  const th = normalizeThreshold(trigger, b.threshold as string | undefined);
  if (!th.ok) return apiError(400, th.error, "BAD_THRESHOLD");
  const channels = b.channels === undefined ? ["in_app" as const] : parseChannels(b.channels);
  if (!channels) return apiError(400, "channels must be a non-empty subset of in_app|email|telegram|browser", "BAD_CHANNELS");
  const cooldown = b.cooldownMinutes === undefined ? 60 : parseCooldown(b.cooldownMinutes);
  if (cooldown === null) return apiError(400, "cooldownMinutes must be an integer 1..10080", "BAD_COOLDOWN");
  const user = await getUser(s.db, s.session.uid);
  if (!user) return apiError(401, "Session user no longer exists", "UNAUTHENTICATED");

  let positionUuid: string | null = null;
  if (typeof b.positionId === "string" && b.positionId) {
    positionUuid = (await resolvePositionUuid(s.db, wallet, b.positionId)) ?? null;
    if (!positionUuid) return apiError(404, "Position not found for this wallet", "POSITION_NOT_FOUND");
  }
  await ensureTracked(s.db, user, wallet);
  const rule = await createRule(s.db, {
    userId: user.id, wallet, positionUuid, triggerType: trigger, threshold: th.value, channels, cooldownMinutes: cooldown,
    enabled: b.enabled === undefined ? true : Boolean(b.enabled),
  });
  return json(ruleDTO((await getRule(s.db, user.id, rule.id)) ?? rule), 201);
});
