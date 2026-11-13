"use client";
import * as React from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { toast } from "sonner";
import { Callout } from "@/components/ui/callout";
import { Button } from "@/components/ui/button";
import { ConnectButton } from "@/components/layout/connect-wallet";
import { MEZO_TESTNET_ID } from "@/lib/chain/config";
import { checkTxGuards } from "@/lib/wallet/guards";
import { humanizeError } from "@/lib/wallet/errors";
import { shortAddress } from "@/lib/wallet/api";

/**
 * Renders the blocking problem (not connected / wrong network / wrong account) with the fix, or nothing.
 * Wallets that don't know Mezo get an "add network" prompt automatically (wagmi passes the chain definition).
 */
export function TxGuard({ owner, onOk }: { owner: string; onOk?: (ok: boolean) => void }) {
  const { address, chainId } = useAccount();
  const switchChain = useSwitchChain();
  const g = checkTxGuards({ account: address, chainId, owner });
  React.useEffect(() => onOk?.(g.ok), [g.ok, onOk]);
  if (g.ok) return null;
  if (g.problem === "not-connected") {
    return <Callout tone="info" title="Connect to continue" action={<ConnectButton size="sm" />}>{g.message}</Callout>;
  }
  if (g.problem === "wrong-network") {
    return (
      <Callout
        tone="warn"
        title="Wrong network"
        role="alert"
        action={
          <Button
            size="sm"
            variant="secondary"
            loading={switchChain.isPending}
            onClick={() => switchChain.switchChainAsync({ chainId: MEZO_TESTNET_ID }).catch((e) => toast.error(humanizeError(e)))}
          >
            Switch network
          </Button>
        }
      >
        {g.message}
      </Callout>
    );
  }
  return (
    <Callout tone="warn" title="Different wallet" role="alert">
      {g.message} Owner: <span className="font-mono">{shortAddress(owner)}</span>.
    </Callout>
  );
}
