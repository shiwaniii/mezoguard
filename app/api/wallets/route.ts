import type { NextRequest } from "next/server";
import { isAddress } from "viem";
import { addTrackedWallet, listTrackedWallets } from "@/lib/server/db/repo";
import { walletDTO } from "@/lib/server/dto";
import { apiError, handle, json, readJson, requireSession } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = handle(async (req: NextRequest) => {
  const s = requireSession(req);
  if (s instanceof Response) return s;
  return json((await listTrackedWallets(s.db, s.session.uid)).map(walletDTO));
});

export const POST = handle(async (req: NextRequest) => {
  const s = requireSession(req);
  if (s instanceof Response) return s;
  const body = await readJson<{ walletAddress?: string; label?: string | null }>(req);
  if (!body?.walletAddress || !isAddress(body.walletAddress)) return apiError(400, "walletAddress must be a valid address", "BAD_ADDRESS");
  const label = typeof body.label === "string" ? body.label.trim().slice(0, 64) || null : null;
  const existing = await listTrackedWallets(s.db, s.session.uid);
  if (existing.length >= 25 && !existing.some((w) => w.wallet_address === body.walletAddress!.toLowerCase())) {
    return apiError(400, "Tracking limit reached (25 wallets)", "LIMIT");
  }
  return json(walletDTO(await addTrackedWallet(s.db, s.session.uid, body.walletAddress, label)), 201);
});
