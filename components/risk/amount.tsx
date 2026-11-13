import { fmtUnits, fmtUsd } from "@/lib/format";
import { cn } from "@/components/ui/cn";

export function TokenAmount({
  value,
  decimals,
  symbol,
  maxFrac,
  className,
}: {
  value: bigint;
  decimals: number;
  symbol: string;
  maxFrac?: number;
  className?: string;
}) {
  const frac = maxFrac ?? (symbol === "BTC" ? 6 : 2);
  return (
    <span className={cn("num whitespace-nowrap", className)}>
      {fmtUnits(value, decimals, frac)} <span className="text-ink-2">{symbol}</span>
    </span>
  );
}

export function Usd({ value, className }: { value: bigint; className?: string }) {
  return <span className={cn("num whitespace-nowrap", className)}>{fmtUsd(value)}</span>;
}
