import type { Metadata } from "next";
import { PortfolioView } from "@/components/portfolio/portfolio-view";
import { parseAddressInput } from "@/lib/wallet/api";
import { AddressSearch } from "@/components/layout/address-search";

export const metadata: Metadata = { title: "Portfolio", robots: { index: false } };

export default async function PortfolioPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  const r = parseAddressInput(decodeURIComponent(address));
  if (!r.ok) {
    return (
      <div className="container-page max-w-xl py-16">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">That address does not look right</h1>
        <p className="mt-2 text-sm text-ink-2">{r.error}</p>
        <AddressSearch className="mt-8" />
      </div>
    );
  }
  return <PortfolioView address={r.address} />;
}
