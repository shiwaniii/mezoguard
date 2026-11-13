"use client";
import * as React from "react";
import Link from "next/link";
import { useQueries } from "@tanstack/react-query";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Position } from "@/lib/risk/types";
import { fetchPositionDetail, positionKey } from "@/hooks/use-portfolio";
import { toNum } from "@/lib/wallet/display";
import { positionName } from "@/lib/wallet/positions";
import { SERIES_COLORS } from "./cr-price-chart";
import { Skeleton } from "@/components/ui/skeleton";

/** CR over time per loan, from stored snapshots (/api/positions history). */
export function RiskTimeline({ positions }: { positions: Position[] }) {
  const shown = positions.slice(0, 4);
  const results = useQueries({
    queries: shown.map((p) => ({
      queryKey: positionKey(p.protocol, p.positionId),
      queryFn: () => fetchPositionDetail(p.protocol, p.positionId),
      staleTime: 60_000,
    })),
  });
  if (results.some((r) => r.isLoading)) return <Skeleton className="h-48" />;
  const series = results
    .map((r, i) => ({
      p: shown[i],
      color: SERIES_COLORS[i % SERIES_COLORS.length],
      pts: (r.data?.history ?? []).map((h) => ({ t: h.timestamp, y: Math.min(toNum(h.collateralRatio) * 100, 10_000), stale: h.priceStale })),
    }))
    .filter((s) => s.pts.length > 1);
  const available = results.some((r) => r.data?.historyAvailable);
  if (series.length === 0) {
    return (
      <p className="text-sm text-ink-2">
        {available
          ? "Not enough history yet. A snapshot is stored every minute while this wallet is tracked."
          : <>History starts once this wallet is tracked. <Link className="font-medium text-accent-ink hover:underline" href="/settings">Track it in Settings</Link>.</>}
      </p>
    );
  }
  const fmtT = (t: number) => new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  return (
    <div>
      <div role="img" aria-label="Collateral ratio over time" className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis type="number" dataKey="t" domain={["dataMin", "dataMax"]} tickFormatter={(t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" })} tickLine={false} axisLine={{ stroke: "var(--line)" }} />
            <YAxis tickFormatter={(v: number) => `${v}%`} tickLine={false} axisLine={false} width={48} domain={["auto", "auto"]} />
            <Tooltip
              contentStyle={{ background: "var(--raised)", border: "1px solid var(--line)", borderRadius: 8, fontSize: 12, color: "var(--ink)" }}
              labelFormatter={(t) => fmtT(Number(t))}
              formatter={(v, n) => [`${Number(v).toFixed(1)}%`, String(n)]}
            />
            {series.map((s) => (
              <Line key={s.p.positionId} data={s.pts} dataKey="y" name={positionName(s.p)} stroke={s.color} strokeWidth={2} dot={false} isAnimationActive={false} type="monotone" />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
