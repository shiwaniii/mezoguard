/** In-app: the notifications row IS the delivery (read via GET /api/notifications). */
import "../guard";
import type { ChannelResult } from "./types";

export function deliverInApp(): ChannelResult {
  return { status: "sent", providerId: "db" };
}

/** Browser notifications are raised client-side by an open MezoGuard tab polling /api/notifications. */
export function deliverBrowser(): ChannelResult {
  return { status: "skipped", reason: "client-side: shown by an open MezoGuard tab polling /api/notifications" };
}
