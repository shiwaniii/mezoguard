import { cn } from "@/components/ui/cn";

/** Wordmark + gauge mark (same geometry as app/icon.svg). */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-[-0.01em] text-ink", className)}>
      <svg viewBox="0 0 32 32" aria-hidden className="size-6 shrink-0">
        <rect width="32" height="32" rx="8" fill="currentColor" />
        <path d="M8 20a8 8 0 0 1 16 0" fill="none" stroke="var(--bg)" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M16 20l4.5-5" stroke="var(--bg)" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="16" cy="20" r="1.9" fill="var(--bg)" />
      </svg>
      <span>MezoGuard</span>
    </span>
  );
}
