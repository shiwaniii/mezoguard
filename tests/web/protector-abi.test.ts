import { describe, expect, it } from "vitest";
import { toFunctionSignature, toEventSignature, formatAbiItem } from "viem/utils";
import type { AbiFunction, AbiEvent } from "viem";
type AbiError = Parameters<typeof formatAbiItem>[0];
import compiled from "@/contracts/abi/MezoGuardProtector.json";
import { protectorAbi } from "@/lib/wallet/protector-abi";
import { repayTypedData, AUTOMATION_DOMAIN } from "@/components/automation/automation-panel";
import { MUSD_PROTOCOL } from "@/lib/chain/config";

const sig = (x: { type: string }) =>
  x.type === "function" ? toFunctionSignature(x as AbiFunction) : x.type === "event" ? toEventSignature(x as AbiEvent) : formatAbiItem(x as AbiError);

describe("protector ABI", () => {
  it("every entry of the typed ABI exists in the compiled contract ABI", () => {
    const have = new Set((compiled as { type: string }[]).filter((x) => ["function", "event", "error"].includes(x.type)).map(sig));
    for (const item of protectorAbi.filter((x) => ["function", "event", "error"].includes(x.type))) {
      expect(have.has(sig(item)), sig(item)).toBe(true);
    }
  });
  it("builds the RepayMUSD typed data for BorrowerOperationsSignatures on chain 31611", () => {
    const td = repayTypedData({ amount: 5n, borrower: "0x017FF5FB886E90f9e5ADb405D8eFddffC1162dD2", nonce: 3n, deadline: 99n });
    expect(td.domain).toEqual({ name: "BorrowerOperationsSignatures", version: "1", chainId: 31611, verifyingContract: MUSD_PROTOCOL.borrowerOperationsSignatures });
    expect(AUTOMATION_DOMAIN.chainId).toBe(31611);
    expect(td.primaryType).toBe("RepayMUSD");
    expect(td.message).toEqual({ amount: 5n, borrower: "0x017FF5FB886E90f9e5ADb405D8eFddffC1162dD2", nonce: 3n, deadline: 99n });
  });
});
