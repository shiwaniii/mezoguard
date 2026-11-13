import Link from "next/link";
import { AddressSearch } from "@/components/layout/address-search";

export default function NotFound() {
  return (
    <div className="container-page max-w-xl py-20">
      <p className="num text-sm text-ink-3">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">This page does not exist</h1>
      <p className="mt-2 text-[15px] text-ink-2">The link may be wrong, or the loan it pointed to has been closed.</p>
      <div className="mt-6 flex gap-4 text-sm">
        <Link href="/" className="font-medium text-accent-ink hover:underline">Go to the home page</Link>
        <Link href="/dashboard" className="font-medium text-accent-ink hover:underline">Open my portfolio</Link>
      </div>
      <AddressSearch className="mt-10" />
    </div>
  );
}
