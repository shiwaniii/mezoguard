import type { Position } from "@/lib/risk/types";
import { fmtPct, fmtUnits } from "@/lib/format";
import { cn } from "@/components/ui/cn";

const EXPO = {
  low: { label: "Low", dot: "bg-risk-healthy", text: "Plenty of debt would be redeemed before yours." },
  moderate: { label: "Moderate", dot: "bg-risk-watch", text: "A large redemption could reach your Trove." },
  high: { label: "High", dot: "bg-risk-high", text: "Your Trove is near the front of the queue. Even a modest redemption could take some of your BTC." },
} as const;

/** Redemption exposure for Troves, explained plainly. */
export function RedemptionExposure({ position: p }: { position: Position }) {
  const r = p.redemption;
  if (!r) return <p className="text-sm text-ink-2">Redemption data is not available for this Trove right now.</p>;
  const e = EXPO[r.exposure];
  return (
    <div className="grid gap-4">
      <p className="max-w-[68ch] text-sm text-ink-2">
        Anyone can swap MUSD for BTC from the Troves with the lowest ratios, even when they are above 110%. If yours is
        redeemed, part of your debt is paid off and the same value of BTC is taken. You do not lose money, but you lose BTC exposure.
      </p>
      <dl className="num grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        <div>
          <dt className="text-[13px] text-ink-2">Exposure</dt>
          <dd className="mt-1 inline-flex items-center gap-1.5 font-medium text-ink">
            <span aria-hidden className={cn("size-2 rounded-full", e.dot)} />
            {e.label}
          </dd>
        </div>
        <div>
          <dt className="text-[13px] text-ink-2">Place in queue</dt>
          <dd className="mt-1 font-medium text-ink">
            {r.queuePosition.toLocaleString("en-US")} <span className="font-normal text-ink-2">of {r.queueSize.toLocaleString("en-US")}</span>
          </dd>
        </div>
        <div>
          <dt className="text-[13px] text-ink-2">Debt ahead of you</dt>
          <dd className="mt-1 font-medium text-ink">{fmtUnits(r.debtAhead, 18, 0)} MUSD</dd>
        </div>
        <div>
          <dt className="text-[13px] text-ink-2">Share of all debt</dt>
          <dd className="mt-1 font-medium text-ink">{fmtPct(r.debtAheadShare, 1)}</dd>
        </div>
      </dl>
      <p className="text-sm text-ink">{e.text} Raising your ratio moves you further back.</p>
    </div>
  );
}
