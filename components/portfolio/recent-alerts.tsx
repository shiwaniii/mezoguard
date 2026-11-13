"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { NotificationDTO } from "@/lib/api-types";
import { api, ApiRequestError } from "@/lib/wallet/api";
import { relativeTime } from "@/lib/wallet/display";
import { useSession } from "@/hooks/use-session";
import { useNow } from "@/hooks/use-now";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/components/ui/cn";

const DOT = { critical: "bg-risk-critical", high: "bg-risk-high", watch: "bg-risk-watch", info: "bg-ink-3" } as const;

export function RecentAlerts({ owner }: { owner: string }) {
  const session = useSession();
  const now = useNow(30_000);
  const signedIn = !!session.data?.address;
  const q = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api<NotificationDTO[]>("/api/notifications"),
    enabled: signedIn,
    refetchInterval: 30_000,
  });
  if (session.data?.dbEnabled === false) {
    return <p className="text-sm text-ink-2">Alerts need the server database, which is not set up on this server.</p>;
  }
  if (!signedIn) {
    return (
      <p className="text-sm text-ink-2">
        <Link href="/alerts" className="font-medium text-accent-ink hover:underline">Sign in</Link> to set alerts and see them here.
      </p>
    );
  }
  if (q.isLoading) return <Skeleton className="h-16" />;
  if (q.error) return <p className="text-sm text-ink-2">{q.error instanceof ApiRequestError && q.error.dbDisabled ? "Alerts need the server database." : "Could not load alerts."}</p>;
  const items = (q.data ?? []).filter((n) => n.payload?.wallet?.toLowerCase() === owner.toLowerCase()).slice(0, 5);
  if (items.length === 0) return <p className="text-sm text-ink-2">No alerts for this wallet yet.</p>;
  return (
    <ul className="grid gap-3">
      {items.map((n) => (
        <li key={n.id} className="flex gap-2.5">
          <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", DOT[n.severity], n.readAt && "opacity-40")} />
          <div className="min-w-0">
            <p className={cn("text-sm text-ink", !n.readAt && "font-medium")}>{n.message}</p>
            <p className="text-[12px] text-ink-3">{relativeTime(Date.parse(n.createdAt), now)}</p>
          </div>
        </li>
      ))}
      <li>
        <Link href="/alerts" className="text-[13px] font-medium text-accent-ink hover:underline">All alerts</Link>
      </li>
    </ul>
  );
}
