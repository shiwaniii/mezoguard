import type { NextRequest } from "next/server";
import { apiError, handle, json, limit } from "@/lib/server/http";
import { buildPositionDetail, PROTOCOL_IDS } from "@/lib/server/portfolio";
import type { ProtocolId } from "@/lib/risk/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = handle(async (req: NextRequest, ctx: { params: Promise<{ protocol: string; id: string }> }) => {
  const { protocol, id } = await ctx.params;
  if (!(PROTOCOL_IDS as string[]).includes(protocol)) return apiError(400, "Unknown protocol", "BAD_PROTOCOL");
  const positionId = decodeURIComponent(id);
  if (!/^0x[0-9a-fA-F]{40}$|^0x[0-9a-fA-F]{64}:0x[0-9a-fA-F]{40}$/.test(positionId)) return apiError(400, "Invalid position id", "BAD_POSITION_ID");
  const limited = limit(req, "position", 30, 1);
  if (limited) return limited;
  const detail = await buildPositionDetail(protocol as ProtocolId, positionId);
  if (!detail) return apiError(404, "Position not found on-chain", "NOT_FOUND");
  return json(detail);
});
