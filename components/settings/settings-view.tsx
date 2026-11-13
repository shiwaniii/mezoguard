"use client";
import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount, usePublicClient, useSignTypedData, useWriteContract } from "wagmi";
import { toast } from "sonner";
import { Pencil, Trash2 } from "lucide-react";
import type { Address, PublicClient } from "viem";
import type { SettingsDTO, TrackedWalletDTO } from "@/lib/api-types";
import { erc20Abi } from "@/lib/chain/abis";
import { BTC_TOKEN, MEZO_TESTNET_ID, MORPHO, MUSDC_TESTNET, MUSD_PROTOCOL, PROTECTOR_ADDRESS, explorerAddress } from "@/lib/chain/config";
import { DEFAULT_THRESHOLDS } from "@/lib/risk";
import { fmtRatio, fmtUnits } from "@/lib/format";
import { api, ApiRequestError, parseAddressInput, shortAddress } from "@/lib/wallet/api";
import { protectorAbi } from "@/lib/wallet/protector-abi";
import { cancelLiveSignature, readSignatureState } from "@/lib/wallet/protector-signature";
import { humanizeError } from "@/lib/wallet/errors";
import { useSession, useSignOut } from "@/hooks/use-session";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Callout } from "@/components/ui/callout";
import { ConnectButton } from "@/components/layout/connect-wallet";
import { DbDisabledState, SignInGate } from "@/components/alerts/sign-in-gate";
import { cn } from "@/components/ui/cn";
import { useMounted } from "@/hooks/use-mounted";

const WAD = 10n ** 18n;

function ThresholdTable() {
  const rows: { label: string; liq: bigint }[] = [
    { label: "MUSD Trove", liq: 11n * 10n ** 17n },
    { label: "Morpho (77% LLTV)", liq: (WAD * WAD + 77n * 10n ** 16n - 1n) / (77n * 10n ** 16n) },
  ];
  const at = (liq: bigint, m: bigint) => fmtRatio((liq * m) / WAD);
  return (
    <div className="overflow-x-auto">
      <table className="num w-full min-w-[520px] text-sm">
        <thead className="border-b border-line text-left text-[12px] text-ink-2">
          <tr>
            <th scope="col" className="py-2 pr-3 font-medium">Loan type</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Liquidation</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Critical below</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">High risk below</th>
            <th scope="col" className="py-2 pl-3 text-right font-medium">Watch below</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row" className="py-2.5 pr-3 text-left font-medium text-ink">{r.label}</th>
              <td className="px-3 py-2.5 text-right text-ink">{fmtRatio(r.liq)}</td>
              <td className="px-3 py-2.5 text-right text-ink">{at(r.liq, DEFAULT_THRESHOLDS.critical)}</td>
              <td className="px-3 py-2.5 text-right text-ink">{at(r.liq, DEFAULT_THRESHOLDS.high)}</td>
              <td className="py-2.5 pl-3 text-right text-ink">{at(r.liq, DEFAULT_THRESHOLDS.watch)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-[13px] text-ink-2">
        Levels are set at {fmtUnits(DEFAULT_THRESHOLDS.critical, 18, 2)}×, {fmtUnits(DEFAULT_THRESHOLDS.high, 18, 2)}× and{" "}
        {fmtUnits(DEFAULT_THRESHOLDS.watch, 18, 2)}× each loan&apos;s liquidation ratio. Custom levels per alert are set in{" "}
        <Link href="/alerts" className="text-accent-ink hover:underline">Alerts</Link>.
      </p>
    </div>
  );
}

interface Approval {
  key: string;
  label: string;
  token: Address;
  spender: Address;
  spenderName: string;
  decimals: number;
  symbol: string;
}

const APPROVALS: Approval[] = [
  ...(PROTECTOR_ADDRESS
    ? [{ key: "musd-protector", label: "MUSD for automatic repay", token: MUSD_PROTOCOL.musd, spender: PROTECTOR_ADDRESS, spenderName: "MezoGuard protector", decimals: 18, symbol: "MUSD" }]
    : []),
  { key: "musd-morpho", label: "MUSD for Morpho repay", token: MUSD_PROTOCOL.musd, spender: MORPHO.morpho, spenderName: "Morpho Blue", decimals: 18, symbol: "MUSD" },
  { key: "musdc-morpho", label: "mUSDC for Morpho repay", token: MUSDC_TESTNET, spender: MORPHO.morpho, spenderName: "Morpho Blue", decimals: 6, symbol: "mUSDC" },
  { key: "btc-morpho", label: "BTC for Morpho collateral", token: BTC_TOKEN, spender: MORPHO.morpho, spenderName: "Morpho Blue", decimals: 18, symbol: "BTC" },
];

function Permissions() {
  const { address, chainId } = useAccount();
  const client = usePublicClient({ chainId: MEZO_TESTNET_ID }) as PublicClient | undefined;
  const write = useWriteContract();
  const signTyped = useSignTypedData();
  const [busy, setBusy] = React.useState<string | null>(null);
  const q = useQuery({
    queryKey: ["permissions", address],
    enabled: !!address && !!client,
    queryFn: async () => {
      const c = client!;
      const allowances = await Promise.all(
        APPROVALS.map((a) => c.readContract({ address: a.token, abi: erc20Abi, functionName: "allowance", args: [address!, a.spender] }).catch(() => 0n)),
      );
      const rule = PROTECTOR_ADDRESS
        ? await c.readContract({ address: PROTECTOR_ADDRESS, abi: protectorAbi, functionName: "ruleOf", args: [address!] }).catch(() => null)
        : null;
      return { allowances, rule };
    },
  });

  async function run(key: string, fn: () => Promise<`0x${string}`>) {
    if (!client) return;
    if (chainId !== MEZO_TESTNET_ID) {
      toast.error("Switch your wallet to Mezo Testnet first.");
      return;
    }
    setBusy(key);
    try {
      const hash = await fn();
      await client.waitForTransactionReceipt({ hash });
      toast.success("Done");
      q.refetch();
    } catch (e) {
      toast.error(humanizeError(e));
    } finally {
      setBusy(null);
    }
  }

  /** revoke() refunds the budget but cannot cancel the signed permission at Mezo, so consume its nonce too. */
  async function revokeAndCancel() {
    if (!client || !address || !PROTECTOR_ADDRESS) return;
    await run("revoke", () => write.writeContractAsync({ address: PROTECTOR_ADDRESS!, abi: protectorAbi, functionName: "revoke", args: [], chainId: MEZO_TESTNET_ID }));
    try {
      if ((await readSignatureState(client, PROTECTOR_ADDRESS, address)).live) {
        setBusy("revoke");
        await cancelLiveSignature({ client, owner: address, signTypedData: signTyped.signTypedDataAsync, write: write.writeContractAsync as never });
        toast.success("The signed repay permission is cancelled too.");
      }
    } catch (e) {
      toast.error(`The signed permission is still valid until its end date. ${humanizeError(e)}`);
    } finally {
      setBusy(null);
      q.refetch();
    }
  }

  if (!address) return <p className="text-sm text-ink-2">Connect a wallet to see what it has approved.</p>;
  if (q.isLoading) return <Skeleton className="h-24" />;
  const active = APPROVALS.map((a, i) => ({ a, v: q.data?.allowances[i] ?? 0n })).filter((x) => x.v > 0n);
  const rule = q.data?.rule;

  return (
    <div className="grid gap-5">
      <div>
        <h3 className="text-sm font-medium text-ink">Automatic repay</h3>
        {!PROTECTOR_ADDRESS ? (
          <p className="mt-1 text-sm text-ink-2">Automation contract not deployed yet.</p>
        ) : rule?.armed || (rule && rule.budget > 0n) ? (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-md border border-line p-3 text-sm">
            <p className="text-ink">
              {rule.armed ? `On: repays ${fmtUnits(rule.repayAmount, 18, 2)} MUSD below ${fmtRatio(rule.triggerIcr)}.` : "Off."} Budget{" "}
              <span className="num">{fmtUnits(rule.budget, 18, 2)} MUSD</span>.
            </p>
            <Button
              size="sm"
              variant="secondary"
              loading={busy === "revoke"}
              onClick={() => revokeAndCancel()}
            >
              Turn off and refund
            </Button>
          </div>
        ) : (
          <p className="mt-1 text-sm text-ink-2">Not set up. You can turn it on from a Trove&apos;s page.</p>
        )}
      </div>
      <div>
        <h3 className="text-sm font-medium text-ink">Token approvals</h3>
        {active.length === 0 ? (
          <p className="mt-1 text-sm text-ink-2">No open approvals to MezoGuard-related contracts.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {active.map(({ a, v }) => (
              <li key={a.key} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
                <div>
                  <p className="text-ink">{a.label}</p>
                  <p className="num text-[12px] text-ink-2">
                    {v > 10n ** 60n ? "Unlimited" : `${fmtUnits(v, a.decimals, 4)} ${a.symbol}`} to{" "}
                    <a className="text-accent-ink hover:underline" href={explorerAddress(a.spender)} target="_blank" rel="noreferrer">{a.spenderName}</a>
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={busy === a.key}
                  onClick={() => run(a.key, () => write.writeContractAsync({ address: a.token, abi: erc20Abi, functionName: "approve", args: [a.spender, 0n], chainId: MEZO_TESTNET_ID }))}
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function TrackedWallets() {
  const qc = useQueryClient();
  const wallets = useQuery({ queryKey: ["wallets"], queryFn: () => api<TrackedWalletDTO[]>("/api/wallets") });
  const [addr, setAddr] = React.useState("");
  const [label, setLabel] = React.useState("");
  const [err, setErr] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<{ id: string; label: string } | null>(null);
  const inval = () => qc.invalidateQueries({ queryKey: ["wallets"] });

  const add = useMutation({
    mutationFn: (b: { walletAddress: string; label: string | null }) => api<TrackedWalletDTO>("/api/wallets", { method: "POST", json: b }),
    onSuccess: () => {
      setAddr("");
      setLabel("");
      toast.success("Wallet added. Checks start within a minute.");
      inval();
    },
    onError: (e) => setErr(e.message),
  });
  const patch = useMutation({
    mutationFn: ({ id, ...b }: { id: string; label?: string | null; trackingStatus?: "active" | "paused" }) => api(`/api/wallets/${id}`, { method: "PATCH", json: b }),
    onSettled: inval,
    onError: (e) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/wallets/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Wallet removed");
      inval();
    },
  });

  if (wallets.error instanceof ApiRequestError && wallets.error.dbDisabled) return <DbDisabledState />;

  return (
    <div className="grid gap-5">
      {wallets.isLoading ? (
        <Skeleton className="h-16" />
      ) : (wallets.data ?? []).length === 0 ? (
        <p className="text-sm text-ink-2">No wallets tracked yet. Tracking runs the background check every minute and stores history.</p>
      ) : (
        <ul className="divide-y divide-line">
          {wallets.data!.map((w) => (
            <li key={w.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                {editing?.id === w.id ? (
                  <form
                    className="flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      patch.mutate({ id: w.id, label: editing.label.trim() || null });
                      setEditing(null);
                    }}
                  >
                    <Input aria-label="Label" className="h-8 max-w-56" value={editing.label} maxLength={64} onChange={(e) => setEditing({ id: w.id, label: e.target.value })} autoFocus />
                    <Button size="sm" type="submit">Save</Button>
                    <Button size="sm" variant="ghost" type="button" onClick={() => setEditing(null)}>Cancel</Button>
                  </form>
                ) : (
                  <p className={cn("text-sm font-medium text-ink", w.trackingStatus === "paused" && "text-ink-2")}>
                    {w.label || "Unnamed wallet"}
                    {w.trackingStatus === "paused" && <span className="ml-2 font-normal text-ink-3">paused</span>}
                  </p>
                )}
                <Link href={`/portfolio/${w.walletAddress}`} className="font-mono text-[12px] text-ink-2 hover:text-ink hover:underline">
                  <span className="sm:hidden">{shortAddress(w.walletAddress, 6)}</span>
                  <span className="hidden sm:inline">{w.walletAddress}</span>
                </Link>
              </div>
              <label className="inline-flex items-center gap-2 text-[13px] text-ink-2">
                Tracking
                <Switch
                  checked={w.trackingStatus === "active"}
                  onCheckedChange={(on) => patch.mutate({ id: w.id, trackingStatus: on ? "active" : "paused" })}
                  aria-label={w.trackingStatus === "active" ? "Pause tracking" : "Resume tracking"}
                />
              </label>
              <Button variant="ghost" size="icon" aria-label="Rename" onClick={() => setEditing({ id: w.id, label: w.label ?? "" })}>
                <Pencil aria-hidden />
              </Button>
              <Button variant="ghost" size="icon" aria-label="Remove wallet" onClick={() => remove.mutate(w.id)}>
                <Trash2 aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        noValidate
        className="grid gap-3 border-t border-line pt-5 sm:grid-cols-[1.6fr_1fr_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          const r = parseAddressInput(addr);
          if (!r.ok) {
            setErr(r.error);
            return;
          }
          setErr(null);
          add.mutate({ walletAddress: r.address, label: label.trim() || null });
        }}
      >
        <Field label="Wallet address" htmlFor="track-addr" error={err ?? undefined}>
          <Input id="track-addr" className="font-mono text-[13px]" placeholder="0x…" value={addr} onChange={(e) => setAddr(e.target.value)} aria-invalid={err ? true : undefined} />
        </Field>
        <Field label="Label (optional)" htmlFor="track-label">
          <Input id="track-label" maxLength={64} value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Button type="submit" loading={add.isPending}>Track wallet</Button>
      </form>
    </div>
  );
}

function timezones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? ["UTC"];
  } catch {
    return ["UTC"];
  }
}

function Channels() {
  const q = useQuery({ queryKey: ["settings"], queryFn: () => api<SettingsDTO>("/api/settings") });
  if (q.error instanceof ApiRequestError && q.error.dbDisabled) return <DbDisabledState />;
  if (q.error) return <Callout tone="warn">Could not load settings. {q.error.message}</Callout>;
  if (q.isLoading || !q.data) return <Skeleton className="h-40" />;
  return <ChannelsForm initial={q.data} />;
}

function ChannelsForm({ initial }: { initial: SettingsDTO }) {
  const qc = useQueryClient();
  const [form, setForm] = React.useState({ email: initial.email ?? "", telegramChatId: initial.telegramChatId ?? "", timezone: initial.timezone || "UTC" });
  const [errors, setErrors] = React.useState<{ email?: string; telegram?: string }>({});
  const save = useMutation({
    mutationFn: (b: { email: string | null; telegramChatId: string | null; timezone: string }) => api<SettingsDTO>("/api/settings", { method: "PUT", json: b }),
    onSuccess: (d) => {
      qc.setQueryData(["settings"], d);
      toast.success("Settings saved");
    },
    onError: (e) => toast.error(e.message),
  });
  const zones = React.useMemo(() => timezones(), []);
  const avail = initial.channelsAvailable;

  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const errs: typeof errors = {};
        if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errs.email = "Enter a valid email address.";
        if (form.telegramChatId && !/^-?\d{3,20}$/.test(form.telegramChatId.trim())) errs.telegram = "Chat ids are numbers, for example 123456789.";
        setErrors(errs);
        if (Object.keys(errs).length) return;
        save.mutate({ email: form.email.trim() || null, telegramChatId: form.telegramChatId.trim() || null, timezone: form.timezone });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Email"
          htmlFor="set-email"
          error={errors.email}
          hint={avail?.email === false ? "Email sending is not set up on this server yet. Alerts will show in the app." : "Alerts you route to email go here."}
        >
          <Input id="set-email" type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} aria-invalid={errors.email ? true : undefined} />
        </Field>
        <Field
          label="Telegram chat id"
          htmlFor="set-tg"
          error={errors.telegram}
          hint={avail?.telegram === false ? "Telegram is not set up on this server yet." : "Message the MezoGuard bot, then paste the chat id it replies with."}
        >
          <Input id="set-tg" inputMode="numeric" value={form.telegramChatId} onChange={(e) => setForm({ ...form, telegramChatId: e.target.value })} aria-invalid={errors.telegram ? true : undefined} />
        </Field>
      </div>
      <Field label="Time zone" htmlFor="set-tz" hint="Used for times in emails and Telegram messages." className="max-w-sm">
        <Select id="set-tz" className="h-10" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })}>
          {!zones.includes(form.timezone) && <option value={form.timezone}>{form.timezone}</option>}
          {zones.map((z) => (
            <option key={z} value={z}>{z}</option>
          ))}
        </Select>
      </Field>
      <div>
        <Button type="submit" loading={save.isPending}>Save</Button>
      </div>
    </form>
  );
}

function Account() {
  const { address, chainId, connector } = useAccount();
  const session = useSession();
  const signOut = useSignOut();
  const mounted = useMounted();
  if (!mounted) return <Skeleton className="h-12" />;
  return (
    <dl className="grid gap-4 text-sm sm:grid-cols-3">
      <div>
        <dt className="text-[13px] text-ink-2">Connected wallet</dt>
        <dd className="mt-1 font-mono text-[13px] text-ink">{address ? shortAddress(address, 6) : <ConnectButton size="sm" />}</dd>
        {connector && <dd className="text-[12px] text-ink-3">{connector.name}</dd>}
      </div>
      <div>
        <dt className="text-[13px] text-ink-2">Network</dt>
        <dd className={cn("mt-1", address && chainId !== MEZO_TESTNET_ID ? "text-warn-ink" : "text-ink")}>
          {!address ? "Not connected" : chainId === MEZO_TESTNET_ID ? "Mezo Testnet (31611)" : `Chain ${chainId}. Switch to Mezo Testnet.`}
        </dd>
      </div>
      <div>
        <dt className="text-[13px] text-ink-2">Signed in for alerts</dt>
        <dd className="mt-1 text-ink">
          {session.data?.address ? (
            <span className="inline-flex items-center gap-3">
              <span className="font-mono text-[13px]">{shortAddress(session.data.address)}</span>
              <Button size="sm" variant="ghost" onClick={() => signOut.mutate()} loading={signOut.isPending}>Sign out</Button>
            </span>
          ) : session.data?.dbEnabled === false ? (
            <span className="text-ink-2">Not available on this server</span>
          ) : (
            <Link className="text-accent-ink hover:underline" href="/alerts">Sign in</Link>
          )}
        </dd>
      </div>
    </dl>
  );
}

export function SettingsView() {
  return (
    <div className="container-page grid gap-6 py-8 md:py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Settings</h1>
      <Panel aria-labelledby="acct-h">
        <PanelHeader id="acct-h" title="Account" />
        <div className="p-4 sm:p-5"><Account /></div>
      </Panel>
      <Panel aria-labelledby="wallets-h">
        <PanelHeader id="wallets-h" title="Tracked wallets" description="Checked every minute, with alerts and history." />
        <div className="p-4 sm:p-5">
          <SignInGate what="tracked wallets" compact><TrackedWallets /></SignInGate>
        </div>
      </Panel>
      <Panel aria-labelledby="chan-h">
        <PanelHeader id="chan-h" title="Where alerts go" />
        <div className="p-4 sm:p-5">
          <SignInGate what="alert channels" compact><Channels /></SignInGate>
        </div>
      </Panel>
      <Panel aria-labelledby="thr-h">
        <PanelHeader id="thr-h" title="Risk levels" description="The same scale is used for every loan." />
        <div className="p-4 sm:p-5"><ThresholdTable /></div>
      </Panel>
      <Panel aria-labelledby="perm-h">
        <PanelHeader id="perm-h" title="Permissions you have given" description="Read from the chain. Revoking is a transaction you sign." />
        <div className="p-4 sm:p-5">
          <Callout tone="info" className="mb-5">MezoGuard itself holds no permissions. These are approvals and automation you set up on-chain.</Callout>
          <Permissions />
        </div>
      </Panel>
    </div>
  );
}
