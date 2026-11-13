/**
 * Records a protective action ONLY after verifying the transaction on-chain: receipt exists, `from` is the wallet,
 * `to` is BorrowerOperations, Morpho, or the MezoGuardProtector. Status comes from the receipt (confirmed | failed).
 * Mezo Passport Bitcoin wallets act through an OrangeKit Safe whose transactions are relayed, so `from` is the relayer:
 * those count when the tx called the wallet's own Safe, the Safe emitted ExecutionSuccess, and a protocol contract
 * (BorrowerOperations, TroveManager, Morpho, protector) emitted a log in the same tx.
 */
import "./guard";
import { getAddress, isAddress, isHash, parseEventLogs, parseAbi, type Address, type Hash, type TransactionReceipt } from "viem";
import { MORPHO, MUSD_PROTOCOL, PROTECTOR_ADDRESS } from "@/lib/chain/config";
import type { Db } from "./db";
import { findPositionByAnyId, insertProtectiveAction } from "./db/repo";

export const ACTION_TYPES = ["repay", "add_collateral", "close", "automation_repay", "withdraw_collateral"] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export function actionTargets(): Address[] {
  return [MUSD_PROTOCOL.borrowerOperations, MORPHO.morpho, ...(PROTECTOR_ADDRESS ? [PROTECTOR_ADDRESS] : [])].map((a) => getAddress(a));
}

export interface ActionInput {
  walletAddress?: unknown;
  /** alias of walletAddress */
  wallet?: unknown;
  txHash: unknown;
  actionType?: unknown;
  /** alias of actionType; hyphenated kinds ("add-collateral") are accepted */
  action?: unknown;
  estimatedAmount?: unknown;
  positionId?: unknown;
}

export type ActionResult =
  | { ok: true; id: string; status: "confirmed" | "failed"; duplicate: boolean }
  | { ok: false; httpStatus: number; error: string; code: string };

export async function verifyAndRecordAction(
  db: Db,
  input: ActionInput,
  getReceipt: (hash: Hash) => Promise<TransactionReceipt | null>,
): Promise<ActionResult> {
  const bad = (error: string, code = "BAD_REQUEST", httpStatus = 400): ActionResult => ({ ok: false, httpStatus, error, code });
  const rawType = input.actionType ?? input.action;
  input = {
    ...input,
    walletAddress: input.walletAddress ?? input.wallet,
    actionType: typeof rawType === "string" ? rawType.replace(/-/g, "_") : rawType,
  };
  if (typeof input.walletAddress !== "string" || !isAddress(input.walletAddress)) return bad("walletAddress must be an address");
  if (typeof input.txHash !== "string" || !isHash(input.txHash)) return bad("txHash must be a 32-byte hex hash");
  if (typeof input.actionType !== "string" || !(ACTION_TYPES as readonly string[]).includes(input.actionType)) {
    return bad(`actionType must be one of ${ACTION_TYPES.join("|")}`);
  }
  let amount = 0n;
  if (input.estimatedAmount !== undefined && input.estimatedAmount !== null) {
    if (typeof input.estimatedAmount !== "string" || !/^\d{1,78}$/.test(input.estimatedAmount)) return bad("estimatedAmount must be a decimal integer string (native units)");
    amount = BigInt(input.estimatedAmount);
  }
  const wallet = getAddress(input.walletAddress);

  let receipt: TransactionReceipt | null;
  try {
    receipt = await getReceipt(input.txHash as Hash);
  } catch {
    receipt = null;
  }
  if (!receipt) return bad("Transaction receipt not found yet — retry after it is mined", "RECEIPT_NOT_FOUND", 404);
  const viaSmartAccount = isSmartAccountProtocolCall(receipt, wallet);
  if (getAddress(receipt.from) !== wallet && !isProtectionFor(receipt, wallet) && !viaSmartAccount) {
    return bad("Transaction was not sent by this wallet", "WRONG_SENDER", 422);
  }
  if (!viaSmartAccount && (!receipt.to || !actionTargets().includes(getAddress(receipt.to)))) {
    return bad("Transaction target is not a supported protocol contract", "WRONG_TARGET", 422);
  }

  let positionUuid: string | null = null;
  if (typeof input.positionId === "string" && input.positionId) {
    positionUuid = (await findPositionByAnyId(db, input.positionId, wallet))?.id ?? null;
  }
  const status = receipt.status === "success" ? "confirmed" : "failed";
  const r = await insertProtectiveAction(db, {
    wallet, positionUuid, actionType: input.actionType, estimatedAmount: amount, txHash: input.txHash, status,
  });
  return { ok: true, id: r.id, status, duplicate: !r.inserted };
}

const protectionEventAbi = parseAbi([
  "event ProtectionExecuted(address indexed borrower, address indexed executor, uint256 repaid, uint256 icrBefore, uint256 icrAfter, uint256 price)",
]);

/** A keeper-sent automation repay counts for `wallet` when our protector emitted ProtectionExecuted(borrower = wallet). */
function isProtectionFor(receipt: TransactionReceipt, wallet: Address): boolean {
  if (!PROTECTOR_ADDRESS) return false;
  const protector = getAddress(PROTECTOR_ADDRESS);
  const logs = receipt.logs.filter((l) => getAddress(l.address) === protector);
  return parseEventLogs({ abi: protectionEventAbi, logs, eventName: "ProtectionExecuted" }).some(
    (e) => getAddress(e.args.borrower) === wallet,
  );
}

/** Safe `ExecutionSuccess(bytes32 txHash, uint256 payment)`; only emitted after the Safe's owners authorised the call. */
const SAFE_EXECUTION_SUCCESS = "0x442e715f626346e8c54381002da614f62bee8d27386535b2521ec8540898556e";

/** A Mezo Passport smart-account (Safe) transaction from `wallet` that reached a supported protocol contract. */
function isSmartAccountProtocolCall(receipt: TransactionReceipt, wallet: Address): boolean {
  if (!receipt.to || getAddress(receipt.to) !== wallet) return false;
  const logs = receipt.logs ?? [];
  const executed = logs.some((l) => getAddress(l.address) === wallet && l.topics[0]?.toLowerCase() === SAFE_EXECUTION_SUCCESS);
  if (!executed) return false;
  const protocol = new Set([...actionTargets(), getAddress(MUSD_PROTOCOL.troveManager)]);
  return logs.some((l) => protocol.has(getAddress(l.address)));
}
