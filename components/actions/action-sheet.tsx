"use client";
import * as React from "react";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { ArrowRight, CheckCircle2, ExternalLink } from "lucide-react";
import type { Address, PublicClient } from "viem";
import { erc20Abi, morphoAbi } from "@/lib/chain/abis";
import { BTC_TOKEN, MEZO_TESTNET_ID, MORPHO, MUSD_PROTOCOL, explorerTx } from "@/lib/chain/config";
import { DEFAULT_THRESHOLDS, defaultTargetRatio, levelForRatio } from "@/lib/risk";
import type { Position, Recommendation, RiskLevel } from "@/lib/risk/types";
import { fmtRatio, fmtUnits, fmtUsd, parseUnitsSafe } from "@/lib/format";
import {
  GAS_RESERVE_WEI,
  NO_HINTS,
  addCollForTarget,
  buildMorphoRepay,
  buildMorphoSupplyCollateral,
  buildTroveAddColl,
  buildTroveClose,
  buildTroveRepay,
  buildTroveWithdrawColl,
  estimateImpact,
  repayForTarget,
  troveCloseCost,
  troveMaxRepay,
  type ActionKind,
  type ActionPlan,
  type Hints,
  type TxStep,
} from "@/lib/wallet/plans";
import { fetchTroveHints } from "@/lib/wallet/hints";
import { protectorAbi } from "@/lib/wallet/protector-abi";
import { checkTxGuards } from "@/lib/wallet/guards";
import { humanizeError, insufficientBalanceMessage } from "@/lib/wallet/errors";
import { api } from "@/lib/wallet/api";
import { fetchPositionDetail, portfolioKey, positionKey } from "@/hooks/use-portfolio";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { RiskBadge } from "@/components/risk/risk-badge";
import { TxGuard } from "./network-guard";
import { TxPreview } from "./tx-preview";
import { cn } from "@/components/ui/cn";

type Status =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "wallet"; step: string }
  | { phase: "pending"; step: string; hash: `0x${string}` }
  | { phase: "done"; hash: `0x${string}` }
  | { phase: "error"; message: string; hash?: `0x${string}` };

const KIND_LABEL: Record<ActionKind, string> = {
  repay: "Repay",
  "add-collateral": "Add collateral",
  close: "Close loan",
  "withdraw-collateral": "Withdraw",
};

export function supportedKinds(p: Position): ActionKind[] {
  return p.protocol === "mezo-musd-trove" ? ["repay", "add-collateral", "close", "withdraw-collateral"] : ["repay", "add-collateral"];
}

function levelAfter(p: Position, ratio: bigint): RiskLevel {
  if (ratio <= p.liquidationRatio) return "liquidatable";
  return levelForRatio(ratio, p.liquidationRatio, DEFAULT_THRESHOLDS);
}

function amountDecimals(p: Position, kind: ActionKind) {
  return kind === "repay" || kind === "close" ? p.debtAsset.decimals : p.collateralAsset.decimals;
}
function amountSymbol(p: Position, kind: ActionKind) {
  return kind === "repay" || kind === "close" ? p.debtAsset.symbol : p.collateralAsset.symbol;
}

/** Morpho borrow shares (needed to repay everything without leaving dust). */
async function readBorrowShares(client: PublicClient, p: Position): Promise<bigint> {
  if (p.params.kind !== "morpho") return 0n;
  const [, borrowShares] = await client.readContract({
    address: MORPHO.morpho,
    abi: morphoAbi,
    functionName: "position",
    args: [p.params.marketId, p.owner],
  });
  return BigInt(borrowShares);
}

export function buildPlan(
  p: Position,
  kind: ActionKind,
  amount: bigint,
  opts: { hints?: Hints; fullRepay?: boolean; borrowShares?: bigint } = {},
): ActionPlan {
  const hints = opts.hints ?? NO_HINTS;
  if (p.protocol === "mezo-musd-trove") {
    if (kind === "repay") return buildTroveRepay(p, amount, hints);
    if (kind === "add-collateral") return buildTroveAddColl(p, amount, hints);
    if (kind === "withdraw-collateral") return buildTroveWithdrawColl(p, amount, hints);
    return buildTroveClose(p);
  }
  if (kind === "repay") return buildMorphoRepay(p, { amount, full: !!opts.fullRepay, borrowShares: opts.borrowShares });
  return buildMorphoSupplyCollateral(p, amount);
}

/** What the wallet must hold for this plan: [token (BTC_TOKEN = native), amount, symbol, decimals]. */
/** True when this wallet has an armed rule or a budget in the protector (so the close flow must revoke first). */
async function protectorHasRule(client: PublicClient, protector: Address, owner: Address): Promise<boolean> {
  const r = await client.readContract({ address: protector, abi: protectorAbi, functionName: "ruleOf", args: [owner] });
  return r.armed || r.budget > 0n;
}

function requirement(p: Position, plan: ActionPlan, amount: bigint): { token: Address | "native"; need: bigint; symbol: string; decimals: number } | null {
  if (plan.kind === "withdraw-collateral") return null;
  if (p.protocol === "mezo-musd-trove") {
    if (plan.kind === "add-collateral") return { token: "native", need: amount + GAS_RESERVE_WEI, symbol: "BTC", decimals: 18 };
    const step = plan.steps[plan.steps.length - 1];
    const need = plan.kind === "close" ? troveCloseCost(p) : (step.args[0] as bigint);
    return { token: MUSD_PROTOCOL.musd, need, symbol: "MUSD", decimals: 18 };
  }
  const approve = plan.steps.find((s) => s.approval);
  if (!approve?.approval) return null;
  const isBtc = approve.approval.token.toLowerCase() === BTC_TOKEN.toLowerCase();
  if (plan.kind === "add-collateral") {
    return isBtc
      ? { token: "native", need: amount + GAS_RESERVE_WEI, symbol: "BTC", decimals: 18 }
      : { token: approve.approval.token, need: amount, symbol: p.collateralAsset.symbol, decimals: p.collateralAsset.decimals };
  }
  // Morpho repay: full repay needs the live debt; partial needs `amount`.
  const need = plan.notes.length > 0 ? p.debtAmount : amount;
  return { token: approve.approval.token, need, symbol: p.debtAsset.symbol, decimals: p.debtAsset.decimals };
}

async function readBalance(client: PublicClient, owner: Address, token: Address | "native"): Promise<bigint> {
  if (token === "native") return client.getBalance({ address: owner });
  return client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [owner] });
}

export function ActionSheet({
  position,
  recommendation,
  open,
  onOpenChange,
  initialKind = "repay",
  initialAmount,
}: {
  position: Position;
  recommendation?: Recommendation;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initialKind?: ActionKind;
  initialAmount?: bigint;
}) {
  const p = position;
  const kinds = supportedKinds(p);
  // The sheet is mounted fresh each time it opens, so props seed the initial state directly.
  const [kind, setKind] = React.useState<ActionKind>(kinds.includes(initialKind) ? initialKind : "repay");
  const targetDefault = recommendation?.targetRatio && recommendation.targetRatio > 0n ? recommendation.targetRatio : defaultTargetRatio(p);
  const [targetPct, setTargetPct] = React.useState(() => fmtRatio(targetDefault).replace("%", ""));
  const [amountStr, setAmountStr] = React.useState(() => {
    if (!initialAmount || initialAmount <= 0n) return "";
    const d = amountDecimals(p, initialKind);
    return fmtUnits(initialAmount, d, d).replace(/,/g, "");
  });
  const [fullRepay, setFullRepay] = React.useState(false);
  const [status, setStatus] = React.useState<Status>({ phase: "idle" });
  const [guardOk, setGuardOk] = React.useState(false);
  const [hints, setHints] = React.useState<Hints>(NO_HINTS);
  const [gas, setGas] = React.useState<Record<string, bigint | "error" | undefined>>({});
  const [skipped, setSkipped] = React.useState<Record<string, boolean>>({});
  const [balance, setBalance] = React.useState<bigint | null>(null);
  const [shares, setShares] = React.useState<bigint | undefined>(undefined);
  const reduce = useReducedMotion();

  const { address } = useAccount();
  const client = usePublicClient({ chainId: MEZO_TESTNET_ID }) as PublicClient | undefined;
  const write = useWriteContract();
  const qc = useQueryClient();

  const dec = amountDecimals(p, kind);
  const sym = amountSymbol(p, kind);
  const parsed = kind === "close" ? troveCloseCost(p) : parseUnitsSafe(amountStr, dec);
  const amount = parsed ?? 0n;
  const amountError = kind !== "close" && amountStr.trim() !== "" && parsed === null ? `Enter a number with at most ${dec} decimals.` : null;

  const plan = buildPlan(p, kind, fullRepay && !shares ? p.debtAmount : amount, { hints, fullRepay, borrowShares: fullRepay ? shares : undefined });
  const impactAmount = kind === "repay" && p.protocol === "mezo-musd-trove" ? (plan.steps[0].args[0] as bigint) : fullRepay ? p.debtAmount : amount;
  const impact = estimateImpact(p, kind, impactAmount);
  const req = requirement(p, plan, amount);

  // Live reads for the preview: hints, approvals, balance, gas. Debounced.
  React.useEffect(() => {
    if (!open || !client || !address) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        let h = NO_HINTS;
        if (p.protocol === "mezo-musd-trove" && kind !== "close" && amount > 0n) {
          const coll = kind === "add-collateral" ? p.collateralAmount + amount : kind === "withdraw-collateral" ? p.collateralAmount - amount : p.collateralAmount;
          const principal = p.debtPrincipal ?? p.debtAmount;
          const interest = p.debtInterest ?? 0n;
          const repaidPrincipal = kind === "repay" && amount > interest ? amount - interest : 0n;
          h = await fetchTroveHints(client, coll, principal - repaidPrincipal);
        }
        if (cancelled) return;
        setHints((old) => (old.upper === h.upper && old.lower === h.lower ? old : h));
        const sh = fullRepay ? await readBorrowShares(client, p) : undefined;
        if (!cancelled) setShares(sh);
        const live = buildPlan(p, kind, amount, { hints: h, fullRepay, borrowShares: sh });
        const r = requirement(p, live, amount);
        if (r) setBalance(await readBalance(client, address, r.token));
        const sk: Record<string, boolean> = {};
        const g: Record<string, bigint | "error" | undefined> = {};
        let blocked = false;
        for (const s of live.steps) {
          if (s.protectorCleanup && !(await protectorHasRule(client, s.address, address))) {
            sk[s.key] = true;
            continue;
          }
          if (s.approval) {
            const allowance = await client.readContract({ address: s.approval.token, abi: erc20Abi, functionName: "allowance", args: [address, s.approval.spender] });
            if (allowance >= s.approval.amount) {
              sk[s.key] = true;
              continue;
            }
            blocked = true;
          } else if (blocked) {
            g[s.key] = "error";
            continue;
          }
          if (amount === 0n && kind !== "close") continue;
          try {
            g[s.key] = await client.estimateContractGas({ address: s.address, abi: s.abi, functionName: s.functionName, args: s.args as unknown[], value: s.value, account: address });
          } catch {
            g[s.key] = "error";
          }
        }
        if (!cancelled) {
          setSkipped(sk);
          setGas(g);
        }
      } catch {
        /* preview reads are best-effort; the send path re-checks everything */
      }
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open, client, address, p, kind, amount, fullRepay]);

  const maxRepay = p.protocol === "mezo-musd-trove" ? troveMaxRepay(p) : p.debtAmount;
  const targetRatio = (() => {
    const v = parseUnitsSafe(targetPct, 16);
    return v && v > 0n ? v : targetDefault;
  })();
  const toTarget = kind === "repay" ? repayForTarget(p, targetRatio) : kind === "add-collateral" ? addCollForTarget(p, targetRatio) : 0n;
  const repayTooBig = kind === "repay" && p.protocol === "mezo-musd-trove" && toTarget > maxRepay;
  const insufficient = req && balance !== null && balance < req.need ? insufficientBalanceMessage(req.symbol, req.need, balance, req.decimals) : null;
  const busy = status.phase === "checking" || status.phase === "wallet" || status.phase === "pending";
  const canSend = guardOk && !busy && status.phase !== "done" && (kind === "close" || fullRepay || amount > 0n) && !amountError && !insufficient;

  async function send() {
    if (!client || !address) return;
    setStatus({ phase: "checking" });
    try {
      // 1. Fresh on-chain state, not the cached portfolio.
      const fresh = (await fetchPositionDetail(p.protocol, p.positionId)).position;
      const chainId = await client.getChainId();
      const g = checkTxGuards({ account: address, chainId, owner: fresh.owner });
      if (!g.ok) throw new Error(g.message);
      // 2. Rebuild against fresh state.
      let h = NO_HINTS;
      if (fresh.protocol === "mezo-musd-trove" && kind !== "close") h = hints;
      const shares = fullRepay ? await readBorrowShares(client, fresh) : undefined;
      const live = buildPlan(fresh, kind, kind === "close" ? troveCloseCost(fresh) : amount, { hints: h, fullRepay, borrowShares: shares });
      // 3. Balance.
      const r = requirement(fresh, live, amount);
      if (r) {
        const have = await readBalance(client, address, r.token);
        if (have < r.need) throw new Error(insufficientBalanceMessage(r.symbol, r.need, have, r.decimals));
      }
      // 4. Steps: skip approvals already covered, simulate, send, wait.
      let lastHash: `0x${string}` | undefined;
      for (const s of live.steps) {
        if (s.protectorCleanup && !(await protectorHasRule(client, s.address, address))) continue;
        if (s.approval) {
          const allowance = await client.readContract({ address: s.approval.token, abi: erc20Abi, functionName: "allowance", args: [address, s.approval.spender] });
          if (allowance >= s.approval.amount) continue;
        }
        await client.simulateContract({ address: s.address, abi: s.abi, functionName: s.functionName, args: s.args as unknown[], value: s.value, account: address });
        setStatus({ phase: "wallet", step: s.label });
        const hash = await write.writeContractAsync({
          address: s.address,
          abi: s.abi,
          functionName: s.functionName,
          args: s.args as unknown[],
          value: s.value,
          chainId: MEZO_TESTNET_ID,
        } as Parameters<typeof write.writeContractAsync>[0]);
        setStatus({ phase: "pending", step: s.label, hash });
        const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
        if (receipt.status !== "success") {
          setStatus({ phase: "error", message: `${s.label} failed on-chain. Nothing else was sent.`, hash });
          return;
        }
        lastHash = hash;
      }
      if (!lastHash) throw new Error("Nothing to send.");
      // 5. Record + refresh from chain.
      api("/api/actions", {
        method: "POST",
        json: { txHash: lastHash, wallet: address, protocol: fresh.protocol, positionId: fresh.positionId, action: kind, estimatedAmount: (kind === "close" ? troveCloseCost(fresh) : fullRepay ? fresh.debtAmount : amount).toString(), chainId: MEZO_TESTNET_ID },
      }).catch(() => undefined);
      await Promise.all([
        qc.invalidateQueries({ queryKey: portfolioKey(fresh.owner) }),
        qc.invalidateQueries({ queryKey: positionKey(fresh.protocol, fresh.positionId) }),
      ]);
      setStatus({ phase: "done", hash: lastHash });
    } catch (e) {
      const message = e instanceof Error && !("shortMessage" in e) && !/revert|reject|denied/i.test(e.message) ? e.message : humanizeError(e);
      setStatus((s) => ({ phase: "error", message, hash: s.phase === "pending" ? s.hash : undefined }));
    }
  }

  const ratioDelta = impact.ratioAfter - impact.ratioBefore;

  return (
    <Dialog open={open} onOpenChange={(o) => (!busy || !o ? onOpenChange(o) : undefined)}>
      <DialogContent side="right" title="Protect this loan" description="Review the effect and the exact transaction before your wallet opens.">
        <div className="grid gap-6 p-5">
          {/* Action choice */}
          <div role="radiogroup" aria-label="Action" className="grid grid-cols-2 gap-1 rounded-md bg-surface-2 p-1 sm:flex">
            {kinds.map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                disabled={busy}
                onClick={() => {
                  setKind(k);
                  setAmountStr("");
                  setFullRepay(false);
                  setStatus({ phase: "idle" });
                }}
                className={cn(
                  "h-8 flex-1 cursor-pointer whitespace-nowrap rounded px-2.5 text-[13px] text-ink-2 transition-colors hover:text-ink",
                  kind === k && "bg-raised font-medium text-ink shadow-sm",
                )}
              >
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>

          {/* Amount */}
          {kind === "close" ? (
            <div className="text-sm text-ink-2">
              <p>
                Closing repays the whole loan and returns{" "}
                <span className="num font-medium text-ink">{fmtUnits(p.collateralAmount, 18, 6)} BTC</span> to this wallet.
              </p>
              <p className="mt-2">
                You need <span className="num font-medium text-ink">{fmtUnits(troveCloseCost(p), 18, 2)} MUSD</span> in this wallet.
              </p>
            </div>
          ) : (
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <label htmlFor="action-amount" className="text-sm font-medium text-ink">
                    Amount
                  </label>
                  {balance !== null && req && (
                    <span className="num text-[12px] text-ink-2">
                      In wallet: {fmtUnits(balance, req.decimals, req.symbol === "BTC" ? 6 : 2)} {req.symbol}
                    </span>
                  )}
                </div>
                <div className="flex h-10 items-center rounded-md border border-line-strong bg-raised shadow-sm focus-within:border-focus">
                  <input
                    id="action-amount"
                    inputMode="decimal"
                    autoComplete="off"
                    value={fullRepay ? fmtUnits(p.debtAmount, dec, dec).replace(/,/g, "") : amountStr}
                    disabled={fullRepay || busy}
                    onChange={(e) => setAmountStr(e.target.value)}
                    placeholder="0.00"
                    aria-invalid={amountError ? true : undefined}
                    aria-describedby="action-amount-msg"
                    className="num h-full min-w-0 flex-1 bg-transparent px-3 text-[15px] text-ink outline-none disabled:text-ink-2"
                  />
                  <span className="pr-3 text-sm text-ink-2">{sym}</span>
                </div>
                <p id="action-amount-msg" className={cn("text-[13px]", amountError ? "text-danger-ink" : "text-ink-2")} role={amountError ? "alert" : undefined}>
                  {amountError ??
                    (kind === "repay" && p.protocol === "mezo-musd-trove"
                      ? `You can repay up to ${fmtUnits(maxRepay, 18, 2)} MUSD and keep the Trove open.`
                      : kind === "add-collateral" && sym === "BTC"
                        ? "A small amount of BTC is kept back for gas."
                        : kind === "withdraw-collateral"
                          ? "Withdrawing lowers your ratio. Check the effect below."
                          : `Current debt: ${fmtUnits(p.debtAmount, dec, 2)} ${sym}.`)}
                </p>
              </div>

              {(kind === "repay" || kind === "add-collateral") && (
                <div className="flex flex-wrap items-end gap-2 rounded-md border border-line p-3">
                  <div className="grid gap-1">
                    <label htmlFor="target-ratio" className="text-[12px] text-ink-2">
                      Target ratio
                    </label>
                    <div className="flex h-9 w-28 items-center rounded-md border border-line-strong bg-raised focus-within:border-focus">
                      <input
                        id="target-ratio"
                        inputMode="decimal"
                        value={targetPct}
                        onChange={(e) => setTargetPct(e.target.value)}
                        className="num h-full min-w-0 flex-1 bg-transparent px-2.5 text-sm outline-none"
                      />
                      <span className="pr-2.5 text-sm text-ink-2">%</span>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="h-9"
                    disabled={busy || toTarget === 0n || fullRepay}
                    onClick={() => setAmountStr(fmtUnits(repayTooBig ? maxRepay : toTarget, dec, dec).replace(/,/g, ""))}
                  >
                    {toTarget === 0n ? "Already above target" : `Use ${fmtUnits(repayTooBig ? maxRepay : toTarget, dec, sym === "BTC" ? 6 : 2)} ${sym}`}
                  </Button>
                  {p.protocol === "morpho-blue" && kind === "repay" && (
                    <label className="ml-auto inline-flex h-9 cursor-pointer items-center gap-2 text-[13px] text-ink">
                      <input type="checkbox" checked={fullRepay} onChange={(e) => setFullRepay(e.target.checked)} className="size-4 accent-[var(--accent)]" />
                      Repay everything
                    </label>
                  )}
                </div>
              )}
              {repayTooBig && (
                <Callout tone="info">
                  Reaching {targetPct}% needs {fmtUnits(toTarget, 18, 2)} MUSD, but a Trove must keep its minimum debt. Repay the maximum, add BTC, or close the loan.
                  <span className="mt-2 flex gap-3">
                    <button type="button" className="cursor-pointer font-medium text-accent-ink hover:underline" onClick={() => setKind("add-collateral")}>Add BTC instead</button>
                    <button type="button" className="cursor-pointer font-medium text-accent-ink hover:underline" onClick={() => setKind("close")}>Close the loan</button>
                  </span>
                </Callout>
              )}
            </div>
          )}

          {plan.notes.map((n) => (
            <p key={n} className="text-[13px] text-ink-2">{n}</p>
          ))}

          {/* Impact */}
          <section aria-labelledby="impact-h">
            <h3 id="impact-h" className="text-sm font-semibold text-ink">Estimated effect</h3>
            {kind === "close" ? (
              <p className="mt-2 text-sm text-ink-2">The loan is closed. No liquidation risk remains.</p>
            ) : (
              <dl className="num mt-2 grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-3 gap-y-2 text-sm">
                <dt className="text-ink-2">Ratio</dt>
                <dd className="text-right text-ink">{fmtRatio(impact.ratioBefore)}</dd>
                <dd aria-hidden className="text-ink-3"><ArrowRight className="size-3.5" /></dd>
                <dd className={cn("text-right font-medium", ratioDelta < 0n ? "text-danger-ink" : "text-ink")}>{impactAmount > 0n ? fmtRatio(impact.ratioAfter) : "-"}</dd>
                <dt className="text-ink-2">Liquidation price</dt>
                <dd className="text-right text-ink">{fmtUsd(impact.liqBefore)}</dd>
                <dd aria-hidden className="text-ink-3"><ArrowRight className="size-3.5" /></dd>
                <dd className="text-right font-medium text-ink">{impactAmount > 0n ? (impact.ratioAfter === 0n ? "None" : fmtUsd(impact.liqAfter)) : "-"}</dd>
                <dt className="text-ink-2">Risk</dt>
                <dd className="col-span-3 flex items-center justify-end gap-2">
                  <RiskBadge level={levelAfter(p, impact.ratioBefore)} size="sm" />
                  {impactAmount > 0n && impact.ratioAfter > 0n && (
                    <>
                      <ArrowRight aria-hidden className="size-3.5 text-ink-3" />
                      <RiskBadge level={levelAfter(p, impact.ratioAfter)} size="sm" />
                    </>
                  )}
                </dd>
              </dl>
            )}
            <p className="mt-2 text-[12px] text-ink-3">Estimate at the current {p.protocol === "morpho-blue" ? "market oracle" : "Mezo"} price. The loan is re-read from the chain after it confirms.</p>
          </section>

          {/* Exact transaction */}
          <section aria-labelledby="preview-h">
            <h3 id="preview-h" className="mb-2 text-sm font-semibold text-ink">
              {plan.steps.length > 1 ? "Transactions you will sign" : "Transaction you will sign"}
            </h3>
            <TxPreview steps={plan.steps as TxStep[]} gas={address ? gas : undefined} skipped={skipped} />
          </section>

          <TxGuard owner={p.owner} onOk={setGuardOk} />
          {insufficient && guardOk && (
            <Callout tone="warn" role="alert">{insufficient}</Callout>
          )}

          {/* Status */}
          <AnimatePresence mode="wait" initial={false}>
            {status.phase !== "idle" && (
              <motion.div
                key={status.phase}
                initial={reduce ? false : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? undefined : { opacity: 0 }}
                transition={{ duration: 0.18 }}
                aria-live="polite"
              >
                {status.phase === "checking" && <p className="text-sm text-ink-2">Re-reading the loan from the chain and checking your wallet…</p>}
                {status.phase === "wallet" && <p className="text-sm text-ink">Confirm “{status.step}” in your wallet.</p>}
                {status.phase === "pending" && (
                  <p className="text-sm text-ink">
                    {status.step} sent. Waiting for the network…{" "}
                    <a className="inline-flex items-center gap-1 text-accent-ink hover:underline" href={explorerTx(status.hash)} target="_blank" rel="noreferrer">
                      View on explorer <ExternalLink aria-hidden className="size-3" />
                    </a>
                  </p>
                )}
                {status.phase === "done" && (
                  <Callout tone="info" title="Done. Your loan has been refreshed from the chain.">
                    <a className="inline-flex items-center gap-1 text-accent-ink hover:underline" href={explorerTx(status.hash)} target="_blank" rel="noreferrer">
                      View transaction <ExternalLink aria-hidden className="size-3" />
                    </a>
                  </Callout>
                )}
                {status.phase === "error" && (
                  <Callout tone="danger" role="alert" title="Not completed">
                    {status.message}
                    {status.hash && (
                      <a className="ml-1 inline-flex items-center gap-1 underline" href={explorerTx(status.hash)} target="_blank" rel="noreferrer">
                        View transaction
                      </a>
                    )}
                  </Callout>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-line bg-raised px-5 py-3">
          {status.phase === "done" ? (
            <Button onClick={() => onOpenChange(false)}>
              <CheckCircle2 aria-hidden /> Close
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={send} disabled={!canSend} loading={busy} variant={kind === "close" || kind === "withdraw-collateral" ? "secondary" : "primary"}>
                {status.phase === "error" ? "Try again" : "Confirm in wallet"}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
