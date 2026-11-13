/**
 * The RepayMUSD signature the protector stores is valid at BorrowerOperationsSignatures until its deadline or until the
 * borrower's nonce moves. `revoke()` cannot move that nonce, and `arm()` refuses a new signature while the previous one
 * is still live. This module detects a live signature and cancels it: the borrower signs a 1-wei RepayMUSD for the
 * current nonce and sends it themselves, which consumes the nonce (and repays 1 wei of their own debt).
 */
import type { Address, Hash, PublicClient } from "viem";
import { zeroAddress } from "viem";
import { borrowerOperationsSignaturesAbi, REPAY_MUSD_TYPES } from "@/lib/chain/abis";
import { MEZO_TESTNET_ID, MUSD_PROTOCOL } from "@/lib/chain/config";
import { protectorAbi } from "./protector-abi";

export const AUTOMATION_DOMAIN = {
  name: "BorrowerOperationsSignatures",
  version: "1",
  chainId: MEZO_TESTNET_ID,
  verifyingContract: MUSD_PROTOCOL.borrowerOperationsSignatures,
} as const;

/** EIP-712 typed data for a RepayMUSD signature (pure; tested). */
export function repayTypedData(args: { amount: bigint; borrower: Address; nonce: bigint; deadline: bigint }) {
  return {
    domain: AUTOMATION_DOMAIN,
    types: REPAY_MUSD_TYPES,
    primaryType: "RepayMUSD" as const,
    message: { amount: args.amount, borrower: args.borrower, nonce: args.nonce, deadline: args.deadline },
  };
}

/** Pure rule shared with the contract's `arm` check. */
export function isSignatureLive(s: { lastNonce: bigint; lastDeadline: bigint; nonce: bigint; now: bigint }): boolean {
  return s.lastDeadline > 0n && s.lastDeadline >= s.now && s.lastNonce === s.nonce;
}

export async function readSignatureState(client: PublicClient, protector: Address, owner: Address) {
  const [lastNonce, lastDeadline, nonce] = await Promise.all([
    client.readContract({ address: protector, abi: protectorAbi, functionName: "lastSignedNonce", args: [owner] }),
    client.readContract({ address: protector, abi: protectorAbi, functionName: "lastSignedDeadline", args: [owner] }),
    client.readContract({ address: MUSD_PROTOCOL.borrowerOperationsSignatures, abi: borrowerOperationsSignaturesAbi, functionName: "getNonce", args: [owner] }),
  ]);
  const now = BigInt(Math.floor(Date.now() / 1000));
  return { live: isSignatureLive({ lastNonce, lastDeadline, nonce, now }), lastDeadline, nonce };
}

type SignTyped = (args: ReturnType<typeof repayTypedData>) => Promise<`0x${string}`>;
type Write = (args: {
  address: Address;
  abi: typeof borrowerOperationsSignaturesAbi;
  functionName: "repayMUSDWithSignature";
  args: readonly [bigint, Address, Address, Address, `0x${string}`, bigint];
  chainId: typeof MEZO_TESTNET_ID;
}) => Promise<Hash>;

/** Consumes the borrower's BorrowerOperationsSignatures nonce so any earlier stored signature stops working. */
export async function cancelLiveSignature(opts: { client: PublicClient; owner: Address; signTypedData: SignTyped; write: Write }): Promise<Hash> {
  const { client, owner } = opts;
  const nonce = await client.readContract({ address: MUSD_PROTOCOL.borrowerOperationsSignatures, abi: borrowerOperationsSignaturesAbi, functionName: "getNonce", args: [owner] });
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const sig = await opts.signTypedData(repayTypedData({ amount: 1n, borrower: owner, nonce, deadline }));
  const args = [1n, zeroAddress, zeroAddress, owner, sig, deadline] as const;
  await client.simulateContract({ address: MUSD_PROTOCOL.borrowerOperationsSignatures, abi: borrowerOperationsSignaturesAbi, functionName: "repayMUSDWithSignature", args, account: owner });
  const hash = await opts.write({ address: MUSD_PROTOCOL.borrowerOperationsSignatures, abi: borrowerOperationsSignaturesAbi, functionName: "repayMUSDWithSignature", args, chainId: MEZO_TESTNET_ID });
  const r = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (r.status !== "success") throw new Error("Cancelling the earlier permission failed on-chain.");
  return hash;
}
