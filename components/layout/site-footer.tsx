import Link from "next/link";
import { EXPLORER_URL } from "@/lib/chain/config";
import { DEPLOYMENT_LINKS } from "@/lib/chain/deployment";

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-line">
      <div className="container-page flex flex-col gap-4 py-8 text-[13px] text-ink-2 sm:flex-row sm:items-center sm:justify-between">
        <p>MezoGuard reads Mezo testnet (chain 31611). It never holds your keys or your funds.</p>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2">
          <Link className="hover:text-ink" href="/simulator">Simulator</Link>
          <a className="hover:text-ink" href={EXPLORER_URL} target="_blank" rel="noreferrer">Mezo explorer</a>
          <a className="hover:text-ink" href="https://testnet.mezo.org" target="_blank" rel="noreferrer">Mezo testnet app</a>
        </nav>
      </div>
      <div className="container-page border-t border-line py-4 text-[12px] text-ink-2">
        <nav aria-label="Testnet deployment" className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <span className="text-ink-3">Testnet deployment</span>
          {DEPLOYMENT_LINKS.map((l) => (
            <a key={l.href} className="font-mono hover:text-ink" href={l.href} target="_blank" rel="noreferrer">
              {l.label}
            </a>
          ))}
        </nav>
      </div>
    </footer>
  );
}
