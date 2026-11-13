// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "./helpers";
import { OWNER, morpho, portfolioResponse, trove } from "./fixtures";
import { wagmiMockFactory, rainbowKitMockFactory, wagmiState } from "./wagmi-mock";

vi.mock("wagmi", () => wagmiMockFactory());
vi.mock("@rainbow-me/rainbowkit", () => rainbowKitMockFactory());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/portfolio" }));

import { PortfolioView } from "@/components/portfolio/portfolio-view";
import { decodePortfolio } from "@/lib/wallet/decode";

let body: unknown;
beforeEach(() => {
  wagmiState.address = undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).startsWith("/api/session")) return new Response(JSON.stringify({ address: null, userId: null, dbEnabled: true }));
      if (String(url).startsWith("/api/positions/")) return new Response(JSON.stringify({ error: "x" }), { status: 404 });
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("decodePortfolio", () => {
  it("round-trips bigint fields from the wire format", () => {
    const t = trove();
    const d = decodePortfolio(portfolioResponse([t]));
    expect(d.positions[0].collateralAmount).toBe(t.collateralAmount);
    expect(d.positions[0].price.usd).toBe(t.price.usd);
    expect(d.assessments[t.positionId].level).toBe("healthy");
    expect(typeof d.summary.totalDebtUsd).toBe("bigint");
  });
});

describe("<PortfolioView>", () => {
  it("shows the empty state for a wallet with no loans (all protocols scanned)", async () => {
    body = portfolioResponse([]);
    const r = render(<PortfolioView address={OWNER} />);
    await waitFor(() => !!r.container.querySelector('[data-testid="empty-portfolio"]'));
    expect(r.text()).toContain("No open loans found");
    expect(r.text()).not.toContain("Prices are delayed");
  });

  it("own wallet with no loans links to testnet.mezo.org", async () => {
    wagmiState.address = OWNER;
    body = portfolioResponse([]);
    const r = render(<PortfolioView address={OWNER} />);
    await waitFor(() => !!r.container.querySelector('[data-testid="empty-portfolio"]'));
    expect(r.container.querySelector('a[href="https://testnet.mezo.org"]')).toBeTruthy();
  });

  it("never shows 'no loans' when a protocol scan failed", async () => {
    body = portfolioResponse([], {
      protocols: [
        { id: "mezo-musd-trove", label: "MUSD Trove", status: "ok", positions: 0 },
        { id: "morpho-blue", label: "Morpho Blue", status: "error", error: "RPC timeout", positions: 0 },
      ],
    });
    const r = render(<PortfolioView address={OWNER} />);
    await waitFor(() => r.text().includes("Could not check Morpho Blue"));
    expect(r.container.querySelector('[data-testid="empty-portfolio"]')).toBeNull();
    expect(r.text()).toContain("not proof that you have no loans");
  });

  it("shows the stale-price banner and marks levels unverified when the price is stale", async () => {
    body = portfolioResponse([trove({ stale: true })], { stale: true });
    const r = render(<PortfolioView address={OWNER} />);
    await waitFor(() => r.text().includes("Prices are delayed"));
    expect(r.text()).toContain("(unverified)");
    expect(r.text()).toContain("Delayed");
  });

  it("renders several positions with summary totals and 'updated' time", async () => {
    body = portfolioResponse([trove(), morpho()]);
    const r = render(<PortfolioView address={OWNER} />);
    await waitFor(() => !!r.container.querySelector('[data-testid="position-table"]'));
    expect(r.text()).toContain("MUSD Trove");
    expect(r.text()).toContain("Morpho BTC / mUSDC");
    expect(r.text()).toMatch(/Updated (\d+s ago|just now)/);
    expect(r.text()).not.toContain("Prices are delayed");
  });
});

import { AlertsView } from "@/components/alerts/alerts-view";

describe("<AlertsView>", () => {
  it("shows a clear state when the server has no database (503 DB_DISABLED)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "Database not configured", code: "DB_DISABLED" }), { status: 503 })),
    );
    const r = render(<AlertsView />);
    await waitFor(() => !!r.container.querySelector('[data-testid="db-disabled"]'));
    expect(r.text()).toContain("Alerts need the server database");
  });
});
