import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PositionView } from "@/components/position/position-view";
import { protocolFromSlug } from "@/lib/wallet/display";

export const metadata: Metadata = { title: "Loan", robots: { index: false } };

const ID_RE = /^0x[0-9a-fA-F]{40}$|^0x[0-9a-fA-F]{64}:0x[0-9a-fA-F]{40}$/;

export default async function PositionPage({ params }: { params: Promise<{ protocol: string; id: string }> }) {
  const { protocol: slug, id: raw } = await params;
  const protocol = protocolFromSlug(slug);
  const id = decodeURIComponent(raw);
  if (!protocol || !ID_RE.test(id)) notFound();
  return <PositionView protocol={protocol} id={id} />;
}
