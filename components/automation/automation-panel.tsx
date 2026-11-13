"use client";
import * as React from "react";
import { useAccount, usePublicClient, useSignTypedData, useWriteContract } from "wagmi";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, ShieldCheck } from "lucide-react";
import { getAddress, isAddress, zeroAddress, type Address, type PublicClient } from "viem";
import { borrowerOperationsSignaturesAbi, erc20Abi } from "@/lib/chain/abis";
import { MEZO_TESTNET_ID, MUSD_PROTOCOL, PROTECTOR_ADDRESS, explorerAddress, explorerTx } from "@/lib/chain/config";
import type { Position, Recommendation } from "@/lib/risk/types";
import { fmtRatio, fmtUnits, parseUnitsSafe } from "@/lib/format";
import { isBitcoinSmartAccount } from "@/lib/wallet/config";
import { protectorAbi } from "@/lib/wallet/protector-abi";
import { cancelLiveSignature, readSignatureState, repayTypedData } from "@/lib/wallet/protector-signature";
import { troveMaxRepay } from "@/lib/wallet/plans";
import { checkTxGuards } from "@/lib/wallet/guards";
import { humanizeError, insufficientBalanceMessage } from "@/lib/wallet/errors";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Field, Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { TxGuard } from "@/components/actions/network-guard";

export { AUTOMATION_DOMAIN, repayTypedData } from "@/lib/wallet/protector-signature";

/** Contract floor (MIN_TRIGGER_ICR) and deadline cap (MAX_SIG_DURATION). */
const MIN_TRIGGER = 12n * 10n ** 17n;
const MAX_DAYS = 90;

function Explainer() {
  return (
    <ul className="grid gap-1.5 text-sm text-ink-2">
      <li>It can only repay your Trove&apos;s debt. It can never withdraw BTC or borrow more.</li>
      <li>It only uses the MUSD budget you deposit here, never your wallet balance.</li>
      <li>It only runs when your ratio is below the trigger you set, and only until the expiry date.</li>
      <li>Signing any other Mezo loan permission (a signed message, not a normal transaction) resets it, and you would set it up again.</li>
      <li>Turn it off at any time. Turning it off returns the unused budget right away.</li>
    </ul>
  );
}

export function AutomationPanel({ position: p, recommendation }: { position: Position; recommendation?: Recommendation }) {
  if (p.protocol !== "mezo-musd-trove") return null;
  if (!PROTECTOR_ADDRESS) {
    return (
      <div className="grid gap-4" data-testid="automation-disabled">
        <Callout tone="info" title="Automation contract not deployed yet">
          Automatic repay will appear here once the MezoGuard protector contract is deployed on Mezo testnet.
        </Callout>
        <Explainer />
        <div>
          <Button disabled variant="secondary">Set up automatic repay</Button>
        </div>
      </div>
    );
  }
  return <AutomationLive position={p} recommendation={recommendation} protector={PROTECTOR_ADDRESS} />;
}

type Phase = { phase: "idle" } | { phase: "busy"; label: string; hash?: `0x${string}` } | { phase: "error"; message: string } | { phase: "done"; message: string; hash?: `0x${string}` };

function AutomationLive({ position: p, recommendation, protector }: { position: Position; recommendation?: Recommendation; protector: Address }) {
  const client = usePublicClient({ chainId: MEZO_TESTNET_ID }) as PublicClient | undefined;
  const { address, chainId, connector } = useAccount();
  const bitcoinWallet = isBitcoinSmartAccount(connector);
  const write = useWriteContract();
  const signTyped = useSignTypedData();
  const qc = useQueryClient();
  const owner = p.owner;

  const state = useQuery({
    queryKey: ["protector", protector, owner.toLowerCase()],
    enabled: !!client,
    refetchInterval: 30_000,
    queryFn: async () => {
      const c = client!;
      const [rule, can, nonce] = await Promise.all([
        c.readContract({ address: protector, abi: protectorAbi, functionName: "ruleOf", args: [owner] }),
        c.readContract({ address: protector, abi: protectorAbi, functionName: "canExecute", args: [owner] }),
        c.readContract({ address: MUSD_PROTOCOL.borrowerOperationsSignatures, abi: borrowerOperationsSignaturesAbi, functionName: "getNonce", args: [owner] }),
      ]);
      const expired = rule.sigDeadline > 0n && Number(rule.sigDeadline) < Math.floor(Date.now() / 1000);
      return { rule, can: { ready: can[0], icr: can[1], reason: can[2] }, nonce, expired };
    },
  });

  const maxRepay = troveMaxRepay(p);
  const suggestedRepay = recommendation && recommendation.repayAmount > 0n ? (recommendation.repayAmount < maxRepay ? recommendation.repayAmount : maxRepay) : maxRepay < 500n * 10n ** 18n ? maxRepay : 500n * 10n ** 18n;
  const [repayStr, setRepayStr] = React.useState(() => fmtUnits(suggestedRepay, 18, 2).replace(/,/g, ""));
  const [budgetStr, setBudgetStr] = React.useState(() => fmtUnits(suggestedRepay, 18, 2).replace(/,/g, ""));
  const [triggerStr, setTriggerStr] = React.useState(() => fmtRatio((p.liquidationRatio * 13n) / 10n).replace("%", ""));
  const [days, setDays] = React.useState("30");
  const [executor, setExecutor] = React.useState("");
  const [phase, setPhase] = React.useState<Phase>({ phase: "idle" });

  const repay = parseUnitsSafe(repayStr, 18);
  const deposit = parseUnitsSafe(budgetStr || "0", 18);
  const trigger = parseUnitsSafe(triggerStr, 16);
  const daysN = Number(days);
  const currentBudget = state.data?.rule.budget ?? 0n;

  const errors: Partial<Record<"repay" | "budget" | "trigger" | "days" | "executor", string>> = {};
  if (repay === null || repay <= 0n) errors.repay = "Enter an amount above 0.";
  else if (repay > maxRepay) errors.repay = `At most ${fmtUnits(maxRepay, 18, 2)} MUSD. A Trove must keep its minimum debt.`;
  if (deposit === null) errors.budget = "Enter a number (0 is fine if your budget already covers it).";
  else if (repay !== null && currentBudget + deposit < repay) errors.budget = `Budget after deposit must cover the repay amount (${fmtUnits(repay, 18, 2)} MUSD).`;
  if (trigger === null || trigger < MIN_TRIGGER || trigger > 10n * 10n ** 18n) errors.trigger = "Use a ratio between 120% and 1000%. Below 120% the repay could only run once liquidation is possible.";
  if (!Number.isInteger(daysN) || daysN < 1 || daysN > MAX_DAYS) errors.days = `Between 1 and ${MAX_DAYS} days.`;
  if (executor && !isAddress(executor)) errors.executor = "Enter a valid address, or leave empty for any keeper.";
  const valid = Object.keys(errors).length === 0;
  const guard = checkTxGuards({ account: address, chainId, owner });

  async function send(label: string, req: Parameters<typeof write.writeContractAsync>[0]) {
    const c = client!;
    await c.simulateContract({ ...(req as object), account: address } as Parameters<PublicClient["simulateContract"]>[0]);
    setPhase({ phase: "busy", label: `Confirm “${label}” in your wallet` });
    const hash = await write.writeContractAsync(req);
    setPhase({ phase: "busy", label: `${label}: waiting for the network`, hash });
    const r = await c.waitForTransactionReceipt({ hash, timeout: 120_000 });
    if (r.status !== "success") throw new Error(`${label} failed on-chain.`);
    return hash;
  }

  async function setup() {
    if (!client || !address || !valid || repay === null || deposit === null || trigger === null) return;
    try {
      setPhase({ phase: "busy", label: "Checking your wallet…" });
      const g = checkTxGuards({ account: address, chainId: await client.getChainId(), owner });
      if (!g.ok) throw new Error(g.message);
      if (deposit > 0n) {
        const bal = await client.readContract({ address: MUSD_PROTOCOL.musd, abi: erc20Abi, functionName: "balanceOf", args: [address] });
        if (bal < deposit) throw new Error(insufficientBalanceMessage("MUSD", deposit, bal, 18));
        const allowance = await client.readContract({ address: MUSD_PROTOCOL.musd, abi: erc20Abi, functionName: "allowance", args: [address, protector] });
        if (allowance < deposit) {
          await send("Approve MUSD", { address: MUSD_PROTOCOL.musd, abi: erc20Abi, functionName: "approve", args: [protector, deposit], chainId: MEZO_TESTNET_ID });
        }
        await send("Deposit budget", { address: protector, abi: protectorAbi, functionName: "deposit", args: [deposit], chainId: MEZO_TESTNET_ID });
      }
      // An earlier permission at the same nonce would still work at Mezo, so the contract refuses a new one until it is used up.
      if ((await readSignatureState(client, protector, getAddress(owner))).live) {
        setPhase({ phase: "busy", label: "Sign to cancel your earlier repay permission (repays 1 wei)" });
        await cancelLiveSignature({ client, owner: getAddress(owner), signTypedData: signTyped.signTypedDataAsync, write: write.writeContractAsync as never });
      }
      const nonce = await client.readContract({ address: MUSD_PROTOCOL.borrowerOperationsSignatures, abi: borrowerOperationsSignaturesAbi, functionName: "getNonce", args: [owner] });
      const deadline = BigInt(Math.floor(Date.now() / 1000) + daysN * 86_400);
      setPhase({ phase: "busy", label: "Sign the repay permission in your wallet" });
      const sig = await signTyped.signTypedDataAsync(repayTypedData({ amount: repay, borrower: getAddress(owner), nonce, deadline }));
      const hash = await send("Turn on automation", {
        address: protector,
        abi: protectorAbi,
        functionName: "arm",
        args: [repay, trigger, deadline, executor ? getAddress(executor) : zeroAddress, sig],
        chainId: MEZO_TESTNET_ID,
      });
      setPhase({ phase: "done", message: "Automatic repay is on.", hash });
      qc.invalidateQueries({ queryKey: ["protector"] });
    } catch (e) {
      setPhase({ phase: "error", message: e instanceof Error && !("shortMessage" in e) && !/reject|denied|revert/i.test(e.message) ? e.message : humanizeError(e) });
    }
  }

  async function revoke() {
    if (!client || !address) return;
    try {
      const hash = await send("Turn off automation", { address: protector, abi: protectorAbi, functionName: "revoke", args: [], chainId: MEZO_TESTNET_ID });
      qc.invalidateQueries({ queryKey: ["protector"] });
      // revoke() cannot cancel the signed permission at Mezo; consume its nonce so nobody can still use it.
      try {
        if ((await readSignatureState(client, protector, getAddress(owner))).live) {
          setPhase({ phase: "busy", label: "Sign to cancel the repay permission too (repays 1 wei)" });
          await cancelLiveSignature({ client, owner: getAddress(owner), signTypedData: signTyped.signTypedDataAsync, write: write.writeContractAsync as never });
        }
        setPhase({ phase: "done", message: "Automatic repay is off, the budget was returned and the permission is cancelled.", hash });
      } catch (e) {
        setPhase({ phase: "error", message: `Automatic repay is off and the budget was returned, but the signed permission is still valid until its end date. Anyone could use it to repay your loan with their own MUSD. ${humanizeError(e)}` });
      }
    } catch (e) {
      setPhase({ phase: "error", message: humanizeError(e) });
    }
  }

  const rule = state.data?.rule;
  const busy = phase.phase === "busy";
  const expired = state.data?.expired ?? false;

  return (
    <div className="grid gap-5">
      <Explainer />

      {state.isLoading ? (
        <Skeleton className="h-20" />
      ) : state.error ? (
        <Callout tone="warn">Could not read the automation contract. {humanizeError(state.error)}</Callout>
      ) : rule?.armed ? (
        <div className="rounded-md border border-line p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-ink">
            <ShieldCheck aria-hidden className="size-4 text-ok-ink" /> Automatic repay is on
          </p>
          <dl className="num mt-3 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
            <div><dt className="text-[13px] text-ink-2">Repays</dt><dd className="text-ink">{fmtUnits(rule.repayAmount, 18, 2)} MUSD</dd></div>
            <div><dt className="text-[13px] text-ink-2">When ratio is below</dt><dd className="text-ink">{fmtRatio(rule.triggerIcr)}</dd></div>
            <div><dt className="text-[13px] text-ink-2">Budget</dt><dd className="text-ink">{fmtUnits(rule.budget, 18, 2)} MUSD</dd></div>
            <div><dt className="text-[13px] text-ink-2">Until</dt><dd className="text-ink">{new Date(Number(rule.sigDeadline) * 1000).toLocaleDateString()}</dd></div>
          </dl>
          <p className="mt-3 text-[13px] text-ink-2">
            Status: {state.data!.can.ready ? "ready to run if the ratio stays below the trigger." : expired ? "expired." : state.data!.can.reason || "waiting."}
            {rule.executor !== zeroAddress && <> Only <span className="font-mono">{rule.executor}</span> can run it.</>}
          </p>
          {guard.ok && (
            <Button className="mt-4" variant="secondary" onClick={revoke} loading={busy}>
              Turn off and refund budget
            </Button>
          )}
        </div>
      ) : bitcoinWallet ? (
        <Callout tone="info" title="Needs an Ethereum wallet">
          Automatic repay uses a repay permission that Mezo checks against an Ethereum-style signature. Bitcoin wallets
          connect through a Mezo smart account, which cannot sign it. You can still repay and add collateral yourself from
          this page.
        </Callout>
      ) : (
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setup();
          }}
          noValidate
        >
          {currentBudget > 0n && <p className="text-sm text-ink-2">You already have {fmtUnits(currentBudget, 18, 2)} MUSD deposited.</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Repay this much" htmlFor="auto-repay" error={errors.repay} hint={`Up to ${fmtUnits(maxRepay, 18, 2)} MUSD`}>
              <Input id="auto-repay" inputMode="decimal" className="num" value={repayStr} onChange={(e) => setRepayStr(e.target.value)} aria-invalid={!!errors.repay || undefined} />
            </Field>
            <Field label="When my ratio drops below (%)" htmlFor="auto-trigger" error={errors.trigger}>
              <Input id="auto-trigger" inputMode="decimal" className="num" value={triggerStr} onChange={(e) => setTriggerStr(e.target.value)} aria-invalid={!!errors.trigger || undefined} />
            </Field>
            <Field label="Deposit MUSD budget" htmlFor="auto-budget" error={errors.budget} hint="Held by the contract, only for this repay.">
              <Input id="auto-budget" inputMode="decimal" className="num" value={budgetStr} onChange={(e) => setBudgetStr(e.target.value)} aria-invalid={!!errors.budget || undefined} />
            </Field>
            <Field label="Expires after (days)" htmlFor="auto-days" error={errors.days}>
              <Input id="auto-days" type="number" min={1} max={365} className="num" value={days} onChange={(e) => setDays(e.target.value)} aria-invalid={!!errors.days || undefined} />
            </Field>
          </div>
          <Field label="Who can run it (optional)" htmlFor="auto-exec" error={errors.executor} hint="Leave empty to let any keeper run it. It can still only repay.">
            <Input id="auto-exec" className="font-mono text-[13px]" placeholder="0x… (any keeper)" value={executor} onChange={(e) => setExecutor(e.target.value)} aria-invalid={!!errors.executor || undefined} />
          </Field>
          <p className="text-[13px] text-ink-2">
            You will approve and deposit the budget, then sign one permission for{" "}
            <span className="font-mono">RepayMUSD</span> on BorrowerOperationsSignatures, then confirm. Contract:{" "}
            <a className="inline-flex items-center gap-1 font-mono text-accent-ink hover:underline" href={explorerAddress(protector)} target="_blank" rel="noreferrer">
              {protector.slice(0, 10)}… <ExternalLink aria-hidden className="size-3" />
            </a>
          </p>
          <TxGuard owner={owner} />
          <div>
            <Button type="submit" disabled={!valid || !guard.ok} loading={busy}>
              Turn on automatic repay
            </Button>
          </div>
        </form>
      )}

      <div aria-live="polite">
        {phase.phase === "busy" && (
          <p className="text-sm text-ink">
            {phase.label}
            {phase.hash && (
              <a className="ml-2 inline-flex items-center gap-1 text-accent-ink hover:underline" href={explorerTx(phase.hash)} target="_blank" rel="noreferrer">
                View <ExternalLink aria-hidden className="size-3" />
              </a>
            )}
          </p>
        )}
        {phase.phase === "error" && <Callout tone="danger" role="alert" title="Not completed">{phase.message}</Callout>}
        {phase.phase === "done" && (
          <Callout tone="info" title={phase.message}>
            {phase.hash && (
              <a className="inline-flex items-center gap-1 text-accent-ink hover:underline" href={explorerTx(phase.hash)} target="_blank" rel="noreferrer">
                View transaction <ExternalLink aria-hidden className="size-3" />
              </a>
            )}
          </Callout>
        )}
      </div>
    </div>
  );
}
