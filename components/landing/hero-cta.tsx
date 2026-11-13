"use client";
import * as React from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConnectButton } from "@/components/layout/connect-wallet";
import { useMounted } from "@/hooks/use-mounted";

export function HeroCta() {
  const { address } = useAccount();
  const mounted = useMounted();
  if (mounted && address) {
    return (
      <Button asChild size="lg">
        <Link href={`/portfolio/${address}`}>
          Open my portfolio <ArrowRight aria-hidden />
        </Link>
      </Button>
    );
  }
  return <ConnectButton size="lg" />;
}
