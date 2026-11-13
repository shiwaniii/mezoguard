"use client";
import * as React from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { usePortfolio } from "@/hooks/use-portfolio";
import { fmtPct, fmtRatio, fmtUnits, fmtUsd, parseUnitsSafe } from "@/lib/format";
import { parseAddressInput, shortAddress } from "@/lib/wallet/api";
import { positionHref } from "@/lib/wallet/display";
import { positionName } from "@/lib/wallet/positions";
import { pctChange } from "@/lib/wallet/reprice";
import { simSummary, simulatePortfolio } from "@/lib/wallet/simulate";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Slider } from "@/components/ui/slider";
import { Callout } from "@/components/ui/callout";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { RiskBadge } from "@/components/risk/risk-badge";
import { StaleBanner } from "@/components/risk/stale-banner";
import { CrPriceChart } from "@/components/portfolio/cr-price-chart";
import { AddressSearch } from "@/components/layout/address-search";
import { ConnectButton } from "@/components/layout/connect-wallet";
import { toNum } from "@/lib/wallet/display";
import { cn } from "@/components/ui/cn";
import { useMounted } from "@/hooks/use-mounted";

const WAD = 10n ** 18n;
const QUICK = [-30, -20, -10, 0, 10, 25];

export function SimulatorView() {
  const params = useSearchParams();
  const router = useRouter();
  const { address: me } = useAccount();
  const mounted = useMounted();
  const fromQuery = params.get("address");
  const parsed = fromQuery ? parseAddressInput(fromQuery) : null;
  const address = parsed?.ok ? parsed.address : mounted ? me : undefined;
  const q = usePortfolio(address);

  if (!address) {
    return (
      <Shell>
        {!mounted ? (
          <Skeleton className="h-40" />
        ) : (
          <div className="max-w-xl">
            <p className="text-[15px] text-ink-2">Connect a wallet or look up an address to see how its loans react to the BTC price.</p>
            <div className="mt-5"><ConnectButton /></div>
            <AddressSearch className="mt-8" onNavigate={(a) => router.push(`/simulator?address=${a}`)} />
            {parsed && !parsed.ok && <p className="mt-2 text-[13px] text-danger-ink">{parsed.error}</p>}
          </div>
        )}
      </Shell>
    );
  }
  if (q.isLoading) return <Shell><Skeleton className="h-96" /></Shell>;
  if (q.error || !q.data) {
    return (
      <Shell>
        <Callout tone="danger" role="alert" title="Could not load this wallet" action={<Button size="sm" variant="secondary" onClick={() => q.refetch()}>Try again</Button>}>
          {q.error?.message}
        </Callout>
      </Shell>
    );
  }
  if (q.data.positions.length === 0) {
    return (
      <Shell address={address}>
        <p className="text-[15px] text-ink-2">
          No open loans for {shortAddress(address)}, so there is nothing to simulate. Open one on{" "}
          <a className="font-medium text-accent-ink hover:underline" href="https://testnet.mezo.org" target="_blank" rel="noreferrer">testnet.mezo.org</a>.
        </p>
      </Shell>
    );
  }
  return (
    <Shell address={address}>
      <Simulator data={q.data} />
    </Shell>
  );
}

function Shell({ children, address }: { children: React.ReactNode; address?: string }) {
  return (
    <div className="container-page py-8 md:py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Price simulator</h1>
      <p className="mt-1 max-w-[70ch] text-sm text-ink-2">
        Move the BTC price and every loan is recalculated in your browser with its protocol&apos;s own rules.
        {address && (
          <>
            {" "}Wallet <Link className="font-mono text-[13px] hover:underline" href={`/portfolio/${address}`}>{shortAddress(address)}</Link>.
          </>
        )}
      </p>
      <div className="mt-6">{children}</div>
    </div>
  );
}

function Simulator({ data }: { data: NonNullable<ReturnType<typeof usePortfolio>["data"]> }) {
  const btcNow = data.btcPrice.usd;
  const nowN = Math.round(toNum(btcNow));
  const [price, setPrice] = React.useState<number>(nowN);
  const [text, setText] = React.useState<string>(String(nowN));
  const [textErr, setTextErr] = React.useState<string | null>(null);
  const sim = BigInt(Math.max(0, Math.round(price))) * WAD;
  const rows = React.useMemo(
    () => simulatePortfolio(data.positions, sim, btcNow, (p) => data.recommendations[p.positionId]?.targetRatio || undefined),
    [data, sim, btcNow],
  );
  const sum = simSummary(rows);
  const change = pctChange(btcNow, sim);
  const hasMorpho = data.positions.some((p) => p.protocol === "morpho-blue");
  const stale = data.btcPrice.stale || data.positions.some((p) => p.price.stale);
  const min = Math.round(nowN * 0.2);
  const max = Math.round(nowN * 2);

  function set(n: number) {
    const v = Math.min(Math.max(n, 1), nowN * 10);
    setPrice(v);
    setText(String(Math.round(v)));
    setTextErr(null);
  }

  return (
    <div className="grid gap-6">
      {stale && <StaleBanner reason={data.btcPrice.staleReason} />}
      <Panel aria-labelledby="sim-controls">
        <div className="grid gap-6 p-4 sm:p-5 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="sim-controls" className="text-[15px] font-semibold text-ink">BTC price</h2>
              <p className="num text-sm text-ink-2">
                Now {fmtUsd(btcNow)} ·{" "}
                <span className={cn("font-medium", change < 0n ? "text-danger-ink" : "text-ink")}>
                  {change > 0n ? "+" : ""}
                  {fmtPct(change, 1)}
                </span>
              </p>
            </div>
            <Slider className="mt-4" label="Simulated BTC price" min={min} max={max} step={Math.max(1, Math.round(nowN / 400))} value={[Math.min(Math.max(price, min), max)]} onValueChange={(v) => set(v[0] ?? nowN)} />
            <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Quick price moves">
              {QUICK.map((pct) => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => set(nowN * (1 + pct / 100))}
                  className="num h-8 cursor-pointer rounded-md border border-line px-2.5 text-[13px] text-ink-2 transition-colors hover:border-line-strong hover:text-ink"
                >
                  {pct === 0 ? "Now" : `${pct > 0 ? "+" : ""}${pct}%`}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-1.5">
            <label htmlFor="sim-price" className="text-[13px] text-ink-2">Exact price (USD)</label>
            <input
              id="sim-price"
              inputMode="decimal"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                const v = parseUnitsSafe(e.target.value, 2);
                if (v === null || v === 0n) setTextErr("Enter a price above 0.");
                else {
                  setTextErr(null);
                  setPrice(Number(v) / 100);
                }
              }}
              aria-invalid={textErr ? true : undefined}
              aria-describedby={textErr ? "sim-price-err" : undefined}
              className="num h-10 w-full rounded-md border border-line-strong bg-raised px-3 text-[15px] text-ink shadow-sm outline-none focus-visible:border-focus lg:w-44"
            />
            {textErr && <p id="sim-price-err" role="alert" className="text-[13px] text-danger-ink">{textErr}</p>}
          </div>
        </div>
        {hasMorpho && (
          <p className="border-t border-line px-4 py-3 text-[13px] text-ink-2 sm:px-5">
            Morpho markets use their own oracle, not the Mezo feed. The slider moves the BTC price and each Morpho oracle by the same percentage.
          </p>
        )}
      </Panel>

      <div aria-live="polite" className="num grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
        <div>
          <p className="text-[13px] text-ink-2">Loans that could be liquidated</p>
          <p className={cn("mt-1 text-2xl font-semibold tracking-tight", sum.liquidatable > 0 ? "text-danger-ink" : "text-ink")} data-testid="sim-liquidatable">
            {sum.liquidatable} <span className="text-base font-normal text-ink-2">of {rows.length}</span>
          </p>
        </div>
        <div>
          <p className="text-[13px] text-ink-2">At high risk or worse</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-ink">{sum.atRisk}</p>
        </div>
        <div>
          <p className="text-[13px] text-ink-2">Debt in those loans</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-ink">{fmtUsd(sum.debtAtRiskUsd)}</p>
        </div>
      </div>

      <Panel aria-labelledby="sim-table">
        <PanelHeader id="sim-table" title="Each loan at this price" className="pb-3" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm" data-testid="sim-table">
            <thead className="border-y border-line bg-surface text-left text-[12px] text-ink-2">
              <tr>
                <th scope="col" className="px-5 py-2.5 font-medium">Loan</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">Ratio now</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">At this price</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Risk</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">Liquidates at BTC</th>
                <th scope="col" className="px-5 py-2.5 text-right font-medium">To stay safe</th>
              </tr>
            </thead>
            <tbody className="num divide-y divide-line">
              {rows.map(({ position: p, result: r, liquidationBtcUsd, priceUsd }) => (
                <tr key={p.positionId} data-position={p.positionId}>
                  <th scope="row" className="px-5 py-3 text-left font-medium">
                    <Link href={positionHref(p.protocol, p.positionId)} className="text-ink hover:underline">{positionName(p)}</Link>
                    {p.protocol === "morpho-blue" && <span className="block text-[12px] font-normal text-ink-2">Oracle {fmtUsd(priceUsd)}</span>}
                  </th>
                  <td className="px-3 py-3 text-right text-ink-2">{fmtRatio(p.collateralRatio)}</td>
                  <td className="px-3 py-3 text-right font-medium text-ink" data-testid="sim-ratio">{fmtRatio(r.collateralRatio)}</td>
                  <td className="px-3 py-3"><RiskBadge level={r.level} size="sm" /></td>
                  <td className="px-3 py-3 text-right text-ink">{liquidationBtcUsd > 0n ? fmtUsd(liquidationBtcUsd) : "Not tied to BTC"}</td>
                  <td className="px-5 py-3 text-right text-ink-2">
                    {r.repayToTarget === 0n && r.addCollToTarget === 0n ? (
                      "Nothing needed"
                    ) : (
                      <>
                        repay {fmtUnits(r.repayToTarget, p.debtAsset.decimals, 2)} {p.debtAsset.symbol}
                        <span className="block text-[12px] text-ink-3">or add {fmtUnits(r.addCollToTarget, p.collateralAsset.decimals, 6)} {p.collateralAsset.symbol}</span>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel aria-labelledby="sim-chart">
        <PanelHeader id="sim-chart" title="Ratio across BTC prices" />
        <div className="px-2 pb-4 pt-4 sm:px-4">
          <CrPriceChart positions={data.positions} btcNow={btcNow} markerUsd={price} />
        </div>
      </Panel>
    </div>
  );
}
