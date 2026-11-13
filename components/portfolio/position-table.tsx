"use client";
import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { Position, RiskAssessment, RiskLevel } from "@/lib/risk/types";
import { fmtPct, fmtRatio, fmtUsd } from "@/lib/format";
import { PROTOCOL_LABEL, RISK_LABEL, positionHref } from "@/lib/wallet/display";
import { NO_FILTER, SORT_LABEL, assetsIn, filterRows, positionName, sortRows, type PositionFilter, type SortKey } from "@/lib/wallet/positions";
import { RiskBadge } from "@/components/risk/risk-badge";
import { TokenAmount } from "@/components/risk/amount";
import { Select } from "@/components/ui/input";

const LEVELS: RiskLevel[] = ["liquidatable", "critical", "high", "watch", "healthy"];

export function PositionTable({
  positions,
  assessments,
}: {
  positions: Position[];
  assessments: Record<string, RiskAssessment>;
}) {
  const [sort, setSort] = React.useState<SortKey>("risk");
  const [filter, setFilter] = React.useState<PositionFilter>(NO_FILTER);
  const reduce = useReducedMotion();
  const all = React.useMemo(() => positions.map((p) => ({ position: p, assessment: assessments[p.positionId] })), [positions, assessments]);
  const rows = React.useMemo(() => sortRows(filterRows(all, filter), sort), [all, filter, sort]);
  const assets = React.useMemo(() => assetsIn(all), [all]);
  const protocols = [...new Set(positions.map((p) => p.protocol))];
  const filtered = filter.protocol !== "all" || filter.asset !== "all" || filter.risk !== "all";

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3 px-4 pb-3 sm:px-5" role="group" aria-label="Sort and filter loans">
        <label className="grid gap-1 text-[12px] text-ink-2">
          Sort by
          <Select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort loans">
            {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
              <option key={k} value={k}>
                {SORT_LABEL[k]}
              </option>
            ))}
          </Select>
        </label>
        <label className="grid gap-1 text-[12px] text-ink-2">
          Protocol
          <Select value={filter.protocol} onChange={(e) => setFilter({ ...filter, protocol: e.target.value as PositionFilter["protocol"] })} aria-label="Filter by protocol">
            <option value="all">All</option>
            {protocols.map((p) => (
              <option key={p} value={p}>
                {PROTOCOL_LABEL[p]}
              </option>
            ))}
          </Select>
        </label>
        <label className="grid gap-1 text-[12px] text-ink-2">
          Asset
          <Select value={filter.asset} onChange={(e) => setFilter({ ...filter, asset: e.target.value })} aria-label="Filter by asset">
            <option value="all">All</option>
            {assets.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
        </label>
        <label className="grid gap-1 text-[12px] text-ink-2">
          Risk
          <Select value={filter.risk} onChange={(e) => setFilter({ ...filter, risk: e.target.value as PositionFilter["risk"] })} aria-label="Filter by risk">
            <option value="all">All</option>
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {RISK_LABEL[l]}
              </option>
            ))}
          </Select>
        </label>
        {filtered && (
          <button type="button" onClick={() => setFilter(NO_FILTER)} className="h-9 cursor-pointer px-1 text-[13px] text-accent-ink hover:underline">
            Clear filters
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="border-t border-line px-5 py-8 text-center text-sm text-ink-2">No loans match these filters.</p>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm" data-testid="position-table">
              <thead className="border-y border-line bg-surface text-left text-[12px] text-ink-2">
                <tr>
                  <th scope="col" className="px-5 py-2.5 font-medium">Loan</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Risk</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Collateral</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Debt</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Ratio</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Liquidation price</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Price can fall</th>
                  <th scope="col" className="w-8 px-3 py-2.5"><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                <AnimatePresence initial={false}>
                  {rows.map(({ position: p, assessment: a }) => (
                    <motion.tr
                      key={p.positionId}
                      layout={!reduce}
                      initial={reduce ? false : { opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.18 }}
                      className="group relative transition-colors hover:bg-surface"
                      data-position={p.positionId}
                    >
                      <td className="px-5 py-3">
                        <Link href={positionHref(p.protocol, p.positionId)} className="font-medium text-ink after:absolute after:inset-0 focus-visible:outline-none">
                          {positionName(p)}
                        </Link>
                        <p className="text-[12px] text-ink-2">{PROTOCOL_LABEL[p.protocol]}</p>
                      </td>
                      <td className="px-3 py-3">
                        <RiskBadge level={a?.level ?? "healthy"} unverified={a?.stale || p.price.stale} />
                      </td>
                      <td className="px-3 py-3 text-right">
                        <TokenAmount value={p.collateralAmount} decimals={p.collateralAsset.decimals} symbol={p.collateralAsset.symbol} />
                        <p className="num text-[12px] text-ink-2">{fmtUsd(p.collateralValueUsd)}</p>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <TokenAmount value={p.debtAmount} decimals={p.debtAsset.decimals} symbol={p.debtAsset.symbol} />
                      </td>
                      <td className="num px-3 py-3 text-right">
                        <span className="font-medium text-ink">{fmtRatio(p.collateralRatio)}</span>
                        <p className="text-[12px] text-ink-2">min {fmtRatio(p.liquidationRatio)}</p>
                      </td>
                      <td className="num px-3 py-3 text-right text-ink">{fmtUsd(p.liquidationPriceUsd)}</td>
                      <td className="num px-3 py-3 text-right text-ink">{a ? fmtPct(a.priceDeclineBuffer, 1) : "-"}</td>
                      <td className="px-3 py-3 text-ink-3">
                        <ChevronRight aria-hidden className="size-4 transition-transform group-hover:translate-x-0.5" />
                      </td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>

          {/* Mobile list */}
          <ul className="divide-y divide-line border-t border-line md:hidden">
            {rows.map(({ position: p, assessment: a }) => (
              <li key={p.positionId} data-position={p.positionId}>
                <Link href={positionHref(p.protocol, p.positionId)} className="block px-4 py-3.5 active:bg-surface">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-ink">{positionName(p)}</p>
                      <p className="mt-0.5 text-[12px] text-ink-2">
                        <TokenAmount value={p.collateralAmount} decimals={p.collateralAsset.decimals} symbol={p.collateralAsset.symbol} /> backing{" "}
                        <TokenAmount value={p.debtAmount} decimals={p.debtAsset.decimals} symbol={p.debtAsset.symbol} />
                      </p>
                    </div>
                    <RiskBadge level={a?.level ?? "healthy"} unverified={a?.stale || p.price.stale} size="sm" />
                  </div>
                  <dl className="num mt-2.5 grid grid-cols-3 gap-2 text-[12px]">
                    <div>
                      <dt className="text-ink-2">Ratio</dt>
                      <dd className="font-medium text-ink">{fmtRatio(p.collateralRatio)}</dd>
                    </div>
                    <div>
                      <dt className="text-ink-2">Liquidation</dt>
                      <dd className="text-ink">{fmtUsd(p.liquidationPriceUsd)}</dd>
                    </div>
                    <div>
                      <dt className="text-ink-2">Can fall</dt>
                      <dd className="text-ink">{a ? fmtPct(a.priceDeclineBuffer, 1) : "-"}</dd>
                    </div>
                  </dl>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
