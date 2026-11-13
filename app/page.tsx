import Link from "next/link";
import { ArrowRight, Bell, Eye, KeyRound, PenLine } from "lucide-react";
import { HeroCta } from "@/components/landing/hero-cta";
import { ExampleLoan } from "@/components/landing/example-loan";
import { AddressSearch } from "@/components/layout/address-search";
import { RiskBadge } from "@/components/risk/risk-badge";
import { RISK_HELP } from "@/lib/wallet/display";
import type { RiskLevel } from "@/lib/risk/types";

const LEVELS: { level: RiskLevel; when: string }[] = [
  { level: "healthy", when: "Ratio well above the warning line" },
  { level: "watch", when: "Below 1.6× the liquidation line" },
  { level: "high", when: "Below 1.3× the liquidation line" },
  { level: "critical", when: "Below 1.1× the liquidation line" },
  { level: "liquidatable", when: "At or below the liquidation line" },
];

export default function Home() {
  return (
    <>
      <section className="container-page grid items-center gap-12 pb-20 pt-12 md:pt-20 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
        <div className="max-w-xl">
          <h1 className="text-[2.25rem] font-semibold leading-[1.08] tracking-[-0.025em] text-ink sm:text-5xl">
            See how close your Bitcoin loans are to liquidation.
          </h1>
          <p className="mt-5 max-w-[56ch] text-[17px] leading-relaxed text-ink-2">
            Monitor every supported Mezo loan, understand your liquidation exposure, and take action before your
            collateral is at risk.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <HeroCta />
            <Link href="/simulator" className="inline-flex h-11 items-center gap-1.5 px-2 text-[15px] font-medium text-accent-ink hover:underline underline-offset-4">
              Try the price simulator <ArrowRight aria-hidden className="size-4" />
            </Link>
          </div>
          <AddressSearch className="mt-8 max-w-md" />
        </div>
        <ExampleLoan />
      </section>

      <section aria-labelledby="how" className="border-y border-line bg-surface">
        <div className="container-page py-16 md:py-20">
          <h2 id="how" className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">How it works</h2>
          <ol className="mt-10 grid gap-10 md:grid-cols-3 md:gap-8">
            <li>
              <p className="num text-sm font-medium text-ink-3">1</p>
              <h3 className="mt-2 text-lg font-semibold text-ink">Connect or paste an address</h3>
              <p className="mt-2 max-w-[38ch] text-[15px] leading-relaxed text-ink-2">
                We only need your public address. No sign-up to look at a portfolio.
              </p>
            </li>
            <li>
              <p className="num text-sm font-medium text-ink-3">2</p>
              <h3 className="mt-2 text-lg font-semibold text-ink">We read your loans from the chain</h3>
              <p className="mt-2 max-w-[38ch] text-[15px] leading-relaxed text-ink-2">
                Collateral, debt, interest and the protocol&apos;s own price, every 30 seconds. If a price is late, we say so.
              </p>
            </li>
            <li>
              <p className="num text-sm font-medium text-ink-3">3</p>
              <h3 className="mt-2 text-lg font-semibold text-ink">Act before it gets close</h3>
              <p className="mt-2 max-w-[38ch] text-[15px] leading-relaxed text-ink-2">
                Get an alert, see exactly how much to repay or add, and send it from your own wallet.
              </p>
            </li>
          </ol>
        </div>
      </section>

      <section aria-labelledby="protocols" className="container-page py-16 md:py-24">
        <h2 id="protocols" className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Supported loans</h2>
        <p className="mt-3 max-w-[60ch] text-[15px] text-ink-2">
          Each protocol is checked with its own rules and its own price, because that is what its liquidations use.
        </p>
        <div className="mt-8 overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-surface text-[13px] text-ink-2">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Protocol</th>
                <th scope="col" className="px-4 py-3 font-medium">Liquidated when</th>
                <th scope="col" className="px-4 py-3 font-medium">Price used</th>
                <th scope="col" className="px-4 py-3 font-medium">You can do from here</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line align-top">
              <tr>
                <th scope="row" className="px-4 py-4 font-semibold text-ink">
                  MUSD Troves
                  <span className="mt-0.5 block text-[13px] font-normal text-ink-2">Borrow MUSD against BTC</span>
                </th>
                <td className="px-4 py-4 text-ink-2">Ratio below 110%. Redemptions can also take BTC above that.</td>
                <td className="px-4 py-4 text-ink-2">Mezo price feed</td>
                <td className="px-4 py-4 text-ink-2">Repay, add BTC, close, automatic repay</td>
              </tr>
              <tr>
                <th scope="row" className="px-4 py-4 font-semibold text-ink">
                  Morpho Blue markets on Mezo
                  <span className="mt-0.5 block text-[13px] font-normal text-ink-2">BTC / mUSDC, BTC / MUSD, MUSD / mUSDC</span>
                </th>
                <td className="px-4 py-4 text-ink-2">Debt above 77% of collateral value (ratio below about 130%).</td>
                <td className="px-4 py-4 text-ink-2">Each market&apos;s own oracle</td>
                <td className="px-4 py-4 text-ink-2">Repay, add collateral</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="levels" className="container-page grid gap-12 pb-16 md:pb-24 lg:grid-cols-2 lg:gap-16">
        <div>
          <h2 id="levels" className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">One risk scale for every loan</h2>
          <p className="mt-3 max-w-[52ch] text-[15px] text-ink-2">
            The levels are measured from each loan&apos;s own liquidation line, so a Trove and a Morpho loan can be compared at a glance.
          </p>
          <ul className="mt-8 divide-y divide-line border-y border-line">
            {LEVELS.map((l) => (
              <li key={l.level} className="grid grid-cols-[8.5rem_1fr] items-baseline gap-4 py-3">
                <RiskBadge level={l.level} />
                <div>
                  <p className="text-sm text-ink">{RISK_HELP[l.level]}</p>
                  <p className="mt-0.5 text-[13px] text-ink-2">{l.when}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="lg:pt-1">
          <h2 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Alerts that arrive in time</h2>
          <p className="mt-3 max-w-[52ch] text-[15px] text-ink-2">
            A background check runs every minute. You choose what matters and where it goes.
          </p>
          <ul className="mt-8 space-y-4 text-[15px] text-ink">
            <li className="flex gap-3"><Bell aria-hidden className="mt-1 size-4 shrink-0 text-ink-3" />Ratio drops below a number you pick</li>
            <li className="flex gap-3"><Bell aria-hidden className="mt-1 size-4 shrink-0 text-ink-3" />BTC falls by a percentage you pick</li>
            <li className="flex gap-3"><Bell aria-hidden className="mt-1 size-4 shrink-0 text-ink-3" />A loan reaches high risk or worse</li>
            <li className="flex gap-3"><Bell aria-hidden className="mt-1 size-4 shrink-0 text-ink-3" />Your Trove moves to the front of the redemption queue</li>
            <li className="flex gap-3"><Bell aria-hidden className="mt-1 size-4 shrink-0 text-ink-3" />BTC gets within a set distance of your liquidation price</li>
          </ul>
          <p className="mt-6 text-sm text-ink-2">Sent in the app, by email, to Telegram or as a browser notification.</p>
        </div>
      </section>

      <section aria-labelledby="safety" className="border-t border-line bg-surface">
        <div className="container-page grid gap-10 py-16 md:grid-cols-[1fr_1.4fr] md:py-20">
          <div>
            <h2 id="safety" className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Your keys stay with you</h2>
            <p className="mt-3 max-w-[44ch] text-[15px] text-ink-2">
              MezoGuard is a read-only tracker. Anything that moves money is a transaction you review and sign yourself.
            </p>
          </div>
          <dl className="grid gap-6 sm:grid-cols-2">
            <div className="flex gap-3">
              <KeyRound aria-hidden className="mt-0.5 size-5 shrink-0 text-ink-2" />
              <div>
                <dt className="font-medium text-ink">No keys, no custody</dt>
                <dd className="mt-1 text-sm text-ink-2">We never ask for a seed phrase and never hold funds.</dd>
              </div>
            </div>
            <div className="flex gap-3">
              <Eye aria-hidden className="mt-0.5 size-5 shrink-0 text-ink-2" />
              <div>
                <dt className="font-medium text-ink">Read-only tracking</dt>
                <dd className="mt-1 text-sm text-ink-2">Watching a wallet needs its address and nothing else.</dd>
              </div>
            </div>
            <div className="flex gap-3">
              <PenLine aria-hidden className="mt-0.5 size-5 shrink-0 text-ink-2" />
              <div>
                <dt className="font-medium text-ink">You sign every transaction</dt>
                <dd className="mt-1 text-sm text-ink-2">We show the contract, function and amounts before your wallet opens.</dd>
              </div>
            </div>
            <div className="flex gap-3">
              <Bell aria-hidden className="mt-0.5 size-5 shrink-0 text-ink-2" />
              <div>
                <dt className="font-medium text-ink">Automation is opt-in and capped</dt>
                <dd className="mt-1 text-sm text-ink-2">It can only repay your Trove, from a budget you deposit, below your trigger.</dd>
              </div>
            </div>
          </dl>
        </div>
      </section>

      <section className="container-page flex flex-col items-start gap-6 py-16 md:flex-row md:items-center md:justify-between md:py-20">
        <h2 className="max-w-[24ch] text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Check your loans now.</h2>
        <HeroCta />
      </section>
    </>
  );
}
