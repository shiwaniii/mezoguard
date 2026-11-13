"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount } from "wagmi";
import { Menu, X } from "lucide-react";
import { Logo } from "./logo";
import { ThemeToggle } from "./theme-toggle";
import { WalletMenu } from "./connect-wallet";
import { cn } from "@/components/ui/cn";

export function SiteHeader() {
  const pathname = usePathname();
  const { address } = useAccount();
  // The menu belongs to the page it was opened on, so navigating closes it without an effect.
  const [openOn, setOpenOn] = React.useState<string | null>(null);
  const open = openOn !== null && openOn === pathname;
  const setOpen = (fn: (o: boolean) => boolean) => setOpenOn(fn(open) ? pathname : null);

  const nav = [
    { href: address ? `/portfolio/${address}` : "/dashboard", label: "Portfolio", match: ["/portfolio", "/dashboard", "/positions"] },
    { href: "/simulator", label: "Simulator", match: ["/simulator"] },
    { href: "/alerts", label: "Alerts", match: ["/alerts"] },
    { href: "/settings", label: "Settings", match: ["/settings"] },
  ];
  const isActive = (m: string[]) => m.some((x) => pathname?.startsWith(x));

  return (
    <header className="sticky top-0 z-[var(--z-sticky)] border-b border-line bg-bg/90 backdrop-blur-sm supports-[backdrop-filter]:bg-bg/80">
      <div className="container-page flex h-14 items-center gap-6">
        <Link href="/" className="shrink-0 rounded-md" aria-label="MezoGuard home">
          <Logo />
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {nav.map((n) => (
            <Link
              key={n.label}
              href={n.href}
              aria-current={isActive(n.match) ? "page" : undefined}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-sm text-ink-2 transition-colors hover:text-ink",
                isActive(n.match) && "bg-surface-2 font-medium text-ink",
              )}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="hidden rounded-sm border border-line px-1.5 py-0.5 text-[11px] text-ink-2 sm:inline">Testnet</span>
          <ThemeToggle />
          <WalletMenu />
          <button
            type="button"
            className="grid size-9 cursor-pointer place-items-center rounded-md text-ink-2 hover:bg-surface-2 md:hidden"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
        </div>
      </div>
      {open && (
        <nav aria-label="Mobile" className="container-page grid gap-1 border-t border-line pb-3 pt-2 md:hidden">
          {nav.map((n) => (
            <Link
              key={n.label}
              href={n.href}
              aria-current={isActive(n.match) ? "page" : undefined}
              className={cn("rounded-md px-2.5 py-2.5 text-sm text-ink-2", isActive(n.match) && "bg-surface-2 font-medium text-ink")}
            >
              {n.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
