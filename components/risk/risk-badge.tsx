import type { RiskLevel } from "@/lib/risk/types";
import { RISK_LABEL } from "@/lib/wallet/display";
import { cn } from "@/components/ui/cn";

const DOT: Record<RiskLevel, string> = {
  healthy: "bg-risk-healthy",
  watch: "bg-risk-watch",
  high: "bg-risk-high",
  critical: "bg-risk-critical",
  liquidatable: "bg-risk-liquidatable ring-2 ring-risk-liquidatable/30",
};

/**
 * The one risk treatment: coloured dot + word in ink. Colour is never the only signal.
 * `unverified` (stale price) adds a hollow ring and the word "unverified".
 */
export function RiskBadge({
  level,
  unverified,
  size = "md",
  className,
}: {
  level: RiskLevel;
  unverified?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap font-medium text-ink",
        size === "sm" && "text-[12px]",
        size === "md" && "text-[13px]",
        size === "lg" && "text-base",
        className,
      )}
      data-level={level}
    >
      <span
        aria-hidden
        className={cn(
          "inline-block shrink-0 rounded-full",
          size === "lg" ? "size-2.5" : "size-2",
          DOT[level],
          unverified && "opacity-60 outline-1 outline-offset-1 outline-dashed outline-ink-3",
        )}
      />
      {RISK_LABEL[level]}
      {unverified && <span className="font-normal text-ink-3">(unverified)</span>}
    </span>
  );
}
