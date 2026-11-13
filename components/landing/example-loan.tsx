"use client";
import * as React from "react";
import { motion, useReducedMotion } from "motion/react";
import { Slider } from "@/components/ui/slider";
import { RiskBadge } from "@/components/risk/risk-badge";
import type { RiskLevel } from "@/lib/risk/types";

/**
 * A working example, not a screenshot: one illustrative Trove (0.10 BTC, 4,000 MUSD, liquidates at 110%).
 * Thresholds mirror the app defaults: watch < 1.6×, high < 1.3×, critical < 1.1× the liquidation ratio.
 */
const COLL = 0.1;
const DEBT = 4000;
const LIQ = 1.1;
const START = 74000;

function levelFor(cr: number): RiskLevel {
  if (cr < LIQ) return "liquidatable";
  if (cr < LIQ * 1.1) return "critical";
  if (cr < LIQ * 1.3) return "high";
  if (cr < LIQ * 1.6) return "watch";
  return "healthy";
}

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function ExampleLoan() {
  const [price, setPrice] = React.useState(START);
  const reduce = useReducedMotion();
  const cr = (COLL * price) / DEBT;
  const level = levelFor(cr);
  const liqPrice = (LIQ * DEBT) / COLL;
  const buffer = Math.max(0, (price - liqPrice) / price);
  // position of the needle on a 100%..300% scale
  const pos = Math.min(1, Math.max(0, (cr - 1) / 2));
  const marks = [1.1, LIQ * 1.1, LIQ * 1.3, LIQ * 1.6].map((m) => ((m - 1) / 2) * 100);

  return (
    <figure className="rounded-xl border border-line bg-raised p-5 shadow-sm sm:p-6" aria-label="Example loan">
      <div className="flex items-baseline justify-between gap-4">
        <figcaption className="text-sm font-medium text-ink">Example loan</figcaption>
        <span className="text-[13px] text-ink-2">0.10 BTC backing 4,000 MUSD</span>
      </div>

      <div className="mt-6 flex items-end justify-between gap-4">
        <div>
          <p className="text-[13px] text-ink-2">Collateral ratio</p>
          <p className="num mt-0.5 text-4xl font-semibold tracking-tight text-ink">{(cr * 100).toFixed(1)}%</p>
        </div>
        <RiskBadge level={level} size="lg" />
      </div>

      <div className="relative mt-5 h-2 rounded-full bg-surface-2" aria-hidden>
        <div className="absolute inset-y-0 left-0 rounded-l-full bg-risk-liquidatable/25" style={{ width: `${marks[0]}%` }} />
        {marks.map((m, i) => (
          <span key={i} className="absolute top-[-3px] h-3.5 w-px bg-line-strong" style={{ left: `${m}%` }} />
        ))}
        <motion.span
          className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-raised bg-ink shadow-sm"
          animate={{ left: `${pos * 100}%` }}
          transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 34 }}
        />
      </div>
      <div className="num mt-1.5 flex justify-between text-[11px] text-ink-3" aria-hidden>
        <span>100%</span>
        <span>Liquidation at 110%</span>
        <span>300%</span>
      </div>

      <div className="mt-6">
        <div className="flex items-baseline justify-between">
          <label htmlFor="example-price" className="text-[13px] text-ink-2">
            Drag the BTC price
          </label>
          <span className="num text-sm font-medium text-ink">{usd(price)}</span>
        </div>
        <Slider
          id="example-price"
          label="BTC price"
          className="mt-2"
          min={30000}
          max={110000}
          step={500}
          value={[price]}
          onValueChange={(v) => setPrice(v[0] ?? START)}
        />
      </div>

      <dl className="num mt-6 grid grid-cols-2 gap-4 border-t border-line pt-4 text-sm">
        <div>
          <dt className="text-[13px] text-ink-2">Liquidation price</dt>
          <dd className="mt-0.5 font-medium text-ink">{usd(liqPrice)}</dd>
        </div>
        <div>
          <dt className="text-[13px] text-ink-2">BTC can fall</dt>
          <dd className="mt-0.5 font-medium text-ink">{buffer > 0 ? `${(buffer * 100).toFixed(1)}% more` : "No room left"}</dd>
        </div>
      </dl>
    </figure>
  );
}
