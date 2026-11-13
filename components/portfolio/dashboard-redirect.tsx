"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { ConnectButton } from "@/components/layout/connect-wallet";
import { AddressSearch } from "@/components/layout/address-search";
import { Skeleton } from "@/components/ui/skeleton";
import { useMounted } from "@/hooks/use-mounted";

/** /dashboard → /portfolio/<connected address>; otherwise ask to connect or paste an address. */
export function DashboardRedirect() {
  const router = useRouter();
  const { address, status } = useAccount();
  const mounted = useMounted();
  React.useEffect(() => {
    if (address) router.replace(`/portfolio/${address}`);
  }, [address, router]);

  if (!mounted || address || status === "reconnecting" || status === "connecting") {
    return (
      <div className="container-page py-10" aria-busy="true">
        <Skeleton className="h-8 w-48" />
      </div>
    );
  }
  return (
    <div className="container-page max-w-xl py-16">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Connect to see your loans</h1>
      <p className="mt-2 text-[15px] text-ink-2">MezoGuard reads your loans from Mezo testnet. Connecting only shares your address.</p>
      <div className="mt-6">
        <ConnectButton />
      </div>
      <AddressSearch className="mt-10" />
    </div>
  );
}
