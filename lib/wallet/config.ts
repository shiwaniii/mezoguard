/**
 * wagmi config built with Mezo Passport (RainbowKit underneath). Mezo testnet only.
 * - Bitcoin wallets (Unisat, OKX, Xverse): the user signs with their Bitcoin key; a Mezo smart account
 *   (OrangeKit Safe) backed by that key is the EVM address and sends transactions.
 * - Ethereum wallets connect directly. WalletConnect is listed only when NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is set.
 */
import { createConfig, http, type Config, type CreateConfigParameters } from "wagmi";
import type { WalletList } from "@rainbow-me/rainbowkit";
import { injectedWallet, metaMaskWallet, rabbyWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import { mezoTestnet } from "@/lib/chain/config";

const APP_NAME = "MezoGuard";
const WALLETCONNECT_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

const transports = {
  [mezoTestnet.id]: http(mezoTestnet.rpcUrls.default.http[0], { batch: true, retryCount: 2 }),
};

type PassportConfigModule = typeof import("@mezo-org/passport/dist/src/config");

function buildWallets(passport: PassportConfigModule): WalletList {
  const evm = WALLETCONNECT_PROJECT_ID
    ? [metaMaskWallet, rabbyWallet, walletConnectWallet, injectedWallet]
    : [metaMaskWallet, rabbyWallet, injectedWallet];
  return [
    {
      groupName: "Bitcoin wallets",
      wallets: [passport.unisatWalletMezoTestnet, passport.okxWalletMezoTestnet, passport.xverseWalletMezoTestnet],
    },
    { groupName: "Ethereum wallets", wallets: evm },
  ];
}

/** Server render: no connectors. `ssr: true` lets wagmi hydrate the real connection in the browser. */
function serverConfig() {
  return createConfig({ chains: [mezoTestnet], transports, connectors: [], ssr: true });
}

/**
 * Browser: the Passport config, loaded from the deep `config` module because the package root re-exports
 * Passport's UI kit (React 18 only), and its Bitcoin connectors read `window` when created.
 */
function browserConfig(): Config {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const passport = require("@mezo-org/passport/dist/src/config") as PassportConfigModule;
  return passport.getConfig({
    appName: APP_NAME,
    appDescription: "Your Bitcoin-backed loans. One dashboard. No surprises.",
    appUrl: APP_URL,
    mezoNetwork: "testnet",
    walletConnectProjectId: WALLETCONNECT_PROJECT_ID || "mezoguard-no-walletconnect",
    wallets: buildWallets(passport),
    chains: [mezoTestnet],
    // Passport types this as Pick<CreateConfigParameters, "transports"> but spreads it into
    // RainbowKit's getDefaultConfig, which expects the transport map itself.
    transports: transports as unknown as Pick<CreateConfigParameters, "transports">,
    ssr: true,
  });
}

export const wagmiConfig: ReturnType<typeof serverConfig> =
  typeof window === "undefined" ? serverConfig() : (browserConfig() as ReturnType<typeof serverConfig>);

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}

/**
 * Passport's Bitcoin wallets connect through an OrangeKit smart account (a Safe). Mezo's signed-repay
 * contract checks plain ECDSA signatures, so smart accounts can't arm repay automation.
 */
export function isBitcoinSmartAccount(connector: { type?: string } | undefined): boolean {
  return connector?.type === "orangekit";
}
