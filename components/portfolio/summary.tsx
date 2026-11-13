import Link from "next/link";
import type { Portfolio } from "@/lib/wallet/decode";
import { fmtRatio, fmtUnits, fmtUsd } from "@/lib/format";
import { RISK_HELP, positionHref } from "@/lib/wallet/display";
import { positionName } from "@/lib/wallet/positions";
import { RiskBadge } from "@/components/risk/risk-badge";

/** Portfolio header: the overall verdict on the left, the totals as a quiet definition list on the right. */
export function PortfolioSummary({ data }: { data: Portfolio }) {
  const s = data.summary;
  const top = s.highestRiskPositionId ? data.positions.find((p) => p.positionId === s.highestRiskPositionId) : undefined;
  const topA = top ? data.assessments[top.positionId] : undefined;
  const btcColl = data.positions.filter((p) => p.collateralAsset.symbol === "BTC").reduce((a, p) => a + p.collateralAmount, 0n);
  const stale = s.stale || data.btcPrice.stale;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] lg:gap-12">
      <div>
        <p className="text-sm text-ink-2">Overall risk</p>
        <div className="mt-2 flex items-baseline gap-4">
          <RiskBadge level={s.level} unverified={stale} size="lg" className="text-2xl [&>span:first-child]:size-3" />
          <span className="num text-sm text-ink-2" title="0 is safest, 100 is liquidatable">
            Score <span className="font-medium text-ink">{s.riskScore}</span>/100
          </span>
        </div>
        <p className="mt-2 max-w-[44ch] text-sm text-ink-2">{RISK_HELP[s.level]}</p>
        {top && topA && s.positions > 1 && (
          <p className="mt-4 text-sm text-ink">
            Riskiest loan:{" "}
            <Link href={positionHref(top.protocol, top.positionId)} className="font-medium text-accent-ink hover:underline">
              {positionName(top)}
            </Link>{" "}
            at <span className="num">{fmtRatio(top.collateralRatio)}</span>, liquidates at <span className="num">{fmtRatio(top.liquidationRatio)}</span>.
          </p>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
        <div>
          <dt className="text-[13px] text-ink-2">Total collateral</dt>
          <dd className="num mt-1 text-xl font-semibold tracking-tight text-ink">{fmtUsd(s.totalCollateralUsd)}</dd>
          {btcColl > 0n && <dd className="num text-[13px] text-ink-2">{fmtUnits(btcColl, 18, 6)} BTC</dd>}
        </div>
        <div>
          <dt className="text-[13px] text-ink-2">Total debt</dt>
          <dd className="num mt-1 text-xl font-semibold tracking-tight text-ink">{fmtUsd(s.totalDebtUsd)}</dd>
          {Object.entries(s.debtByAsset).map(([sym, v]) => (
            <dd key={sym} className="num text-[13px] text-ink-2">
              {fmtUnits(v, data.positions.find((p) => p.debtAsset.symbol === sym)?.debtAsset.decimals ?? 18, 2)} {sym}
            </dd>
          ))}
        </div>
        <div>
          <dt className="text-[13px] text-ink-2">Active loans</dt>
          <dd className="num mt-1 text-xl font-semibold tracking-tight text-ink">{s.positions}</dd>
          <dd className="num text-[13px] text-ink-2">Combined ratio {fmtRatio(s.aggregateRatio)}</dd>
        </div>
        <div>
          <dt className="text-[13px] text-ink-2">Debt at high risk or worse</dt>
          <dd className="num mt-1 text-xl font-semibold tracking-tight text-ink">{fmtUsd(s.debtAtRiskUsd)}</dd>
        </div>
        <div>
          <dt className="text-[13px] text-ink-2">BTC price (Mezo feed)</dt>
          <dd className="num mt-1 text-xl font-semibold tracking-tight text-ink">{fmtUsd(data.btcPrice.usd)}</dd>
          {data.btcPrice.stale && <dd className="text-[13px] text-warn-ink">Delayed</dd>}
        </div>
      </dl>
    </div>
  );
}
