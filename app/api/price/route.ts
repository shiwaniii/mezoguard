import type { NextRequest } from "next/server";
import { readBtcPrice } from "@/lib/protocols";
import { toWire } from "@/lib/risk";
import { handle, json, limit } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = handle(async (req: NextRequest) => {
  const limited = limit(req, "price", 60, 2);
  if (limited) return limited;
  return json(toWire(await readBtcPrice()));
});
