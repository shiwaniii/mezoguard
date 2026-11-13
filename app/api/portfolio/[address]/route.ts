import type { NextRequest } from "next/server";
import { getAddress, isAddress } from "viem";
import { apiError, handle, json, limit } from "@/lib/server/http";
import { getPortfolioCached } from "@/lib/server/portfolio";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = handle(async (req: NextRequest, ctx: { params: Promise<{ address: string }> }) => {
  const { address } = await ctx.params;
  if (!isAddress(address)) return apiError(400, "Invalid wallet address", "BAD_ADDRESS");
  const limited = limit(req, "portfolio", 20, 0.5);
  if (limited) return limited;
  const { value, cached } = await getPortfolioCached(getAddress(address));
  return json(value, { headers: { "X-Cache": cached ? "HIT" : "MISS" } });
});
