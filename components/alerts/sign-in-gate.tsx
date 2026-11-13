"use client";
import * as React from "react";
import { useAccount } from "wagmi";
import { Database, PenLine } from "lucide-react";
import { useSession, useSignIn } from "@/hooks/use-session";
import { Button } from "@/components/ui/button";
import { ConnectButton } from "@/components/layout/connect-wallet";
import { Skeleton } from "@/components/ui/skeleton";
import { humanizeError } from "@/lib/wallet/errors";
import { ApiRequestError, shortAddress } from "@/lib/wallet/api";
import { useMounted } from "@/hooks/use-mounted";

export function DbDisabledState() {
  return (
    <div className="mx-auto max-w-lg py-16 text-center" data-testid="db-disabled">
      <Database aria-hidden className="mx-auto size-6 text-ink-3" />
      <h2 className="mt-4 text-lg font-semibold text-ink">Alerts need the server database</h2>
      <p className="mt-2 text-sm text-ink-2">
        This MezoGuard server is running without a database, so it cannot save alert rules, tracked wallets or settings.
        Portfolio views, the simulator and protective actions still work.
      </p>
    </div>
  );
}

/**
 * Renders children only for a signed-in session (EIP-191). Handles: loading, DB disabled (503 DB_DISABLED),
 * not connected, connected but not signed in, and signed in as a different address than the wallet.
 */
export function SignInGate({ children, what, compact }: { children: React.ReactNode; what: string; compact?: boolean }) {
  const session = useSession();
  const { address } = useAccount();
  const signIn = useSignIn();
  const mounted = useMounted();

  if (!mounted || session.isLoading) {
    return (
      <div className="grid gap-3 py-8" aria-busy="true">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  const err = session.error;
  if (session.data?.dbEnabled === false || (err instanceof ApiRequestError && err.dbDisabled)) {
    return compact ? (
      <p className="text-sm text-ink-2" data-testid="db-disabled">This needs the server database, which is not set up on this server.</p>
    ) : (
      <DbDisabledState />
    );
  }
  if (session.data?.address) return <>{children}</>;

  if (compact) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-2">Sign in with your wallet to manage {what}. It is a free signature, not a transaction.</p>
        {address ? (
          <Button size="sm" variant="secondary" onClick={() => signIn.mutate()} loading={signIn.isPending}>
            Sign in
          </Button>
        ) : (
          <ConnectButton size="sm" variant="secondary" />
        )}
        {signIn.error && (
          <p role="alert" className="w-full text-[13px] text-danger-ink">
            {humanizeError(signIn.error)}
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <PenLine aria-hidden className="mx-auto size-6 text-ink-3" />
      <h2 className="mt-4 text-lg font-semibold text-ink">Sign in to manage {what}</h2>
      <p className="mt-2 text-sm text-ink-2">
        Signing a short message proves you own this wallet. It is free, sends no transaction and gives MezoGuard no access to your funds.
      </p>
      <div className="mt-6 flex flex-col items-center gap-3">
        {address ? (
          <Button onClick={() => signIn.mutate()} loading={signIn.isPending}>
            Sign in as {shortAddress(address)}
          </Button>
        ) : (
          <ConnectButton />
        )}
        {signIn.error && (
          <p role="alert" className="text-[13px] text-danger-ink">
            {signIn.error instanceof ApiRequestError && signIn.error.dbDisabled ? "Alerts need the server database." : humanizeError(signIn.error)}
          </p>
        )}
      </div>
    </div>
  );
}
