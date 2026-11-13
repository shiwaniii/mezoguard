"use client";
import * as React from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { crCurve } from "@/lib/risk";
import type { Position } from "@/lib/risk/types";
import { clientAdapters, scaledCollateralPrice, tracksBtc } from "@/lib/wallet/reprice";
import { compactUsd, toNum } from "@/lib/wallet/display";
import { positionName } from "@/lib/wallet/positions";

export const SERIES_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)"];
const STEPS = 48;

export interface Series {
  id: string;
  name: string;
  color: string;
  liqPct: number;
  points: { x: number; y: number }[];
}

/**
 * CR as a function of the BTC price for every position. Morpho positions are re-priced on their own oracle,
 * scaled by the same percentage move as BTC; non-BTC collateral stays flat.
 */
export function buildCrSeries(positions: Position[], btcNow: bigint, fromPct = 0.4, toPct = 1.6): Series[] {
  if (btcNow <= 0n) return [];
  const from = (btcNow * BigInt(Math.round(fromPct * 1000))) / 1000n;
  const to = (btcNow * BigInt(Math.round(toPct * 1000))) / 1000n;
  return positions.map((p, i) => {
    const adapter = clientAdapters[p.protocol];
    const pFrom = scaledCollateralPrice(p, from, btcNow);
    const pTo = scaledCollateralPrice(p, to, btcNow);
    const curve = tracksBtc(p) ? crCurve(p, adapter, pFrom, pTo, STEPS) : crCurve(p, adapter, p.price.usd, p.price.usd, STEPS);
    const xs = (k: number) => toNum(from) + ((toNum(to) - toNum(from)) * k) / STEPS;
    return {
      id: p.positionId,
      name: positionName(p),
      color: SERIES_COLORS[i % SERIES_COLORS.length],
      liqPct: toNum(p.liquidationRatio) * 100,
      points: curve.map((c, k) => ({ x: xs(k), y: Math.min(toNum(c.ratio) * 100, 10_000) })),
    };
  });
}

export function CrPriceChart({
  positions,
  btcNow,
  height = 280,
  markerUsd,
}: {
  positions: Position[];
  btcNow: bigint;
  height?: number;
  /** Optional second vertical marker (e.g. simulated price). */
  markerUsd?: number;
}) {
  const series = React.useMemo(() => buildCrSeries(positions, btcNow), [positions, btcNow]);
  const nowX = toNum(btcNow);
  const currentMax = Math.max(0, ...positions.map((p) => Math.min(toNum(p.collateralRatio) * 100, 10_000)));
  const yMax = Math.ceil(Math.min(800, Math.max(250, currentMax * 1.25)) / 50) * 50;
  const liqLines = [...new Set(series.map((s) => Math.round(s.liqPct * 10) / 10))];

  if (series.length === 0) return null;
  return (
    <div>
      <div role="img" aria-label="Collateral ratio of each loan at different BTC prices, with liquidation lines" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="0" />
            <XAxis
              type="number"
              dataKey="x"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(v: number) => compactUsd(v)}
              tickLine={false}
              axisLine={{ stroke: "var(--line)" }}
              tickCount={6}
            />
            <YAxis
              type="number"
              domain={[0, yMax]}
              allowDataOverflow
              tickFormatter={(v: number) => `${v}%`}
              tickLine={false}
              axisLine={false}
              width={48}
            />
            <Tooltip
              cursor={{ stroke: "var(--line-strong)" }}
              contentStyle={{ background: "var(--raised)", border: "1px solid var(--line)", borderRadius: 8, fontSize: 12, color: "var(--ink)" }}
              labelFormatter={(v) => `BTC ${Number(v).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}`}
              formatter={(v, name) => [`${Number(v).toFixed(1)}%`, String(name)]}
            />
            {liqLines.map((l) => (
              <ReferenceLine
                key={l}
                y={l}
                stroke="var(--risk-critical)"
                strokeDasharray="4 4"
                strokeOpacity={0.8}
                label={{ value: `Liquidation ${l}%`, position: "insideBottomRight", fill: "var(--danger-ink)", fontSize: 11 }}
              />
            ))}
            <ReferenceLine x={nowX} stroke="var(--ink-3)" label={{ value: "Now", position: "insideTopLeft", fill: "var(--ink-2)", fontSize: 11 }} />
            {markerUsd !== undefined && Math.abs(markerUsd - nowX) > 1 && (
              <ReferenceLine x={markerUsd} stroke="var(--accent)" strokeDasharray="2 3" label={{ value: "Simulated", position: "insideTopRight", fill: "var(--accent-ink)", fontSize: 11 }} />
            )}
            {series.map((s) => (
              <Line
                key={s.id}
                data={s.points}
                dataKey="y"
                name={s.name}
                type="monotone"
                stroke={s.color}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-ink-2">
        {series.map((s) => (
          <li key={s.id} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-0.5 w-3.5 rounded-full" style={{ background: s.color }} />
            {s.name}
          </li>
        ))}
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-0 w-3.5 border-t border-dashed border-risk-critical" />
          Liquidation line
        </li>
      </ul>
    </div>
  );
}
