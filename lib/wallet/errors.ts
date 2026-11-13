/** Turns wallet / RPC / API errors into one plain sentence. */
import { fmtAmount } from "./plans";

export function insufficientBalanceMessage(symbol: string, need: bigint, have: bigint, decimals: number): string {
  const d = symbol === "BTC" ? 6 : 2;
  return `Not enough ${symbol} in this wallet. You need ${fmtAmount(need, decimals, symbol, d)}, you have ${fmtAmount(have, decimals, symbol, d)}.`;
}

export function humanizeError(e: unknown): string {
  const anyE = e as { shortMessage?: string; message?: string; name?: string; code?: number; cause?: unknown } | null;
  const text = `${anyE?.name ?? ""} ${anyE?.shortMessage ?? ""} ${anyE?.message ?? ""}`;
  const code = anyE?.code ?? (anyE?.cause as { code?: number } | undefined)?.code;
  if (code === 4001 || /UserRejected|User rejected|user denied|rejected the request/i.test(text)) {
    return "You cancelled the request in your wallet. Nothing was sent.";
  }
  if (/ChainMismatch|does not match the target chain|wrong network/i.test(text)) {
    return "Your wallet is on a different network. Switch to Mezo Testnet and try again.";
  }
  if (/insufficient funds/i.test(text)) return "Not enough BTC in this wallet to pay for this transaction and its gas.";
  if (/AboveTrigger/i.test(text)) return "Your loan is above the trigger, so automation will not run yet.";
  if (/Expired/i.test(text)) return "The signature has expired. Set up automation again.";
  if (/PreviousSignatureLive/i.test(text)) {
    return "Your earlier repay permission is still valid. Cancel it first (one signature and a 1-wei repay), then try again.";
  }
  if (/TroveNotActive/i.test(text)) return "This Trove is closed, so automatic repay cannot run for it.";
  if (/RepayLeavesIcrBelowMcr/i.test(text)) {
    return "This repay would still leave the loan below 110%, so Mezo would refuse it. Use a larger repay amount.";
  }
  if (/InvalidParams/i.test(text)) {
    return "Check the settings: the trigger must be 120% to 1000%, the amount above 0 and the expiry within 90 days.";
  }
  if (/InsufficientBudget/i.test(text)) return "The automation budget is smaller than the repay amount. Deposit more MUSD first.";
  if (/ICR < MCR|would result in ICR|CR < MCR|ICR below MCR/i.test(text)) {
    return "This change would push the loan below the minimum ratio, so the protocol refused it.";
  }
  if (/net debt must be|minimum net debt|MinNetDebt/i.test(text)) {
    return "A Trove has to keep the minimum debt. Repay less, or close the Trove instead.";
  }
  if (/execution reverted|reverted/i.test(text)) {
    const reason = anyE?.shortMessage?.replace(/^.*reverted[^:]*:?\s*/i, "").trim();
    return reason ? `The contract refused this transaction: ${reason}` : "The contract refused this transaction. Nothing changed.";
  }
  if (/fetch failed|Failed to fetch|NetworkError|timeout|timed out/i.test(text)) {
    return "Could not reach the network. Check your connection and try again.";
  }
  const msg = anyE?.shortMessage || anyE?.message;
  return msg ? msg.split("\n")[0] : "Something went wrong. Please try again.";
}
