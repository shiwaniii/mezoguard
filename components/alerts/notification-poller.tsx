"use client";
import * as React from "react";
import type { NotificationDTO } from "@/lib/api-types";
import { api } from "@/lib/wallet/api";
import { useSession } from "@/hooks/use-session";

export const BROWSER_OPT_IN_KEY = "mezoguard.browser-notifications";
const SEEN_KEY = "mezoguard.seen-notifications";

function readSeen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}
function writeSeen(s: Set<string>) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...s].slice(-200)));
  } catch {
    /* storage unavailable */
  }
}
export function browserOptedIn(): boolean {
  try {
    return localStorage.getItem(BROWSER_OPT_IN_KEY) === "1" && typeof Notification !== "undefined" && Notification.permission === "granted";
  } catch {
    return false;
  }
}

/**
 * When the user opted into browser notifications (and is signed in), poll unread notifications every 30 s and show a
 * system notification for each one not seen before. Renders nothing.
 */
export function NotificationPoller() {
  const session = useSession();
  const signedIn = !!session.data?.address && session.data.dbEnabled;

  React.useEffect(() => {
    if (!signedIn) return;
    let stopped = false;
    async function tick() {
      if (stopped || !browserOptedIn()) return;
      try {
        const list = await api<NotificationDTO[]>("/api/notifications?unread=1");
        const seen = readSeen();
        for (const n of list) {
          if (seen.has(n.id)) continue;
          seen.add(n.id);
          const note = new Notification(n.severity === "critical" ? "Loan at risk" : "MezoGuard alert", {
            body: n.recommendedAction ? `${n.message}\n${n.recommendedAction}` : n.message,
            tag: n.id,
          });
          note.onclick = () => {
            window.focus();
            window.location.href = n.payload?.link?.startsWith("/") ? n.payload.link : "/alerts";
          };
        }
        writeSeen(seen);
      } catch {
        /* polling is best-effort */
      }
    }
    tick();
    const t = setInterval(tick, 30_000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [signedIn]);

  return null;
}
