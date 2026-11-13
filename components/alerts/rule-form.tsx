"use client";
import * as React from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { AlertRuleDTO, AlertTriggerType } from "@/lib/api-types";
import type { Position } from "@/lib/risk/types";
import { CHANNELS, TRIGGERS, alertRuleSchema, defaultThreshold, type AlertRuleForm } from "@/lib/wallet/alert-schema";
import { positionName } from "@/lib/wallet/positions";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";

export interface RuleFormProps {
  defaultWallet: string;
  wallets: string[];
  positions: Position[];
  channelsAvailable?: { email: boolean; telegram: boolean };
  onSubmit: (v: Omit<AlertRuleDTO, "id" | "createdAt" | "enabled"> & { positionId: string | null }) => Promise<unknown>;
}

export function RuleForm({ defaultWallet, wallets, positions, channelsAvailable, onSubmit }: RuleFormProps) {
  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<AlertRuleForm>({
    resolver: zodResolver(alertRuleSchema),
    mode: "onTouched",
    defaultValues: { walletAddress: defaultWallet, positionId: "", triggerType: "cr_below", threshold: "150", channels: ["in_app"], cooldownMinutes: 60 },
  });
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const trigger = watch("triggerType");
  const wallet = watch("walletAddress");
  const help = TRIGGERS.find((t) => t.value === trigger)?.help;
  const walletPositions = positions.filter((p) => p.owner.toLowerCase() === wallet?.toLowerCase());

  const submit = handleSubmit(async (v) => {
    setSubmitError(null);
    try {
      await onSubmit({
        walletAddress: v.walletAddress,
        positionId: v.positionId || null,
        triggerType: v.triggerType,
        threshold: v.threshold.replace(/,/g, "").trim(),
        channels: v.channels,
        cooldownMinutes: v.cooldownMinutes,
      });
      reset({ ...v, threshold: defaultThreshold(v.triggerType) });
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Could not save the rule.");
    }
  });

  return (
    <form onSubmit={submit} noValidate className="grid gap-4" aria-label="New alert rule">
      <Field label="Wallet" htmlFor="rule-wallet" error={errors.walletAddress?.message}>
        {wallets.length > 1 ? (
          <Select id="rule-wallet" className="h-10 font-mono text-[13px]" {...register("walletAddress")}>
            {wallets.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </Select>
        ) : (
          <Input id="rule-wallet" className="font-mono text-[13px]" aria-invalid={errors.walletAddress ? true : undefined} {...register("walletAddress")} />
        )}
      </Field>

      <Field label="Loan" htmlFor="rule-position" hint={walletPositions.length === 0 ? "Applies to every loan in this wallet." : undefined}>
        <Select id="rule-position" className="h-10" {...register("positionId")}>
          <option value="">Every loan in this wallet</option>
          {walletPositions.map((p) => (
            <option key={p.positionId} value={p.positionId}>
              {positionName(p)}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid gap-4 sm:grid-cols-[1.4fr_1fr]">
        <Field label="Alert me when" htmlFor="rule-trigger" hint={help}>
          <Select
            id="rule-trigger"
            className="h-10"
            {...register("triggerType", {
              onChange: (e) => setValue("threshold", defaultThreshold(e.target.value as AlertTriggerType), { shouldValidate: false }),
            })}
          >
            {TRIGGERS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Value" htmlFor="rule-threshold" error={errors.threshold?.message}>
          {trigger === "level_at_least" ? (
            <Select id="rule-threshold" className="h-10" {...register("threshold")}>
              <option value="watch">Watch</option>
              <option value="high">High risk</option>
              <option value="critical">Critical</option>
              <option value="liquidatable">Liquidatable</option>
            </Select>
          ) : trigger === "redemption" ? (
            <Select id="rule-threshold" className="h-10" {...register("threshold")}>
              <option value="moderate">Moderate</option>
              <option value="high">High</option>
            </Select>
          ) : (
            <div className="relative">
              <Input
                id="rule-threshold"
                inputMode="decimal"
                className="num pr-8"
                aria-invalid={errors.threshold ? true : undefined}
                aria-describedby={errors.threshold ? "rule-threshold-error" : undefined}
                {...register("threshold")}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink-2">%</span>
            </div>
          )}
        </Field>
      </div>

      <fieldset className="grid gap-2">
        <legend className="mb-1.5 text-sm font-medium text-ink">Send to</legend>
        <Controller
          control={control}
          name="channels"
          render={({ field }) => (
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {CHANNELS.map((c) => {
                const unavailable = (c.value === "email" && channelsAvailable?.email === false) || (c.value === "telegram" && channelsAvailable?.telegram === false);
                return (
                  <label key={c.value} className="inline-flex cursor-pointer items-center gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--accent)]"
                      checked={field.value.includes(c.value)}
                      onChange={(e) => field.onChange(e.target.checked ? [...field.value, c.value] : field.value.filter((x) => x !== c.value))}
                    />
                    {c.label}
                    {unavailable && <span className="text-[12px] text-ink-3">(not set up)</span>}
                  </label>
                );
              })}
            </div>
          )}
        />
        {errors.channels && (
          <p role="alert" className="text-[13px] text-danger-ink">
            {errors.channels.message}
          </p>
        )}
      </fieldset>

      <Field label="Wait between repeats" htmlFor="rule-cooldown" hint="Minutes before the same alert can fire again." error={errors.cooldownMinutes?.message} className="max-w-[12rem]">
        <Input id="rule-cooldown" type="number" min={1} max={10080} className="num" {...register("cooldownMinutes", { valueAsNumber: true })} />
      </Field>

      {submitError && (
        <p role="alert" className="text-[13px] text-danger-ink">
          {submitError}
        </p>
      )}
      <div>
        <Button type="submit" loading={isSubmitting}>
          Create alert
        </Button>
      </div>
    </form>
  );
}
