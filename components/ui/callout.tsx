import * as React from "react";
import { AlertTriangle, Info, OctagonAlert } from "lucide-react";
import { cn } from "./cn";

const tones = {
  info: { box: "border-line bg-surface text-ink", icon: Info, iconCls: "text-ink-2" },
  warn: { box: "border-warn-line bg-warn-bg text-warn-ink", icon: AlertTriangle, iconCls: "text-warn-ink" },
  danger: { box: "border-danger-line bg-danger-bg text-danger-ink", icon: OctagonAlert, iconCls: "text-danger-ink" },
} as const;

export function Callout({
  tone = "info",
  title,
  children,
  action,
  className,
  role,
}: {
  tone?: keyof typeof tones;
  title?: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  role?: "alert" | "status";
}) {
  const t = tones[tone];
  const Icon = t.icon;
  return (
    <div role={role} className={cn("flex gap-3 rounded-lg border px-4 py-3 text-sm", t.box, className)}>
      <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", t.iconCls)} />
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cn(title && "mt-0.5", "opacity-95")}>{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}
