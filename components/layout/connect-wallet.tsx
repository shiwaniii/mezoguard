"use client";
import * as React from "react";
import Link from "next/link";
import { useAccount, useDisconnect, useSwitchChain } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { ChevronDown, LogOut, LayoutDashboard, Copy } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { toast } from "sonner";
import { Button, type ButtonProps } from "@/components/ui/button";
import { MEZO_TESTNET_ID } from "@/lib/chain/config";
import { shortAddress } from "@/lib/wallet/api";
import { humanizeError } from "@/lib/wallet/errors";
import { useMounted } from "@/hooks/use-mounted";

/** Opens the Mezo Passport wallet picker: Bitcoin wallets (via a Mezo smart account) and Ethereum wallets. */
export function ConnectButton({ label = "Connect wallet", ...props }: { label?: string } & ButtonProps) {
  const { openConnectModal } = useConnectModal();
  return (
    <Button onClick={() => openConnectModal?.()} disabled={!openConnectModal} {...props}>
      {label}
    </Button>
  );
}

export function WalletMenu() {
  const { address, status, chainId } = useAccount();
  const disconnect = useDisconnect();
  const switchChain = useSwitchChain();
  const mounted = useMounted();

  if (!mounted || status === "reconnecting" || status === "connecting") {
    return <div className="h-9 w-32 rounded-md bg-surface-2" aria-hidden />;
  }
  if (!address) return <ConnectButton size="sm" className="h-9" />;

  const wrongChain = chainId !== MEZO_TESTNET_ID;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-line-strong bg-raised px-3 text-sm font-medium text-ink shadow-sm hover:bg-surface"
        >
          {wrongChain && <span className="size-2 rounded-full bg-risk-watch" aria-hidden />}
          <span className="font-mono text-[13px]">{shortAddress(address)}</span>
          <ChevronDown aria-hidden className="size-3.5 text-ink-3" />
          {wrongChain && <span className="sr-only">(wrong network)</span>}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-[var(--z-modal)] min-w-56 rounded-lg border border-line bg-raised p-1 text-sm shadow-md data-[state=open]:animate-in data-[state=open]:fade-in-0"
        >
          {wrongChain && (
            <DropdownMenu.Item
              onSelect={() =>
                switchChain.switchChainAsync({ chainId: MEZO_TESTNET_ID }).catch((e) => toast.error(humanizeError(e)))
              }
              className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-warn-ink outline-none data-[highlighted]:bg-surface-2"
            >
              Switch to Mezo Testnet
            </DropdownMenu.Item>
          )}
          <DropdownMenu.Item asChild className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 outline-none data-[highlighted]:bg-surface-2">
            <Link href={`/portfolio/${address}`}>
              <LayoutDashboard aria-hidden className="size-4 text-ink-2" /> My portfolio
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={() => {
              navigator.clipboard?.writeText(address).then(() => toast.success("Address copied"));
            }}
            className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 outline-none data-[highlighted]:bg-surface-2"
          >
            <Copy aria-hidden className="size-4 text-ink-2" /> Copy address
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <DropdownMenu.Item
            onSelect={() => disconnect.disconnect()}
            className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 outline-none data-[highlighted]:bg-surface-2"
          >
            <LogOut aria-hidden className="size-4 text-ink-2" /> Disconnect
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
