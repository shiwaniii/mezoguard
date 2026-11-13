import type { NextRequest } from "next/server";
import { getUser, updateUserSettings } from "@/lib/server/db/repo";
import { settingsDTO } from "@/lib/server/dto";
import { apiError, handle, json, readJson, requireSession } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = handle(async (req: NextRequest) => {
  const s = requireSession(req);
  if (s instanceof Response) return s;
  const u = await getUser(s.db, s.session.uid);
  return u ? json(settingsDTO(u)) : apiError(401, "Session user no longer exists", "UNAUTHENTICATED");
});

export const PUT = handle(async (req: NextRequest) => {
  const s = requireSession(req);
  if (s instanceof Response) return s;
  const b = await readJson<{ email?: unknown; telegramChatId?: unknown; timezone?: unknown }>(req);
  if (!b) return apiError(400, "JSON body required", "BAD_REQUEST");
  const patch: { email?: string | null; telegramChatId?: string | null; timezone?: string } = {};
  if (b.email !== undefined) {
    const e = typeof b.email === "string" ? b.email.trim() : b.email;
    if (e === null || e === "") patch.email = null;
    else if (typeof e === "string" && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) patch.email = e;
    else return apiError(400, "Invalid email", "BAD_EMAIL");
  }
  if (b.telegramChatId !== undefined) {
    const t = typeof b.telegramChatId === "number" ? String(b.telegramChatId) : typeof b.telegramChatId === "string" ? b.telegramChatId.trim() : b.telegramChatId;
    if (t === null || t === "") patch.telegramChatId = null;
    else if (typeof t === "string" && /^(-?\d{1,20}|@[A-Za-z0-9_]{5,32})$/.test(t)) patch.telegramChatId = t;
    else return apiError(400, "Invalid Telegram chat id (numeric id or @channel)", "BAD_TELEGRAM");
  }
  if (b.timezone !== undefined) {
    let ok = typeof b.timezone === "string" && b.timezone.length <= 64;
    if (ok) {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: b.timezone as string });
      } catch {
        ok = false;
      }
    }
    if (!ok) return apiError(400, "Invalid IANA timezone", "BAD_TIMEZONE");
    patch.timezone = b.timezone as string;
  }
  const u = await updateUserSettings(s.db, s.session.uid, patch);
  return u ? json(settingsDTO(u)) : apiError(401, "Session user no longer exists", "UNAUTHENTICATED");
});
