// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseAddressInput } from "@/lib/wallet/api";
import { cleanup, render, submit, typeInto } from "./helpers";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }), usePathname: () => "/" }));

import { AddressSearch } from "@/components/layout/address-search";

afterEach(() => {
  cleanup();
  push.mockReset();
});

describe("parseAddressInput", () => {
  it("accepts and checksums a lowercase address", () => {
    const r = parseAddressInput("  0x017ff5fb886e90f9e5adb405d8efddffc1162dd2 ");
    expect(r).toEqual({ ok: true, address: "0x017FF5FB886E90f9e5ADb405D8eFddffC1162dD2" });
  });
  it("rejects empty, names, missing 0x, wrong length, bad hex and bad checksum", () => {
    expect(parseAddressInput("")).toMatchObject({ ok: false, error: "Enter a wallet address." });
    expect(parseAddressInput("vitalik.eth")).toMatchObject({ ok: false, error: expect.stringContaining("Names are not supported") });
    expect(parseAddressInput("017ff5fb886e90f9e5adb405d8efddffc1162dd2")).toMatchObject({ ok: false, error: "Addresses start with 0x." });
    expect(parseAddressInput("0x1234")).toMatchObject({ ok: false, error: expect.stringContaining("wrong length") });
    expect(parseAddressInput("0xZZ7ff5fb886e90f9e5adb405d8efddffc1162dd2")).toMatchObject({ ok: false, error: "That is not a valid address." });
    expect(parseAddressInput("0x017FF5FB886E90f9e5ADb405D8eFddffC1162dD3")).toMatchObject({ ok: false, error: expect.stringContaining("checksum") });
  });
});

describe("<AddressSearch>", () => {
  it("shows an inline error and does not navigate for invalid input", async () => {
    const r = render(<AddressSearch />, { query: false });
    typeInto(r.container.querySelector("input")!, "0x1234");
    await submit(r.container.querySelector("form")!);
    expect(r.container.querySelector('[role="alert"]')?.textContent).toContain("wrong length");
    expect(r.container.querySelector("input")!.getAttribute("aria-invalid")).toBe("true");
    expect(push).not.toHaveBeenCalled();
  });
  it("navigates to the checksummed portfolio URL for a valid address", async () => {
    const r = render(<AddressSearch />, { query: false });
    typeInto(r.container.querySelector("input")!, "0x017ff5fb886e90f9e5adb405d8efddffc1162dd2");
    await submit(r.container.querySelector("form")!);
    expect(push).toHaveBeenCalledWith("/portfolio/0x017FF5FB886E90f9e5ADb405D8eFddffC1162dD2");
  });
});
