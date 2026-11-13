"use client";
import * as React from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { ArrowLeft, ExternalLink, RefreshCw } from "lucide-react";
import type { ProtocolId } from "@/lib/risk/types";
import { defaultTargetRatio, recommend } from "@/lib/risk";
import { explorerAddress } from "@/lib/chain/config";
import { fmtPct, fmtRatio, fmtUnits, fmtUsd, parseUnitsSafe } from "@/lib/format";
import { usePositionDetail } from "@/hooks/use-portfolio";
import { useNow } from "@/hooks/use-now";
import { PROTOCOL_LABEL, RISK_HELP, RISK_LABEL, relativeTime } from "@/lib/wallet/display";
import { positionName } from "@/lib/wallet/positions";
import { shortAddress, ApiRequestError } from "@/lib/wallet/api";
import { troveCloseCost } from "@/lib/wallet/plans";
import type { ActionKind } from "@/lib/wallet/plans";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Skeleton } from "@/components/ui/skeleton";
import { RiskBadge } from "@/components/risk/risk-badge";
import { StaleBanner } from "@/components/risk/stale-banner";
import { TokenAmount } from "@/components/risk/amount";
import { ActionSheet, supportedKinds } from "@/components/actions/action-sheet";
import { AutomationPanel } from "@/components/automation/automation-panel";
import { Scenarios } from "./scenarios";
import { HistoryChart } from "./history-chart";
import { RedemptionExposure } from "./redemption";
import { useMounted } from "@/hooks/use-mounted";

const ACTION_LABEL: Record<ActionKind, string> = {
  repay: "Repay",
  "add-collateral": "Add collateral",
  close: "Close loan",
  "withdraw-collateral": "Withdraw collateral",
};

export function PositionView({ protocol, id }: { protocol: ProtocolId; id: string }) {
  const q = usePositionDetail(protocol, id);
  const now = useNow(1000);
  const { address } = useAccount();
  const mounted = useMounted();
  const [sheet, setSheet] = React.useState<{ kind: ActionKind; amount?: bigint } | null>(null);
  const d = q.data;
  const [targetStr, setTargetStr] = React.useState<string | null>(null);

  if (q.isLoading) {
    return (
      <div className="container-page grid gap-6 py-10" aria-busy="true">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (q.error || !d) {
    const notFound = q.error instanceof ApiRequestError && q.error.status === 404;
    return (
      <div className="container-page max-w-xl py-16">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{notFound ? "Loan not found" : "Could not load this loan"}</h1>
        <p className="mt-2 text-sm text-ink-2">
          {notFound ? "There is no open loan with this id on Mezo testnet. It may have been closed or fully liquidated." : q.error?.message}
        </p>
        <Button className="mt-6" variant="secondary" onClick={() => q.refetch()}>Try again</Button>
      </div>
    );
  }

  const p = d.position;
  const a = d.assessment;
  const stale = a.stale || p.price.stale;
  const isOwner = mounted && address?.toLowerCase() === p.owner.toLowerCase();
  const baseTarget = d.recommendation.targetRatio > 0n ? d.recommendation.targetRatio : defaultTargetRatio(p);
  const targetInput = targetStr ?? fmtRatio(baseTarget).replace("%", "");
  const parsedTarget = parseUnitsSafe(targetInput, 16);
  const targetValid = parsedTarget !== null && parsedTarget > p.liquidationRatio && parsedTarget <= 10n * 10n ** 18n;
  const target = targetValid ? parsedTarget! : baseTarget;
  const rec = target === d.recommendation.targetRatio ? d.recommendation : recommend(p, target);
  const trove = p.params.kind === "trove" ? p.params : null;
  const morpho = p.params.kind === "morpho" ? p.params : null;
  const kinds = supportedKinds(p);

  return (
    <div className="container-page py-8 md:py-10">
      <Link href={`/portfolio/${p.owner}`} className="inline-flex items-center gap-1.5 text-[13px] text-ink-2 hover:text-ink">
        <ArrowLeft aria-hidden className="size-3.5" /> All loans for {shortAddress(p.owner)}
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{positionName(p)}</h1>
          <p className="mt-1 text-sm text-ink-2">
            {PROTOCOL_LABEL[p.protocol]} · owner{" "}
            <a className="font-mono text-[13px] hover:text-ink hover:underline" href={explorerAddress(p.owner)} target="_blank" rel="noreferrer">
              {shortAddress(p.owner)}
            </a>
          </p>
        </div>
        <div className="flex items-center gap-3 text-[13px] text-ink-2">
          <span className="num" aria-live="polite">{q.isFetching ? "Updating…" : `Updated ${relativeTime(p.readAt, now)}`}</span>
          <Button variant="secondary" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
            <RefreshCw aria-hidden className={q.isFetching ? "animate-spin motion-reduce:animate-none" : ""} /> Refresh
          </Button>
        </div>
      </div>

      {stale && <StaleBanner className="mt-6" reason={p.price.staleReason} />}
      {p.status !== "active" && (
        <Callout className="mt-6" tone="info" title={`This loan is ${p.status}`}>It no longer carries liquidation risk.</Callout>
      )}

      {/* Verdict + key numbers */}
      <section aria-label="Loan health" className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] lg:gap-12">
        <div>
          <RiskBadge level={a.level} unverified={stale} size="lg" className="text-2xl [&>span:first-child]:size-3" />
          <p className="num mt-3 text-5xl font-semibold tracking-tight text-ink">{fmtRatio(p.collateralRatio)}</p>
          <p className="mt-1 text-sm text-ink-2">
            Collateral ratio. Liquidation at <span className="num text-ink">{fmtRatio(p.liquidationRatio)}</span>.
          </p>
          <p className="mt-3 max-w-[46ch] text-sm text-ink-2">{RISK_HELP[a.level]}</p>
          {a.nextLevel && a.nextLevelPriceUsd !== undefined && a.nextLevelPriceUsd > 0n && (
            <p className="mt-2 text-sm text-ink">
              Becomes <span className="font-medium">{RISK_LABEL[a.nextLevel].toLowerCase()}</span> if the price falls to{" "}
              <span className="num font-medium">{fmtUsd(a.nextLevelPriceUsd)}</span>.
            </p>
          )}
          {isOwner && p.status === "active" && (
            <div className="mt-6 flex flex-wrap gap-2">
              {kinds.map((k, i) => (
                <Button key={k} variant={i === 0 ? "primary" : "secondary"} onClick={() => setSheet({ kind: k })}>
                  {ACTION_LABEL[k]}
                </Button>
              ))}
            </div>
          )}
          {!isOwner && mounted && <p className="mt-6 text-[13px] text-ink-3">Connect the owner&apos;s wallet to repay or add collateral from here.</p>}
        </div>

        <dl className="num grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
          <div>
            <dt className="text-[13px] text-ink-2">Collateral</dt>
            <dd className="mt-1 text-lg font-semibold text-ink"><TokenAmount value={p.collateralAmount} decimals={p.collateralAsset.decimals} symbol={p.collateralAsset.symbol} /></dd>
            <dd className="text-[13px] text-ink-2">{fmtUsd(p.collateralValueUsd)}</dd>
          </div>
          <div>
            <dt className="text-[13px] text-ink-2">Debt</dt>
            <dd className="mt-1 text-lg font-semibold text-ink"><TokenAmount value={p.debtAmount} decimals={p.debtAsset.decimals} symbol={p.debtAsset.symbol} /></dd>
            {p.debtInterest !== undefined && p.debtInterest > 0n && (
              <dd className="text-[13px] text-ink-2">incl. {fmtUnits(p.debtInterest, p.debtAsset.decimals, 2)} interest</dd>
            )}
          </div>
          <div>
            <dt className="text-[13px] text-ink-2">Liquidation price</dt>
            <dd className="mt-1 text-lg font-semibold text-ink">{fmtUsd(p.liquidationPriceUsd)}</dd>
            <dd className="text-[13px] text-ink-2">per {p.collateralAsset.symbol}</dd>
          </div>
          <div>
            <dt className="text-[13px] text-ink-2">Price can fall</dt>
            <dd className="mt-1 text-lg font-semibold text-ink">{fmtPct(a.priceDeclineBuffer, 1)}</dd>
            <dd className="text-[13px] text-ink-2">before liquidation</dd>
          </div>
          <div>
            <dt className="text-[13px] text-ink-2">Safety margin</dt>
            <dd className="mt-1 text-lg font-semibold text-ink">{fmtPct(a.safetyMargin, 1)}</dd>
            <dd className="text-[13px] text-ink-2">ratio above the line</dd>
          </div>
          <div>
            <dt className="text-[13px] text-ink-2">Price used</dt>
            <dd className="mt-1 text-lg font-semibold text-ink">{fmtUsd(p.price.usd)}</dd>
            <dd className="text-[13px] text-ink-2">
              {p.price.source === "morpho-oracle" ? "Market oracle" : "Mezo price feed"}
              {p.price.updatedAt > 0 && `, ${relativeTime(p.price.updatedAt * 1000, now)}`}
            </dd>
          </div>
        </dl>
      </section>

      {a.reasons.length > 0 && (
        <ul className="mt-6 grid gap-1 text-[13px] text-ink-2">
          {a.reasons.map((r) => <li key={r}>{r}</li>)}
        </ul>
      )}

      <div className="mt-10 grid gap-6">
        <Panel aria-labelledby="rec-h">
          <PanelHeader id="rec-h" title="What it takes to be safe" description="Adjust the target to see how much to repay or add." />
          <div className="grid gap-5 p-4 sm:p-5 md:grid-cols-[auto_1fr] md:items-start md:gap-10">
            <div className="grid gap-1.5">
              <label htmlFor="target" className="text-sm font-medium text-ink">Target ratio</label>
              <div className="flex h-10 w-36 items-center rounded-md border border-line-strong bg-raised focus-within:border-focus">
                <input
                  id="target"
                  inputMode="decimal"
                  value={targetInput}
                  onChange={(e) => setTargetStr(e.target.value)}
                  aria-invalid={!targetValid || undefined}
                  aria-describedby="target-msg"
                  className="num h-full min-w-0 flex-1 bg-transparent px-3 text-[15px] outline-none"
                />
                <span className="pr-3 text-sm text-ink-2">%</span>
              </div>
              <p id="target-msg" className={!targetValid ? "text-[13px] text-danger-ink" : "text-[13px] text-ink-2"}>
                {!targetValid ? `Use a ratio above ${fmtRatio(p.liquidationRatio)}.` : `Default ${fmtRatio(defaultTargetRatio(p))}`}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border border-line p-4">
                <p className="text-[13px] text-ink-2">Repay</p>
                <p className="num mt-1 text-lg font-semibold text-ink">
                  {rec.repayAmount === 0n ? "Nothing needed" : `${fmtUnits(rec.repayAmount, p.debtAsset.decimals, 2)} ${p.debtAsset.symbol}`}
                </p>
                {rec.repayNote && <p className="mt-1 text-[13px] text-ink-2">{rec.repayNote}</p>}
                {isOwner && rec.repayAmount > 0n && rec.repayFeasible && (
                  <Button size="sm" className="mt-3" onClick={() => setSheet({ kind: "repay", amount: rec.repayAmount })}>Review repay</Button>
                )}
              </div>
              <div className="rounded-md border border-line p-4">
                <p className="text-[13px] text-ink-2">Or add</p>
                <p className="num mt-1 text-lg font-semibold text-ink">
                  {rec.addCollateral === 0n ? "Nothing needed" : `${fmtUnits(rec.addCollateral, p.collateralAsset.decimals, 6)} ${p.collateralAsset.symbol}`}
                </p>
                {isOwner && rec.addCollateral > 0n && (
                  <Button size="sm" variant="secondary" className="mt-3" onClick={() => setSheet({ kind: "add-collateral", amount: rec.addCollateral })}>
                    Review add {p.collateralAsset.symbol}
                  </Button>
                )}
              </div>
              {trove && (
                <p className="text-[13px] text-ink-2 sm:col-span-2">
                  Closing this Trove costs <span className="num text-ink">{fmtUnits(troveCloseCost(p), 18, 2)} MUSD</span>. Estimates use the current price; the chain is re-read before you sign.
                </p>
              )}
            </div>
          </div>
        </Panel>

        <Panel aria-labelledby="scen-h">
          <PanelHeader id="scen-h" title="If the price moves" description={morpho ? "Moves the market oracle price, which is what this market liquidates on." : "Moves the Mezo BTC price, which is what Troves liquidate on."} />
          <div className="p-4 sm:p-5">
            <Scenarios position={p} targetRatio={target} />
          </div>
        </Panel>

        {trove && (
          <Panel aria-labelledby="redemption-h">
            <PanelHeader id="redemption-h" title="Redemption exposure" />
            <div className="p-4 sm:p-5">
              <RedemptionExposure position={p} />
            </div>
          </Panel>
        )}

        <Panel aria-labelledby="history-h">
          <PanelHeader id="history-h" title="Ratio history" />
          <div className="p-4 sm:p-5">
            <HistoryChart detail={d} />
          </div>
        </Panel>

        {trove && (
          <Panel aria-labelledby="auto-h">
            <PanelHeader id="auto-h" title="Automatic repay" description="Optional. Repays part of your debt if the ratio drops below a trigger you choose." />
            <div className="p-4 sm:p-5">
              <AutomationPanel position={p} recommendation={d.recommendation} />
            </div>
          </Panel>
        )}

        <Panel aria-labelledby="params-h">
          <PanelHeader id="params-h" title="Protocol details" />
          <dl className="num grid grid-cols-2 gap-x-6 gap-y-4 p-4 text-sm sm:grid-cols-4 sm:p-5">
            {trove && (
              <>
                <div><dt className="text-[13px] text-ink-2">Liquidation ratio (MCR)</dt><dd className="text-ink">{fmtRatio(trove.mcr)}</dd></div>
                <div><dt className="text-[13px] text-ink-2">Recovery mode below</dt><dd className="text-ink">{fmtRatio(trove.ccr)} system ratio</dd></div>
                <div><dt className="text-[13px] text-ink-2">System ratio now</dt><dd className="text-ink">{fmtRatio(trove.tcr)}{trove.recoveryMode && " (recovery mode)"}</dd></div>
                <div><dt className="text-[13px] text-ink-2">Interest rate</dt><dd className="text-ink">{p.interestRateBps !== undefined ? `${(p.interestRateBps / 100).toFixed(2)}% a year` : "n/a"}</dd></div>
                <div><dt className="text-[13px] text-ink-2">Minimum debt</dt><dd className="text-ink">{fmtUnits(trove.minNetDebt, 18, 0)} MUSD</dd></div>
                <div><dt className="text-[13px] text-ink-2">Gas reserve</dt><dd className="text-ink">{fmtUnits(trove.gasCompensation, 18, 0)} MUSD</dd></div>
                <div><dt className="text-[13px] text-ink-2">Redemption fee</dt><dd className="text-ink">{fmtPct(trove.redemptionRate, 2)}</dd></div>
              </>
            )}
            {morpho && (
              <>
                <div><dt className="text-[13px] text-ink-2">Market</dt><dd className="text-ink">{morpho.marketLabel}</dd></div>
                <div><dt className="text-[13px] text-ink-2">Liquidation LTV</dt><dd className="text-ink">{fmtPct(morpho.lltv, 1)}</dd></div>
                <div><dt className="text-[13px] text-ink-2">Borrow rate</dt><dd className="text-ink">{morpho.borrowApr !== undefined ? `${fmtPct(morpho.borrowApr, 2)} a year` : "n/a"}</dd></div>
                <div>
                  <dt className="text-[13px] text-ink-2">Oracle</dt>
                  <dd><a className="inline-flex items-center gap-1 font-mono text-[12px] text-accent-ink hover:underline" href={explorerAddress(morpho.oracle)} target="_blank" rel="noreferrer">{shortAddress(morpho.oracle)} <ExternalLink aria-hidden className="size-3" /></a></dd>
                </div>
                <p className="col-span-full text-[13px] text-ink-2">Debt in mUSDC and MUSD is valued at $1 for the dollar totals. Risk uses the market oracle, which is what liquidations use.</p>
              </>
            )}
            <div className="col-span-full">
              <a className="inline-flex items-center gap-1.5 text-sm font-medium text-accent-ink hover:underline" href={explorerAddress(p.owner)} target="_blank" rel="noreferrer">
                View on explorer <ExternalLink aria-hidden className="size-3.5" />
              </a>
            </div>
          </dl>
        </Panel>
      </div>

      {sheet && (
        <ActionSheet
          position={p}
          recommendation={rec}
          open
          onOpenChange={(o) => !o && setSheet(null)}
          initialKind={sheet.kind}
          initialAmount={sheet.amount}
        />
      )}
    </div>
  );
}
