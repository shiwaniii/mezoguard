"use client";
import * as React from "react";
import { simulate } from "@/lib/risk";
import type { Position } from "@/lib/risk/types";
import { fmtPct, fmtRatio, fmtUnits, fmtUsd } from "@/lib/format";
import { applyPct, clientAdapters } from "@/lib/wallet/reprice";
import { RiskBadge } from "@/components/risk/risk-badge";

const PRESETS = [-5, -10, -15, -20, 10];

export function Scenarios({ position: p, targetRatio }: { position: Position; targetRatio: bigint }) {
  const [custom, setCustom] = React.useState("-30");
  const customN = Number(custom);
  const customValid = Number.isFinite(customN) && customN > -100 && customN <= 500;
  const rows = [...PRESETS.map((pct) => ({ pct, custom: false })), ...(customValid ? [{ pct: customN, custom: true }] : [])];
  const adapter = clientAdapters[p.protocol];
  const priceName = p.protocol === "morpho-blue" ? "Oracle price" : "BTC price";

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-sm">
          <thead className="border-b border-line text-left text-[12px] text-ink-2">
            <tr>
              <th scope="col" className="py-2 pr-3 font-medium">Price move</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">{priceName}</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Ratio</th>
              <th scope="col" className="px-3 py-2 font-medium">Risk</th>
              <th scope="col" className="py-2 pl-3 text-right font-medium">To stay at {fmtRatio(targetRatio)}</th>
            </tr>
          </thead>
          <tbody className="num divide-y divide-line">
            {rows.map(({ pct, custom: isCustom }) => {
              const price = applyPct(p.price.usd, pct);
              const r = simulate(p, price, adapter, undefined, targetRatio);
              return (
                <tr key={`${pct}-${isCustom}`} data-scenario={pct}>
                  <th scope="row" className="py-2.5 pr-3 text-left font-medium text-ink">
                    {pct > 0 ? `+${pct}` : pct}%{isCustom && <span className="ml-1.5 font-normal text-ink-3">custom</span>}
                  </th>
                  <td className="px-3 py-2.5 text-right text-ink">{fmtUsd(price)}</td>
                  <td className="px-3 py-2.5 text-right font-medium text-ink">{fmtRatio(r.collateralRatio)}</td>
                  <td className="px-3 py-2.5"><RiskBadge level={r.level} size="sm" /></td>
                  <td className="py-2.5 pl-3 text-right text-ink-2">
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
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <label htmlFor="custom-move" className="text-[13px] text-ink-2">Try your own move</label>
        <div className="flex h-9 w-28 items-center rounded-md border border-line-strong bg-raised focus-within:border-focus">
          <input
            id="custom-move"
            inputMode="decimal"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            aria-invalid={!customValid || undefined}
            className="num h-full min-w-0 flex-1 bg-transparent px-2.5 text-sm outline-none"
          />
          <span className="pr-2.5 text-sm text-ink-2">%</span>
        </div>
        {!customValid && <span role="alert" className="text-[13px] text-danger-ink">Use a number between -99 and 500.</span>}
        {customValid && <span className="text-[13px] text-ink-3">Price can fall {fmtPct(simulate(p, p.price.usd, adapter).priceDeclineBuffer, 1)} before liquidation.</span>}
      </div>
    </div>
  );
}
