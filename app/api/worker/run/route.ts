import crypto from "node:crypto";
import type { NextRequest } from "next/server";
import { getDb } from "@/lib/server/db";
import { apiError, dbDisabled, handle, json } from "@/lib/server/http";
import { runMonitorCycle } from "@/lib/server/monitor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = req.headers.get("authorization") ?? "";
  const want = `Bearer ${secret}`;
  const a = Buffer.from(got);
  const b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Runs one monitor cycle. Vercel Cron calls GET with `Authorization: Bearer $CRON_SECRET`. */
const run = handle(async (req: NextRequest) => {
  if (!process.env.CRON_SECRET) return apiError(503, "CRON_SECRET not configured", "CRON_DISABLED");
  if (!authorized(req)) return apiError(401, "Unauthorized", "UNAUTHORIZED");
  if (!getDb()) return dbDisabled();
  const report = await runMonitorCycle({ worker: "cron" });
  return json(report, report.status === "error" ? 500 : 200);
});

export const GET = run;
export const POST = run;
