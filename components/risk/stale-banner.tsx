import { Callout } from "@/components/ui/callout";

/** Shown whenever any price behind the numbers is stale. Never present stale as live. */
export function StaleBanner({ reason, className }: { reason?: string; className?: string }) {
  return (
    <Callout tone="warn" role="status" className={className} title="Prices are delayed">
      The price feed has not updated recently{reason ? ` (${reason})` : ""}. Ratios and risk levels below use the last
      known price and may be out of date. Do not rely on them until this clears.
    </Callout>
  );
}
