"use client";
import Link from "next/link";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { PositionDetail } from "@/lib/wallet/decode";
import { toNum } from "@/lib/wallet/display";

export function HistoryChart({ detail }: { detail: PositionDetail }) {
  const pts = detail.history.map((h) => ({ t: h.timestamp, cr: Math.min(toNum(h.collateralRatio) * 100, 10_000), btc: toNum(h.btcPrice), stale: h.priceStale }));
  if (pts.length < 2) {
    return (
      <p className="text-sm text-ink-2">
        {detail.historyAvailable ? (
          "Not enough history yet. A snapshot is stored every minute while the wallet is tracked."
        ) : (
          <>
            History starts once this wallet is tracked.{" "}
            <Link href="/settings" className="font-medium text-accent-ink hover:underline">Track it in Settings</Link>.
          </>
        )}
      </p>
    );
  }
  const liq = toNum(detail.position.liquidationRatio) * 100;
  const fmtT = (t: number) => new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  return (
    <div role="img" aria-label="Collateral ratio history with the liquidation line" className="h-60">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={pts} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" })} tickLine={false} axisLine={{ stroke: "var(--line)" }} />
          <YAxis tickFormatter={(v: number) => `${v}%`} tickLine={false} axisLine={false} width={48} domain={[(min: number) => Math.min(min, liq) * 0.95, "auto"]} />
          <Tooltip
            contentStyle={{ background: "var(--raised)", border: "1px solid var(--line)", borderRadius: 8, fontSize: 12, color: "var(--ink)" }}
            labelFormatter={(t) => fmtT(Number(t))}
            formatter={(v, n) => (n === "cr" ? [`${Number(v).toFixed(1)}%`, "Ratio"] : [String(v), String(n)])}
          />
          <ReferenceLine y={liq} stroke="var(--risk-critical)" strokeDasharray="4 4" label={{ value: `Liquidation ${liq.toFixed(1)}%`, position: "insideBottomRight", fill: "var(--danger-ink)", fontSize: 11 }} />
          <Line dataKey="cr" name="cr" stroke="var(--chart-1)" strokeWidth={2} dot={false} isAnimationActive={false} type="monotone" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
