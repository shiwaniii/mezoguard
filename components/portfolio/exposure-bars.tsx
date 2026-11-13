import type { Position, RiskAssessment, RiskLevel } from "@/lib/risk/types";
import type { PortfolioSummary } from "@/lib/risk/types";
import { fmtPct, fmtUsd } from "@/lib/format";
import { PROTOCOL_LABEL, RISK_LABEL } from "@/lib/wallet/display";
import { cn } from "@/components/ui/cn";

const LEVELS: RiskLevel[] = ["healthy", "watch", "high", "critical", "liquidatable"];
const BG: Record<RiskLevel, string> = {
  healthy: "bg-risk-healthy",
  watch: "bg-risk-watch",
  high: "bg-risk-high",
  critical: "bg-risk-critical",
  liquidatable: "bg-risk-liquidatable",
};
const WAD = 10n ** 18n;

/** Debt split by risk level: one segmented bar + a labelled list (colour is never the only cue). */
export function DebtByRisk({ positions, assessments }: { positions: Position[]; assessments: Record<string, RiskAssessment> }) {
  const by = new Map<RiskLevel, bigint>();
  let total = 0n;
  for (const p of positions) {
    const l = assessments[p.positionId]?.level ?? "healthy";
    by.set(l, (by.get(l) ?? 0n) + p.debtValueUsd);
    total += p.debtValueUsd;
  }
  const rows = LEVELS.filter((l) => (by.get(l) ?? 0n) > 0n);
  return (
    <div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
        {rows.map((l) => (
          <span
            key={l}
            className={cn(BG[l], "h-full border-r-2 border-raised last:border-r-0")}
            style={{ width: `${total > 0n ? Number(((by.get(l) ?? 0n) * 10_000n) / total) / 100 : 0}%` }}
          />
        ))}
      </div>
      <dl className="mt-3 grid gap-1.5 text-[13px]">
        {rows.map((l) => (
          <div key={l} className="flex items-center justify-between gap-3">
            <dt className="inline-flex items-center gap-1.5 text-ink">
              <span aria-hidden className={cn("size-2 rounded-full", BG[l])} />
              {RISK_LABEL[l]}
            </dt>
            <dd className="num text-ink-2">
              {fmtUsd(by.get(l) ?? 0n)}
              <span className="ml-2 inline-block w-12 text-right text-ink-3">{total > 0n ? fmtPct(((by.get(l) ?? 0n) * WAD) / total, 0) : "0%"}</span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Collateral and debt share by protocol, from the summary's concentration list. */
export function ProtocolBreakdown({ summary }: { summary: PortfolioSummary }) {
  const agg = new Map<string, { coll: bigint; debt: bigint; n: number }>();
  for (const c of summary.concentration) {
    const a = agg.get(c.protocol) ?? { coll: 0n, debt: 0n, n: 0 };
    a.coll += c.collateralShare;
    a.debt += c.debtShare;
    a.n += 1;
    agg.set(c.protocol, a);
  }
  const largest = [...summary.concentration].sort((a, b) => (b.debtShare > a.debtShare ? 1 : -1))[0];
  return (
    <div>
      <table className="w-full text-[13px]">
        <thead className="text-ink-2">
          <tr>
            <th scope="col" className="pb-1.5 text-left font-normal">Protocol</th>
            <th scope="col" className="pb-1.5 text-right font-normal">Collateral</th>
            <th scope="col" className="pb-1.5 text-right font-normal">Debt</th>
          </tr>
        </thead>
        <tbody className="num">
          {[...agg.entries()].map(([id, a]) => (
            <tr key={id} className="border-t border-line">
              <th scope="row" className="py-1.5 text-left font-medium text-ink">
                {PROTOCOL_LABEL[id as keyof typeof PROTOCOL_LABEL] ?? id}
                <span className="ml-1 font-normal text-ink-3">×{a.n}</span>
              </th>
              <td className="py-1.5 text-right text-ink">{fmtPct(a.coll, 0)}</td>
              <td className="py-1.5 text-right text-ink">{fmtPct(a.debt, 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {largest && summary.concentration.length > 1 && largest.debtShare > (WAD * 6n) / 10n && (
        <p className="mt-3 text-[13px] text-ink-2">
          {fmtPct(largest.debtShare, 0)} of your debt sits in one loan. A problem there affects most of your exposure.
        </p>
      )}
    </div>
  );
}
