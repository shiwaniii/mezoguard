// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkTxGuards } from "@/lib/wallet/guards";
import { cleanup, click, render } from "./helpers";
import { OWNER } from "./fixtures";
import { switchChainMock, wagmiMockFactory, rainbowKitMockFactory, wagmiState } from "./wagmi-mock";

vi.mock("wagmi", () => wagmiMockFactory());
vi.mock("@rainbow-me/rainbowkit", () => rainbowKitMockFactory());
import { TxGuard } from "@/components/actions/network-guard";

afterEach(cleanup);

describe("checkTxGuards", () => {
  it("blocks when not connected, on the wrong chain, or with a different account", () => {
    expect(checkTxGuards({ owner: OWNER }).problem).toBe("not-connected");
    expect(checkTxGuards({ owner: OWNER, account: OWNER, chainId: 1 }).problem).toBe("wrong-network");
    expect(checkTxGuards({ owner: OWNER, account: "0x1111111111111111111111111111111111111111", chainId: 31611 }).problem).toBe("wrong-account");
    expect(checkTxGuards({ owner: OWNER, account: OWNER.toLowerCase(), chainId: 31611 }).ok).toBe(true);
  });
});

describe("<TxGuard>", () => {
  it("shows a wrong-network warning with a switch button that requests chain 31611", () => {
    wagmiState.address = OWNER;
    wagmiState.chainId = 1;
    const spy = vi.spyOn(switchChainMock, "switchChainAsync");
    const onOk = vi.fn();
    const r = render(<TxGuard owner={OWNER} onOk={onOk} />, { query: false });
    expect(r.text()).toContain("Wrong network");
    expect(r.text()).toContain("Mezo Testnet (chain 31611)");
    const btn = [...r.container.querySelectorAll("button")].find((b) => b.textContent?.includes("Switch network"))!;
    click(btn);
    expect(spy).toHaveBeenCalledWith({ chainId: 31611 });
    expect(onOk).toHaveBeenLastCalledWith(false);
  });
  it("renders nothing and reports ok on the right chain with the owner's account", () => {
    wagmiState.address = OWNER;
    wagmiState.chainId = 31611;
    const onOk = vi.fn();
    const r = render(<TxGuard owner={OWNER} onOk={onOk} />, { query: false });
    expect(r.container.innerHTML).toBe("");
    expect(onOk).toHaveBeenLastCalledWith(true);
  });
});
