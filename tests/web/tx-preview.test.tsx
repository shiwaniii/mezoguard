// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { MORPHO, MUSD_PROTOCOL, BTC_TOKEN } from "@/lib/chain/config";
import { buildMorphoRepay, buildMorphoSupplyCollateral, buildTroveClose, buildTroveRepay, estimateImpact, troveMaxRepay, troveCloseCost } from "@/lib/wallet/plans";
import { TxPreview } from "@/components/actions/tx-preview";
import { cleanup, render } from "./helpers";
import { morpho, trove } from "./fixtures";

const WAD = 10n ** 18n;
afterEach(cleanup);

describe("action plans", () => {
  const t = trove();
  it("Trove repay targets BorrowerOperations.repayMUSD and caps at the max repay", () => {
    const max = troveMaxRepay(t);
    expect(max).toBe(t.debtAmount - 200n * WAD - 1800n * WAD);
    const plan = buildTroveRepay(t, 10_000n * WAD);
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]).toMatchObject({ contractName: "BorrowerOperations", address: MUSD_PROTOCOL.borrowerOperations, functionName: "repayMUSD" });
    expect(plan.steps[0].args[0]).toBe(max);
    expect(plan.notes[0]).toContain("minimum debt");
  });
  it("Trove close costs debt minus the gas reserve", () => {
    expect(troveCloseCost(t)).toBe(t.debtAmount - 200n * WAD);
    expect(buildTroveClose(t).steps[0].functionName).toBe("closeTrove");
  });
  it("Morpho repay approves the loan token first, then repays on Morpho", () => {
    const m = morpho();
    const plan = buildMorphoRepay(m, { amount: 5_000_000_000n, full: false });
    expect(plan.steps.map((s) => s.functionName)).toEqual(["approve", "repay"]);
    expect(plan.steps[0].address).toBe(m.debtAsset.address);
    expect(plan.steps[0].args).toEqual([MORPHO.morpho, 5_000_000_000n]);
    expect(plan.steps[1].args[1]).toBe(5_000_000_000n);
    expect(plan.steps[1].args[2]).toBe(0n);
    const full = buildMorphoRepay(m, { amount: 0n, full: true, borrowShares: 123n });
    expect(full.steps[1].args[1]).toBe(0n);
    expect(full.steps[1].args[2]).toBe(123n);
    expect(full.steps[0].approval!.amount).toBeGreaterThan(m.debtAmount);
  });
  it("Morpho add collateral approves the BTC precompile token", () => {
    const plan = buildMorphoSupplyCollateral(morpho(), 10n ** 17n);
    expect(plan.steps[0].address).toBe(BTC_TOKEN);
    expect(plan.steps[1].functionName).toBe("supplyCollateral");
  });
  it("estimates the effect of a repay", () => {
    const i = estimateImpact(t, "repay", 500n * WAD);
    expect(i.ratioAfter).toBeGreaterThan(i.ratioBefore);
    expect(i.liqAfter).toBeLessThan(i.liqBefore);
  });
});

describe("<TxPreview>", () => {
  it("shows contract name, address, function, args, value and gas", () => {
    const t = trove();
    const plan = buildTroveRepay(t, 250n * WAD);
    const r = render(<TxPreview steps={plan.steps} gas={{ repay: 187_000n }} />, { query: false });
    const text = r.text();
    expect(text).toContain("BorrowerOperations");
    expect(text).toContain(MUSD_PROTOCOL.borrowerOperations);
    expect(text).toContain("repayMUSD");
    expect(text).toContain("_amount");
    expect(text).toContain("250 MUSD");
    expect(text).toContain("_upperHint");
    expect(text).toContain("0 BTC");
    expect(text).toContain("187,000 gas");
    expect(r.container.querySelector(`a[href$="${MUSD_PROTOCOL.borrowerOperations}"]`)).toBeTruthy();
  });
  it("shows numbered steps and an 'already approved' marker for multi-step plans", () => {
    const plan = buildMorphoSupplyCollateral(morpho(), 10n ** 17n);
    const r = render(<TxPreview steps={plan.steps} skipped={{ approve: true }} gas={{ supplyCollateral: 90_000n }} />, { query: false });
    expect(r.text()).toContain("1.Approve BTC");
    expect(r.text()).toContain("Already approved");
    expect(r.text()).toContain("supplyCollateral");
  });
});
