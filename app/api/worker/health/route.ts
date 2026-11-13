import { getDb } from "@/lib/server/db";
import { getHeartbeat } from "@/lib/server/db/repo";
import { healthDTO } from "@/lib/server/dto";
import { handle, json } from "@/lib/server/http";
import { DEFAULT_WORKER } from "@/lib/server/monitor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Healthy iff the last cycle finished < 3 × MONITOR_INTERVAL_SECONDS ago and didn't end in "error". */
export const GET = handle(async () => {
  const db = getDb();
  if (!db) return json({ ...healthDTO(null, DEFAULT_WORKER), lastError: "database not configured" }, 503);
  // Most recently finished worker (Render "monitor" loop or Vercel "cron").
  const dto = healthDTO(await getHeartbeat(db), DEFAULT_WORKER);
  return json(dto, dto.healthy ? 200 : 503);
});
