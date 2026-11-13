import { ExternalLink } from "lucide-react";
import { explorerAddress } from "@/lib/chain/config";
import { fmtUnits } from "@/lib/format";
import type { TxStep } from "@/lib/wallet/plans";

/** Exact preview of what the wallet will be asked to sign: contract, address, function, args, value. */
export function TxPreview({ steps, gas, skipped }: { steps: TxStep[]; gas?: Record<string, bigint | "error" | undefined>; skipped?: Record<string, boolean> }) {
  return (
    <ol className="grid gap-3" aria-label="Transactions to sign">
      {steps.map((s, i) => {
        const g = gas?.[s.key];
        return (
          <li key={s.key} className="rounded-md border border-line bg-surface p-3.5 text-[13px]" data-testid={`tx-step-${s.key}`}>
            <div className="flex items-baseline justify-between gap-3">
              <p className="font-medium text-ink">
                {steps.length > 1 && <span className="num mr-1.5 text-ink-3">{i + 1}.</span>}
                {s.label}
              </p>
              {skipped?.[s.key] && <span className="text-[12px] text-ok-ink">Already approved</span>}
            </div>
            <dl className="mt-2.5 grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1.5">
              <dt className="text-ink-2">Contract</dt>
              <dd className="min-w-0">
                <span className="text-ink">{s.contractName}</span>
                <a
                  href={explorerAddress(s.address)}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-0.5 flex items-center gap-1 break-all font-mono text-[12px] text-accent-ink hover:underline"
                >
                  {s.address}
                  <ExternalLink aria-hidden className="size-3 shrink-0" />
                </a>
              </dd>
              <dt className="text-ink-2">Function</dt>
              <dd className="font-mono text-[12px] text-ink">{s.functionName}</dd>
              {s.previewArgs.length > 0 && (
                <>
                  <dt className="text-ink-2">Arguments</dt>
                  <dd className="min-w-0">
                    <ul className="grid gap-1">
                      {s.previewArgs.map((a) => (
                        <li key={a.name} className="min-w-0">
                          <span className="font-mono text-[12px] text-ink-2">{a.name}</span>{" "}
                          <span className="num break-all text-ink">{a.display}</span>
                        </li>
                      ))}
                    </ul>
                  </dd>
                </>
              )}
              <dt className="text-ink-2">BTC sent</dt>
              <dd className="num text-ink">{s.value && s.value > 0n ? `${fmtUnits(s.value, 18, 8)} BTC` : "0 BTC"}</dd>
              {gas && (
                <>
                  <dt className="text-ink-2">Gas estimate</dt>
                  <dd className="num text-ink">
                    {g === undefined ? (skipped?.[s.key] ? "Not needed" : "Estimating…") : g === "error" ? "Estimated after the step before it" : `${g.toLocaleString("en-US")} gas`}
                  </dd>
                </>
              )}
            </dl>
          </li>
        );
      })}
    </ol>
  );
}
