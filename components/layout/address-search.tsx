"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { parseAddressInput } from "@/lib/wallet/api";
import { cn } from "@/components/ui/cn";

/** "Explore any address" input. Validates before navigating; errors are inline and plain. */
export function AddressSearch({
  className,
  compact,
  onNavigate,
}: {
  className?: string;
  compact?: boolean;
  onNavigate?: (address: string) => void;
}) {
  const router = useRouter();
  const [value, setValue] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const id = React.useId();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const r = parseAddressInput(value);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setError(null);
    if (onNavigate) onNavigate(r.address);
    else router.push(`/portfolio/${r.address}`);
  }

  return (
    <form onSubmit={submit} noValidate className={cn("w-full", className)} role="search" aria-label="Look up a wallet">
      <label htmlFor={id} className={cn("mb-1.5 block text-sm font-medium text-ink", compact && "sr-only")}>
        Or look up any wallet
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          placeholder="0x…"
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-err` : undefined}
          className="h-10 min-w-0 flex-1 rounded-md border border-line-strong bg-raised px-3 font-mono text-[13px] text-ink shadow-sm outline-none transition-colors focus-visible:border-focus aria-invalid:border-risk-critical"
        />
        <button
          type="submit"
          className="inline-flex h-10 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-line-strong bg-raised px-3.5 text-sm font-medium text-ink shadow-sm transition-colors hover:bg-surface-2 active:translate-y-px"
        >
          View <ArrowRight aria-hidden className="size-4" />
        </button>
      </div>
      {error && (
        <p id={`${id}-err`} role="alert" className="mt-1.5 text-[13px] text-danger-ink">
          {error}
        </p>
      )}
    </form>
  );
}
