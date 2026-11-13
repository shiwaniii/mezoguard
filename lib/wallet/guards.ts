/** Pre-send checks shared by every transaction flow (pure, tested). */
import { MEZO_TESTNET_ID } from "@/lib/chain/config";

export type GuardProblem = "not-connected" | "wrong-network" | "wrong-account";

export interface GuardResult {
  ok: boolean;
  problem?: GuardProblem;
  message?: string;
}

export function checkTxGuards(input: { account?: string; chainId?: number; owner: string }): GuardResult {
  if (!input.account) return { ok: false, problem: "not-connected", message: "Connect the wallet that owns this loan." };
  if (input.chainId !== MEZO_TESTNET_ID) {
    return { ok: false, problem: "wrong-network", message: "Your wallet is on another network. Switch to Mezo Testnet (chain 31611) to continue." };
  }
  if (input.account.toLowerCase() !== input.owner.toLowerCase()) {
    return {
      ok: false,
      problem: "wrong-account",
      message: "The connected wallet does not own this loan. Switch to the owner's account in your wallet.",
    };
  }
  return { ok: true };
}
