/** Alert-rule input validation + position resolution for the rules API. */
import "./guard";
import { getAddress, isAddress } from "viem";
import type { AlertTriggerType } from "@/lib/api-types";
import { discoverAll } from "@/lib/protocols";
import { assess } from "@/lib/risk";
import type { Db } from "./db";
import { addTrackedWallet, findPositionByAnyId, upsertPosition, type Channel, type UserRow } from "./db/repo";
import { normalizeThreshold, TRIGGER_TYPES } from "./alerts";

export const CHANNELS: Channel[] = ["in_app", "email", "telegram", "browser"];

export function parseChannels(v: unknown): Channel[] | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  const set = new Set<Channel>();
  for (const c of v) {
    if (typeof c !== "string" || !(CHANNELS as string[]).includes(c)) return null;
    set.add(c as Channel);
  }
  return [...set];
}

export function parseCooldown(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 10_080 ? n : null;
}

export function parseTrigger(v: unknown): AlertTriggerType | null {
  return typeof v === "string" && (TRIGGER_TYPES as string[]).includes(v) ? (v as AlertTriggerType) : null;
}

/**
 * Resolves a rule's positionId (protocol position id or DB uuid) to loan_positions.id. If the position was never
 * synced, discovers the wallet live and upserts its positions first. Returns undefined if it doesn't exist on-chain.
 */
export async function resolvePositionUuid(db: Db, wallet: string, positionId: string): Promise<string | undefined> {
  const found = await findPositionByAnyId(db, positionId, wallet);
  if (found) return found.id;
  const { positions } = await discoverAll(getAddress(wallet));
  for (const p of positions) await upsertPosition(db, p, assess(p).level);
  return (await findPositionByAnyId(db, positionId, wallet))?.id;
}

/** Rules on a wallet other than the user's own auto-track it, so the monitor scans it. */
export async function ensureTracked(db: Db, user: Pick<UserRow, "id" | "wallet_address">, wallet: string): Promise<void> {
  if (wallet.toLowerCase() !== user.wallet_address.toLowerCase()) await addTrackedWallet(db, user.id, wallet, null);
}

export const validAddress = (v: unknown): v is string => typeof v === "string" && isAddress(v);
export { normalizeThreshold };
