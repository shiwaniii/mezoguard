import type { NextRequest } from "next/server";
import { deliveriesFor, listNotifications } from "@/lib/server/db/repo";
import { notificationDTO } from "@/lib/server/dto";
import { handle, json, requireSession } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/notifications[?unread=1] — newest first, max 100. Frontend polls this for in-app + browser notifications. */
export const GET = handle(async (req: NextRequest) => {
  const s = requireSession(req);
  if (s instanceof Response) return s;
  const unread = req.nextUrl.searchParams.get("unread") === "1";
  const rows = await listNotifications(s.db, s.session.uid, unread);
  const deliveries = await deliveriesFor(s.db, rows.map((r) => r.id));
  return json(rows.map((r) => notificationDTO(r, deliveries)));
});
