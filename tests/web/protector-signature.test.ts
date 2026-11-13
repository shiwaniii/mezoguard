import { describe, expect, it } from "vitest";
import { isSignatureLive, repayTypedData } from "@/lib/wallet/protector-signature";

describe("isSignatureLive (mirrors MezoGuardProtector.arm's PreviousSignatureLive check)", () => {
  const base = { lastNonce: 4n, lastDeadline: 2_000n, nonce: 4n, now: 1_000n };
  it("is live at the same nonce before the deadline, including the deadline second", () => {
    expect(isSignatureLive(base)).toBe(true);
    expect(isSignatureLive({ ...base, now: 2_000n })).toBe(true);
  });
  it("is dead once the nonce moved, the deadline passed, or nothing was ever signed", () => {
    expect(isSignatureLive({ ...base, nonce: 5n })).toBe(false);
    expect(isSignatureLive({ ...base, now: 2_001n })).toBe(false);
    expect(isSignatureLive({ lastNonce: 0n, lastDeadline: 0n, nonce: 0n, now: 1n })).toBe(false);
  });
  it("cancel signature is a 1-wei RepayMUSD on BorrowerOperationsSignatures", () => {
    const t = repayTypedData({ amount: 1n, borrower: "0x017FF5FB886E90f9e5ADb405D8eFddffC1162dD2", nonce: 4n, deadline: 9n });
    expect(t.domain.name).toBe("BorrowerOperationsSignatures");
    expect(t.message.amount).toBe(1n);
  });
});
