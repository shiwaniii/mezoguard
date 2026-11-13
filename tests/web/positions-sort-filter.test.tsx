// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { assess } from "@/lib/risk";
import { filterRows, sortRows, NO_FILTER, type Row } from "@/lib/wallet/positions";
import { cleanup, render, typeInto, waitFor } from "./helpers";
import { morpho, trove } from "./fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/" }));
import { PositionTable } from "@/components/portfolio/position-table";

const WAD = 10n ** 18n;
const owner2 = "0x1111111111111111111111111111111111111111" as const;
const owner3 = "0x2222222222222222222222222222222222222222" as const;
// healthy trove (~186%), high-risk trove (~132%), morpho (~192%, biggest collateral)
const a = trove();
const b = trove({ owner: owner2, coll: 50_000_000_000_000_000n, debt: 2_800n * WAD });
const c = morpho({ owner: owner3 });
const rows: Row[] = [a, b, c].map((p) => ({ position: p, assessment: assess(p) }));

afterEach(cleanup);

describe("sortRows / filterRows", () => {
  it("sorts by risk (worst first), lowest CR, largest debt and largest collateral", () => {
    expect(assess(b).level).not.toBe("healthy");
    expect(sortRows(rows, "risk")[0].position.positionId).toBe(b.positionId);
    expect(sortRows(rows, "lowest-cr").map((r) => r.position.positionId)).toEqual([b.positionId, a.positionId, c.positionId]);
    expect(sortRows(rows, "largest-debt")[0].position.positionId).toBe(c.positionId);
    expect(sortRows(rows, "largest-collateral")[0].position.positionId).toBe(c.positionId);
    expect(sortRows(rows, "protocol")[0].position.protocol).toBe("mezo-musd-trove");
  });
  it("filters by protocol, asset and risk", () => {
    expect(filterRows(rows, { ...NO_FILTER, protocol: "morpho-blue" })).toHaveLength(1);
    expect(filterRows(rows, { ...NO_FILTER, asset: "mUSDC" })).toHaveLength(1);
    expect(filterRows(rows, { ...NO_FILTER, asset: "BTC" })).toHaveLength(3);
    expect(filterRows(rows, { ...NO_FILTER, risk: "healthy" }).map((r) => r.position.positionId)).not.toContain(b.positionId);
  });
});

describe("<PositionTable>", () => {
  const assessments = Object.fromEntries(rows.map((r) => [r.position.positionId, r.assessment!]));
  const order = (el: HTMLElement) =>
    [...el.querySelectorAll('[data-testid="position-table"] tbody tr')].map((tr) => tr.getAttribute("data-position"));

  it("orders rows by risk by default and re-sorts on change", () => {
    const r = render(<PositionTable positions={[a, b, c]} assessments={assessments} />, { query: false });
    expect(order(r.container)[0]).toBe(b.positionId);
    typeInto(r.container.querySelector('select[aria-label="Sort loans"]')!, "largest-collateral");
    expect(order(r.container)[0]).toBe(c.positionId);
  });

  it("filters rows and shows a clear message when nothing matches", async () => {
    const r = render(<PositionTable positions={[a, b, c]} assessments={assessments} />, { query: false });
    typeInto(r.container.querySelector('select[aria-label="Filter by protocol"]')!, "morpho-blue");
    // filtered-out rows fade out (AnimatePresence) before leaving the DOM; the mobile list updates immediately
    const mobile = () => [...r.container.querySelectorAll("ul li[data-position]")].map((li) => li.getAttribute("data-position"));
    expect(mobile()).toEqual([c.positionId]);
    await waitFor(() => order(r.container).length === 1, 3000);
    expect(order(r.container)).toEqual([c.positionId]);
    typeInto(r.container.querySelector('select[aria-label="Filter by risk"]')!, "liquidatable");
    expect(r.text()).toContain("No loans match these filters.");
  });
});
