// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { alertRuleSchema } from "@/lib/wallet/alert-schema";
import { cleanup, render, submit, typeInto, waitFor } from "./helpers";
import { OWNER } from "./fixtures";
import { RuleForm } from "@/components/alerts/rule-form";

afterEach(cleanup);

const base = { walletAddress: OWNER, positionId: "", triggerType: "cr_below" as const, threshold: "150", channels: ["in_app" as const], cooldownMinutes: 60 };

describe("alertRuleSchema", () => {
  it("accepts a valid rule", () => {
    expect(alertRuleSchema.safeParse(base).success).toBe(true);
  });
  it("validates thresholds per trigger type", () => {
    const err = (v: object) => {
      const r = alertRuleSchema.safeParse({ ...base, ...v });
      return r.success ? null : r.error.issues[0].message;
    };
    expect(err({ threshold: "90" })).toContain("above 100");
    expect(err({ triggerType: "btc_drop_pct", threshold: "150" })).toContain("between 0 and 100");
    expect(err({ triggerType: "liquidation_price_within_pct", threshold: "12" })).toBeNull();
    expect(err({ triggerType: "level_at_least", threshold: "healthy" })).toBe("Pick a risk level.");
    expect(err({ triggerType: "redemption", threshold: "low" })).toBe("Pick moderate or high.");
    expect(err({ walletAddress: "0x123" })).toBe("Enter a valid wallet address.");
    expect(err({ channels: [] })).toContain("at least one");
    expect(err({ cooldownMinutes: 0 })).toContain("At least 1");
  });
});

describe("<RuleForm>", () => {
  it("shows the field error and does not submit an invalid threshold", async () => {
    const onSubmit = vi.fn(async () => undefined);
    const r = render(<RuleForm defaultWallet={OWNER} wallets={[OWNER]} positions={[]} onSubmit={onSubmit} />, { query: false });
    typeInto(r.container.querySelector<HTMLInputElement>("#rule-threshold")!, "95");
    await submit(r.container.querySelector("form")!);
    await waitFor(() => r.text().includes("Use a percent above 100"));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits a normalised rule", async () => {
    const onSubmit = vi.fn(async () => undefined);
    const r = render(<RuleForm defaultWallet={OWNER} wallets={[OWNER]} positions={[]} onSubmit={onSubmit} />, { query: false });
    typeInto(r.container.querySelector<HTMLInputElement>("#rule-threshold")!, "1,75");
    typeInto(r.container.querySelector<HTMLInputElement>("#rule-threshold")!, "175");
    await submit(r.container.querySelector("form")!);
    await waitFor(() => onSubmit.mock.calls.length > 0);
    expect(onSubmit).toHaveBeenCalledWith({
      walletAddress: OWNER, positionId: null, triggerType: "cr_below", threshold: "175", channels: ["in_app"], cooldownMinutes: 60,
    });
  });
});
