/** Shared vi.mock factories for "wagmi" (v2) and RainbowKit so components render without providers. */
export const wagmiState: { address?: string; chainId?: number; status: string } = { address: undefined, chainId: undefined, status: "disconnected" };
export const switchChainMock = { switchChainAsync: async () => ({}), isPending: false };

export function wagmiMockFactory() {
  return {
    useAccount: () => ({ ...wagmiState, connector: undefined }),
    useDisconnect: () => ({ disconnect: () => {} }),
    useSwitchChain: () => switchChainMock,
    useSignMessage: () => ({ signMessageAsync: async () => "0x", isPending: false }),
    useSignTypedData: () => ({ signTypedDataAsync: async () => "0x", isPending: false }),
    useWriteContract: () => ({ writeContractAsync: async () => "0x", isPending: false }),
    usePublicClient: () => undefined,
    createConfig: () => ({}),
    http: () => ({}),
    WagmiProvider: ({ children }: { children: unknown }) => children,
  };
}

export const openConnectModalMock = { fn: () => {} };
export function rainbowKitMockFactory() {
  return { useConnectModal: () => ({ openConnectModal: openConnectModalMock.fn }) };
}
