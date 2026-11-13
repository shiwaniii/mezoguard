"use client";
import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Check, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { AlertRuleDTO, NotificationDTO, SettingsDTO, TrackedWalletDTO } from "@/lib/api-types";
import { api, ApiRequestError } from "@/lib/wallet/api";
import { describeRule } from "@/lib/wallet/alert-schema";
import { relativeTime, positionHref } from "@/lib/wallet/display";
import { useSession } from "@/hooks/use-session";
import { usePortfolio } from "@/hooks/use-portfolio";
import { useNow } from "@/hooks/use-now";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Callout } from "@/components/ui/callout";
import { cn } from "@/components/ui/cn";
import { DbDisabledState, SignInGate } from "./sign-in-gate";
import { RuleForm } from "./rule-form";
import { BROWSER_OPT_IN_KEY } from "./notification-poller";

type Tab = "critical" | "high" | "watch" | "info" | "resolved";
const TABS: { id: Tab; label: string }[] = [
  { id: "critical", label: "Critical" },
  { id: "high", label: "High" },
  { id: "watch", label: "Watch" },
  { id: "info", label: "Info" },
  { id: "resolved", label: "Resolved" },
];

const SEV_DOT: Record<NotificationDTO["severity"], string> = {
  critical: "bg-risk-critical",
  high: "bg-risk-high",
  watch: "bg-risk-watch",
  info: "bg-ink-3",
};

export function tabOf(n: NotificationDTO): Tab {
  return n.resolvedAt ? "resolved" : n.severity;
}

export function NotificationList({
  items,
  onRead,
  now,
}: {
  items: NotificationDTO[];
  onRead: (id: string) => void;
  now: number;
}) {
  if (items.length === 0) return <p className="px-1 py-10 text-center text-sm text-ink-2">Nothing here.</p>;
  return (
    <ul className="divide-y divide-line">
      {items.map((n) => {
        const unread = !n.readAt;
        const href = n.payload?.positionId && n.payload?.protocol ? positionHref(n.payload.protocol, n.payload.positionId) : null;
        return (
          <li key={n.id} className={cn("flex gap-3 py-4", unread && "")} data-unread={unread || undefined}>
            <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", SEV_DOT[n.severity], !unread && "opacity-40")} />
            <div className="min-w-0 flex-1">
              <p className={cn("text-sm text-ink", unread && "font-medium")}>
                {unread && <span className="sr-only">Unread. </span>}
                {n.message}
              </p>
              {n.recommendedAction && <p className="mt-1 text-[13px] text-ink-2">{n.recommendedAction}</p>}
              <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-3">
                <time dateTime={n.createdAt}>{relativeTime(Date.parse(n.createdAt), now)}</time>
                {href && (
                  <Link href={href} className="text-accent-ink hover:underline">
                    Open loan
                  </Link>
                )}
                {n.deliveries?.map((d) => (
                  <span key={d.channel} title={d.error}>
                    {d.channel.replace("_", "-")}: {d.status === "sent" ? "sent" : d.status === "skipped" ? "not sent (not set up)" : "failed"}
                  </span>
                ))}
              </p>
            </div>
            {unread && (
              <Button variant="ghost" size="sm" onClick={() => onRead(n.id)} aria-label="Mark as read">
                <Check aria-hidden /> <span className="hidden sm:inline">Mark read</span>
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function BrowserNotifyToggle() {
  const supported = typeof window !== "undefined" && "Notification" in window;
  const [on, setOn] = React.useState(() => {
    try {
      return supported && localStorage.getItem(BROWSER_OPT_IN_KEY) === "1" && Notification.permission === "granted";
    } catch {
      return false;
    }
  });
  const [denied, setDenied] = React.useState(() => supported && Notification.permission === "denied");
  async function change(v: boolean) {
    if (!supported) return;
    if (v) {
      const perm = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
      if (perm !== "granted") {
        setDenied(perm === "denied");
        toast.error("Your browser blocked notifications for this site.");
        return;
      }
    }
    try {
      localStorage.setItem(BROWSER_OPT_IN_KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
    setOn(v);
  }
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <label htmlFor="browser-notify" className="text-sm font-medium text-ink">
          Browser notifications
        </label>
        <p className="mt-0.5 text-[13px] text-ink-2">
          {!supported
            ? "This browser does not support notifications."
            : denied
              ? "Blocked in your browser settings. Allow notifications for this site to turn them on."
              : "Checks every 30 seconds while MezoGuard is open in a tab."}
        </p>
      </div>
      <Switch id="browser-notify" checked={on} onCheckedChange={change} disabled={!supported || denied} />
    </div>
  );
}

function AlertsInner() {
  const qc = useQueryClient();
  const now = useNow(15_000);
  const session = useSession();
  const me = session.data?.address ?? "";
  const notifications = useQuery({ queryKey: ["notifications"], queryFn: () => api<NotificationDTO[]>("/api/notifications"), refetchInterval: 30_000 });
  const rules = useQuery({ queryKey: ["rules"], queryFn: () => api<AlertRuleDTO[]>("/api/alerts/rules") });
  const wallets = useQuery({ queryKey: ["wallets"], queryFn: () => api<TrackedWalletDTO[]>("/api/wallets") });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api<SettingsDTO>("/api/settings") });
  const portfolio = usePortfolio(me || undefined);

  const markRead = useMutation({
    mutationFn: (id: string) => api(`/api/notifications/${id}/read`, { method: "POST" }),
    onMutate: async (id) => {
      qc.setQueryData<NotificationDTO[]>(["notifications"], (old) => old?.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)));
    },
    onError: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
  const createRule = useMutation({
    mutationFn: (body: unknown) => api<AlertRuleDTO>("/api/alerts/rules", { method: "POST", json: body }),
    onSuccess: () => {
      toast.success("Alert created");
      qc.invalidateQueries({ queryKey: ["rules"] });
    },
  });
  const toggleRule = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => api(`/api/alerts/rules/${id}`, { method: "PATCH", json: { enabled } }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["rules"] }),
  });
  const deleteRule = useMutation({
    mutationFn: (id: string) => api(`/api/alerts/rules/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Alert removed");
      qc.invalidateQueries({ queryKey: ["rules"] });
    },
  });

  const dbErr = [notifications.error, rules.error].find((e) => e instanceof ApiRequestError && e.dbDisabled);
  if (dbErr) return <DbDisabledState />;

  const list = notifications.data ?? [];
  const counts = Object.fromEntries(TABS.map((t) => [t.id, list.filter((n) => tabOf(n) === t.id && (t.id === "resolved" || !n.readAt)).length])) as Record<Tab, number>;
  const firstTab = (TABS.find((t) => t.id !== "resolved" && counts[t.id] > 0)?.id ?? "critical") as Tab;
  const unread = list.filter((n) => !n.readAt);
  const walletOptions = [...new Set([me, ...(wallets.data ?? []).map((w) => w.walletAddress)].filter(Boolean))];

  return (
    <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr] lg:items-start">
      <Panel aria-labelledby="inbox-h">
        <PanelHeader
          id="inbox-h"
          title="Notifications"
          description={unread.length > 0 ? `${unread.length} unread` : "You are all caught up."}
          action={
            unread.length > 0 && (
              <Button variant="secondary" size="sm" onClick={() => unread.forEach((n) => markRead.mutate(n.id))}>
                Mark all read
              </Button>
            )
          }
        />
        <div className="px-4 pb-2 pt-3 sm:px-5">
          {notifications.isLoading ? (
            <div className="grid gap-3 py-4">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : notifications.error ? (
            <Callout tone="warn">Could not load notifications. {notifications.error.message}</Callout>
          ) : (
            <Tabs defaultValue={firstTab} key={firstTab}>
              <TabsList aria-label="Notification severity">
                {TABS.map((t) => (
                  <TabsTrigger key={t.id} value={t.id}>
                    {t.label}
                    {counts[t.id] > 0 && <span className="num rounded bg-surface-2 px-1.5 text-[11px] text-ink-2">{counts[t.id]}</span>}
                  </TabsTrigger>
                ))}
              </TabsList>
              {TABS.map((t) => (
                <TabsContent key={t.id} value={t.id}>
                  <NotificationList items={list.filter((n) => tabOf(n) === t.id)} onRead={(id) => markRead.mutate(id)} now={now} />
                </TabsContent>
              ))}
            </Tabs>
          )}
        </div>
      </Panel>

      <div className="grid gap-6">
        <Panel aria-labelledby="new-rule-h">
          <PanelHeader id="new-rule-h" title="New alert" description="Checked every minute by the MezoGuard monitor." />
          <div className="p-4 sm:p-5">
            <RuleForm
              defaultWallet={me}
              wallets={walletOptions}
              positions={portfolio.data?.positions ?? []}
              channelsAvailable={settings.data?.channelsAvailable}
              onSubmit={(v) => createRule.mutateAsync(v)}
            />
          </div>
        </Panel>

        <Panel aria-labelledby="rules-h">
          <PanelHeader id="rules-h" title="Your alerts" />
          <div className="p-4 sm:p-5">
            {rules.isLoading ? (
              <Skeleton className="h-16" />
            ) : (rules.data ?? []).length === 0 ? (
              <p className="text-sm text-ink-2">No alerts yet. Create one above.</p>
            ) : (
              <ul className="divide-y divide-line">
                {rules.data!.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className={cn("text-sm text-ink", !r.enabled && "text-ink-2")}>{describeRule(r.triggerType, r.threshold)}</p>
                      <p className="mt-0.5 truncate text-[12px] text-ink-3">
                        {r.positionId ? "One loan" : "Every loan"} · {r.channels.map((c) => c.replace("_", "-")).join(", ")}
                      </p>
                    </div>
                    <Switch
                      checked={r.enabled}
                      aria-label={r.enabled ? "Pause alert" : "Resume alert"}
                      onCheckedChange={(enabled) => toggleRule.mutate({ id: r.id, enabled })}
                    />
                    <Button variant="ghost" size="icon" aria-label="Delete alert" onClick={() => deleteRule.mutate(r.id)}>
                      <Trash2 aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Panel>

        <Panel aria-label="Browser notifications">
          <div className="p-4 sm:p-5">
            <BrowserNotifyToggle />
          </div>
        </Panel>
      </div>
    </div>
  );
}

export function AlertsView() {
  return (
    <div className="container-page py-8 md:py-10">
      <div className="mb-6 flex items-center gap-3">
        <BellRing aria-hidden className="size-5 text-ink-2" />
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Alerts</h1>
      </div>
      <SignInGate what="alerts">
        <AlertsInner />
      </SignInGate>
    </div>
  );
}
