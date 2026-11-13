/** Alert rule form schema (zod). Mirrors the server's threshold rules in lib/server/alerts.ts. */
import { z } from "zod";
import { isAddress } from "viem";
import type { AlertTriggerType } from "@/lib/api-types";

export const TRIGGERS: { value: AlertTriggerType; label: string; help: string }[] = [
  { value: "cr_below", label: "Ratio drops below", help: "Alert when the collateral ratio falls under this percent." },
  { value: "liquidation_price_within_pct", label: "Price gets close to liquidation", help: "Alert when the price is within this percent of your liquidation price." },
  { value: "btc_drop_pct", label: "BTC price falls by", help: "Alert when BTC falls this much from when the rule was created." },
  { value: "level_at_least", label: "Risk level reaches", help: "Alert when a loan reaches this level or worse." },
  { value: "redemption", label: "Redemption exposure reaches", help: "Troves only. Alert when your place in the redemption queue gets risky." },
];

export const CHANNELS = [
  { value: "in_app", label: "In the app" },
  { value: "email", label: "Email" },
  { value: "telegram", label: "Telegram" },
  { value: "browser", label: "Browser notification" },
] as const;

const pct = (s: string) => Number(s.replace(/,/g, "").trim());

export const alertRuleSchema = z
  .object({
    walletAddress: z.string().trim().refine((v): boolean => isAddress(v), "Enter a valid wallet address."),
    positionId: z.string(),
    triggerType: z.enum(["cr_below", "btc_drop_pct", "level_at_least", "redemption", "liquidation_price_within_pct"]),
    threshold: z.string().trim().min(1, "Enter a value."),
    channels: z.array(z.enum(["in_app", "email", "telegram", "browser"])).min(1, "Pick at least one place to send alerts."),
    cooldownMinutes: z.number({ message: "Enter minutes." }).int("Whole minutes only.").min(1, "At least 1 minute.").max(10080, "At most 7 days (10080 minutes)."),
  })
  .superRefine((v, ctx) => {
    const n = pct(v.threshold);
    const bad = (message: string) => ctx.addIssue({ code: "custom", path: ["threshold"], message });
    switch (v.triggerType) {
      case "cr_below":
        if (!Number.isFinite(n) || n <= 100 || n > 10000) bad("Use a percent above 100, for example 150.");
        break;
      case "btc_drop_pct":
      case "liquidation_price_within_pct":
        if (!Number.isFinite(n) || n <= 0 || n >= 100) bad("Use a percent between 0 and 100, for example 10.");
        break;
      case "level_at_least":
        if (!["watch", "high", "critical", "liquidatable"].includes(v.threshold)) bad("Pick a risk level.");
        break;
      case "redemption":
        if (!["moderate", "high"].includes(v.threshold)) bad("Pick moderate or high.");
        break;
    }
  });

export type AlertRuleForm = z.infer<typeof alertRuleSchema>;

export function defaultThreshold(t: AlertTriggerType): string {
  switch (t) {
    case "cr_below":
      return "150";
    case "btc_drop_pct":
      return "10";
    case "liquidation_price_within_pct":
      return "15";
    case "level_at_least":
      return "high";
    case "redemption":
      return "high";
  }
}

export function describeRule(t: AlertTriggerType, threshold: string): string {
  switch (t) {
    case "cr_below":
      return `Ratio drops below ${threshold}%`;
    case "btc_drop_pct":
      return `BTC falls ${threshold}% or more`;
    case "liquidation_price_within_pct":
      return `Price within ${threshold}% of liquidation`;
    case "level_at_least":
      return `Risk reaches ${threshold === "high" ? "high risk" : threshold} or worse`;
    case "redemption":
      return `Redemption exposure is ${threshold} or worse`;
  }
}
