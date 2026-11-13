"use client";
import * as React from "react";
import { useAccount } from "wagmi";
import { RefreshCw } from "lucide-react";
import { usePortfolio } from "@/hooks/use-portfolio";
import { useNow } from "@/hooks/use-now";
import { relativeTime } from "@/lib/wallet/display";
import { shortAddress } from "@/lib/wallet/api";
import { explorerAddress } from "@/lib/chain/config";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Callout } from "@/components/ui/callout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StaleBanner } from "@/components/risk/stale-banner";
import { PortfolioSummary } from "./summary";
import { CrPriceChart } from "./cr-price-chart";
import { DebtByRisk, ProtocolBreakdown } from "./exposure-bars";
import { PositionTable } from "./position-table";
import { RecommendedActions } from "./recommended-actions";
import { RecentAlerts } from "./recent-alerts";
import { RiskTimeline } from "./risk-timeline";
import { EmptyPortfolio } from "./empty-state";
import { AddressSearch } from "@/components/layout/address-search";
import { useMounted } from "@/hooks/use-mounted";

export function PortfolioSkeleton() {
  return (
    <div className="grid gap-8" aria-busy="true" aria-label="Loading portfolio">
      <div className="grid gap-8 lg:grid-cols-[1fr_1.5fr]">
        <div className="grid gap-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="grid gap-2">
              <Skeleton className="h-3.5 w-20" />
              <Skeleton className="h-6 w-28" />
            </div>
          ))}
        </div>
      </div>
      <Skeleton className="h-72 w-full rounded-lg" />
      <Skeleton className="h-48 w-full rounded-lg" />
    </div>
  );
}

export function PortfolioView({ address }: { address: string }) {
  const q = usePortfolio(address);
  const now = useNow(1000);
  const { address: me } = useAccount();
  const mounted = useMounted();
  const isOwn = mounted && me?.toLowerCase() === address.toLowerCase();
  const data = q.data;

  const anyStale = !!data && (data.btcPrice.stale || data.summary.stale || Object.values(data.assessments).some((a) => a.stale));
  const staleReason = data?.btcPrice.staleReason ?? data?.positions.find((p) => p.price.stale)?.price.staleReason;
  const failed = data?.protocols.filter((p) => p.status === "error") ?? [];

  return (
    <div className="container-page py-8 md:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{isOwn ? "Your loans" : "Loans for this wallet"}</h1>
          <p className="mt-1 text-sm text-ink-2">
            <a href={explorerAddress(address)} target="_blank" rel="noreferrer" className="font-mono text-[13px] hover:text-ink hover:underline" title={address}>
              <span className="sm:hidden">{shortAddress(address, 6)}</span>
              <span className="hidden sm:inline">{address}</span>
            </a>
          </p>
        </div>
        <div className="flex items-center gap-3 text-[13px] text-ink-2">
          {data && (
            <span aria-live="polite" className="num">
              {q.isFetching ? "Updating…" : `Updated ${relativeTime(data.readAt, now)}`}
            </span>
          )}
          <Button variant="secondary" size="sm" onClick={() => q.refetch()} disabled={q.isFetching} aria-label="Refresh now">
            <RefreshCw aria-hidden className={q.isFetching ? "animate-spin motion-reduce:animate-none" : ""} /> Refresh
          </Button>
        </div>
      </div>

      <div className="mt-6 grid gap-3">
        {anyStale && <StaleBanner reason={staleReason} />}
        {failed.map((f) => (
          <Callout key={f.id} tone="warn" role="status" title={`Could not check ${f.label}`}>
            Loans on {f.label} may be missing from this page. This is a read problem, not proof that you have no loans there.
            {f.error ? ` (${f.error})` : ""}
          </Callout>
        ))}
        {q.error && data && <Callout tone="warn" role="status">Showing the last successful read. Refresh failed: {q.error.message}</Callout>}
      </div>

      <div className="mt-6">
        {q.isLoading ? (
          <PortfolioSkeleton />
        ) : q.error && !data ? (
          <Callout tone="danger" role="alert" title="Could not load this wallet" action={<Button size="sm" variant="secondary" onClick={() => q.refetch()}>Try again</Button>}>
            {q.error.message}
          </Callout>
        ) : !data ? null : data.positions.length === 0 ? (
          failed.length > 0 ? (
            <p className="py-10 text-center text-sm text-ink-2">No loans found on the protocols we could check. Try again in a moment for the others.</p>
          ) : (
            <>
              <EmptyPortfolio isOwn={isOwn} />
              {!isOwn && <AddressSearch className="mx-auto max-w-md" />}
            </>
          )
        ) : (
          <div className="grid gap-8">
            <PortfolioSummary data={data} />

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
              <Panel aria-labelledby="cr-chart-h">
                <PanelHeader
                  id="cr-chart-h"
                  title="What a BTC move does to each loan"
                  description="Each Morpho market uses its own oracle, moved by the same percentage as BTC."
                />
                <div className="px-2 pb-4 pt-4 sm:px-4">
                  <CrPriceChart positions={data.positions} btcNow={data.btcPrice.usd} />
                </div>
              </Panel>
              <div className="grid content-start gap-6">
                <Panel aria-labelledby="dist-h">
                  <PanelHeader id="dist-h" title="Debt by risk level" />
                  <div className="p-4 sm:px-5">
                    <DebtByRisk positions={data.positions} assessments={data.assessments} />
                  </div>
                </Panel>
                <Panel aria-labelledby="proto-h">
                  <PanelHeader id="proto-h" title="By protocol" />
                  <div className="p-4 sm:px-5">
                    <ProtocolBreakdown summary={data.summary} />
                  </div>
                </Panel>
              </div>
            </div>

            <Panel aria-labelledby="positions-h">
              <PanelHeader id="positions-h" title="Loans" description={`${data.positions.length} open`} className="pb-3" />
              <PositionTable positions={data.positions} assessments={data.assessments} />
            </Panel>

            <div className="grid gap-6 lg:grid-cols-2">
              <Panel aria-labelledby="rec-h">
                <PanelHeader id="rec-h" title="Recommended actions" />
                <div className="p-4 sm:px-5">
                  <RecommendedActions data={data} />
                </div>
              </Panel>
              <Panel aria-labelledby="alerts-h">
                <PanelHeader id="alerts-h" title="Recent alerts" />
                <div className="p-4 sm:px-5">
                  <RecentAlerts owner={data.owner} />
                </div>
              </Panel>
            </div>

            <Panel aria-labelledby="timeline-h">
              <PanelHeader id="timeline-h" title="Ratio history" />
              <div className="p-4 sm:px-5">
                <RiskTimeline positions={data.positions} />
              </div>
            </Panel>
          </div>
        )}
      </div>
    </div>
  );
}
