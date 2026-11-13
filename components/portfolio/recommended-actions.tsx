"use client";
import * as React from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import type { Portfolio } from "@/lib/wallet/decode";
import type { Position, Recommendation } from "@/lib/risk/types";
import { RISK_ORDER } from "@/lib/risk/types";
import { fmtRatio, fmtUnits } from "@/lib/format";
import { positionHref } from "@/lib/wallet/display";
import { positionName } from "@/lib/wallet/positions";
import { RiskBadge } from "@/components/risk/risk-badge";
import { Button } from "@/components/ui/button";
import { ActionSheet } from "@/components/actions/action-sheet";
import type { ActionKind } from "@/lib/wallet/plans";

export function RecommendedActions({ data }: { data: Portfolio }) {
  const { address } = useAccount();
  const [active, setActive] = React.useState<{ p: Position; r: Recommendation; kind: ActionKind; amount: bigint } | null>(null);
  const items = data.positions
    .map((p) => ({ p, a: data.assessments[p.positionId], r: data.recommendations[p.positionId] }))
    .filter((x) => x.a && x.r && RISK_ORDER[x.a.level] >= RISK_ORDER.watch && (x.r.repayAmount > 0n || x.r.addCollateral > 0n))
    .sort((x, y) => RISK_ORDER[y.a.level] - RISK_ORDER[x.a.level]);

  if (items.length === 0) {
    return <p className="text-sm text-ink-2">Nothing to do right now. Every loan is above its warning line.</p>;
  }
  const own = address?.toLowerCase() === data.owner.toLowerCase();
  return (
    <>
      <ul className="divide-y divide-line">
        {items.map(({ p, a, r }) => (
          <li key={p.positionId} className="py-3.5 first:pt-0">
            <div className="flex items-center justify-between gap-3">
              <Link href={positionHref(p.protocol, p.positionId)} className="font-medium text-ink hover:underline">
                {positionName(p)}
              </Link>
              <RiskBadge level={a.level} unverified={a.stale} size="sm" />
            </div>
            <p className="mt-1 text-sm text-ink-2">
              To get back to <span className="num text-ink">{fmtRatio(r.targetRatio)}</span>:{" "}
              {r.repayFeasible && r.repayAmount > 0n && (
                <>
                  repay <span className="num text-ink">{fmtUnits(r.repayAmount, p.debtAsset.decimals, 2)} {p.debtAsset.symbol}</span>
                  {r.addCollateral > 0n && " or "}
                </>
              )}
              {r.addCollateral > 0n && (
                <>
                  add <span className="num text-ink">{fmtUnits(r.addCollateral, p.collateralAsset.decimals, 6)} {p.collateralAsset.symbol}</span>
                </>
              )}
              .
            </p>
            {r.repayNote && <p className="mt-1 text-[13px] text-ink-3">{r.repayNote}</p>}
            {own && (
              <div className="mt-2.5 flex flex-wrap gap-2">
                {r.repayFeasible && r.repayAmount > 0n && (
                  <Button size="sm" onClick={() => setActive({ p, r, kind: "repay", amount: r.repayAmount })}>
                    Repay
                  </Button>
                )}
                {r.addCollateral > 0n && (
                  <Button size="sm" variant="secondary" onClick={() => setActive({ p, r, kind: "add-collateral", amount: r.addCollateral })}>
                    Add {p.collateralAsset.symbol}
                  </Button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {!own && <p className="mt-3 text-[13px] text-ink-3">Connect the owner&apos;s wallet to act on these.</p>}
      {active && (
        <ActionSheet
          position={active.p}
          recommendation={active.r}
          open
          onOpenChange={(o) => !o && setActive(null)}
          initialKind={active.kind}
          initialAmount={active.amount}
        />
      )}
    </>
  );
}
