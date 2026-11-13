/**
 * FROZEN — Mezo testnet chain + protocol addresses. Every address below was verified on-chain on 2026-11-09
 * (code present, proxy implementation exposes the functions we call). Sources in docs/TECHNICAL_DISCOVERY.md.
 * Env vars may override (NEXT_PUBLIC_*), but defaults are the verified values. Never add an unverified address.
 */
import type { Address, Hex } from "viem";

export const MEZO_TESTNET_ID = 31611 as const;

export const mezoTestnet = {
  id: MEZO_TESTNET_ID,
  name: "Mezo Testnet",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  rpcUrls: { default: { http: [process.env.NEXT_PUBLIC_MEZO_RPC_URL ?? "https://rpc.test.mezo.org"] } },
  blockExplorers: { default: { name: "Mezo Explorer", url: "https://explorer.test.mezo.org" } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" as Address } },
  testnet: true,
} as const;

export const EXPLORER_URL = "https://explorer.test.mezo.org";
export const EXPLORER_API = "https://api.explorer.test.mezo.org/api/v2";
/** eth_getLogs block-range cap on rpc.test.mezo.org. */
export const LOG_RANGE_CAP = 9_999n;

/** MUSD (Liquity-v1-style CDP) — mezo-org/musd solidity/artifacts/deployments/matsnet. */
export const MUSD_PROTOCOL = {
  musd: "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503",
  borrowerOperations: "0xCdF7028ceAB81fA0C6971208e83fa7872994beE5",
  borrowerOperationsSignatures: "0xD757e3646AF370b15f32EB557F0F8380Df7D639e",
  troveManager: "0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0",
  sortedTroves: "0x722E4D24FD6Ff8b0AC679450F3D91294607268fA",
  hintHelpers: "0x4e4cBA3779d56386ED43631b4dCD6d8EacEcBCF6",
  priceFeed: "0x86bCF0841622a5dAC14A313a15f96A95421b9366",
  interestRateManager: "0xD4D6c36A592A2c5e86035A6bca1d57747a567f37",
  activePool: "0x143A063F62340DA3A8bEA1C5642d18C6D0F7FF51",
  defaultPool: "0x59851D252090283f9367c159f0C9036e75483300",
  stabilityPool: "0x1CCA7E410eE41739792eA0A24e00349Dd247680e",
  collSurplusPool: "0xB4C35747c26E4aB5F1a7CdC7E875B5946eFa6fa9",
  /** BTC/USD oracle precompile behind PriceFeed (AggregatorV3, 18 dec). PriceFeed reverts if > 60 s old. */
  btcUsdOracle: "0x7b7c000000000000000000000000000000000015",
} as const satisfies Record<string, Address>;

/** BTC ERC-20 precompile (18 dec; balanceOf == native balance). Morpho collateral token. */
export const BTC_TOKEN: Address = "0x7b7C000000000000000000000000000000000000";
/** Mezo testnet mUSDC (Circle-style USDC, 6 dec, verified proxy). NOTE: differs from the docs' mainnet mUSDC 0x0467…c197. */
export const MUSDC_TESTNET: Address = "0xe1a26db653708A2AD8F824E92Db9852410e33A59";

/** Morpho Blue core (verified "Morpho" on the explorer). */
export const MORPHO = {
  morpho: "0xCe1da828cA15cb1FDAfa84C366A53C8106655a73",
  /** Creation block of Morpho (tx 0x1e42…6df9). Index events from here. */
  deployBlock: 13_272_318n,
} as const;

export interface MorphoMarketConfig {
  id: Hex;
  label: string;
  loanToken: Address;
  loanSymbol: "mUSDC" | "MUSD";
  loanDecimals: number;
  collateralToken: Address;
  collateralSymbol: "BTC" | "MUSD";
  collateralDecimals: number;
  oracle: Address;
  irm: Address;
  /** 1e18-scaled liquidation LTV. */
  lltv: bigint;
}

/**
 * Known Morpho markets (read via idToMarketParams on 2026-11-09). The Morpho adapter must ALSO discover new markets
 * from CreateMarket events and re-read params on-chain; this list is the allowlist of markets we label/support.
 */
export const MORPHO_MARKETS: MorphoMarketConfig[] = [
  {
    id: "0x1a7f8d1036936234ff8477741ba80d4a85f573fee4de1bccc779ecc7e5680b2e",
    label: "BTC / mUSDC",
    loanToken: MUSDC_TESTNET, loanSymbol: "mUSDC", loanDecimals: 6,
    collateralToken: BTC_TOKEN, collateralSymbol: "BTC", collateralDecimals: 18,
    oracle: "0x72fB16cC59Eb5E7ACF84f24d9f2605eE153E0e6C",
    irm: "0x0c97Fe017628636649ff374aD499529F91167441",
    lltv: 770000000000000000n,
  },
  {
    id: "0xf0bb61627bebe18b8dd595e62f84f3a1f5ea9470e077394aeedab44f17d7e3ff",
    label: "BTC / MUSD",
    loanToken: MUSD_PROTOCOL.musd, loanSymbol: "MUSD", loanDecimals: 18,
    collateralToken: BTC_TOKEN, collateralSymbol: "BTC", collateralDecimals: 18,
    oracle: "0xfC1F49bFdE8A69e8d893dF8e976401232e6600Cc",
    irm: "0x0c97Fe017628636649ff374aD499529F91167441",
    lltv: 770000000000000000n,
  },
  {
    id: "0x9ab3b4dea4f3df9a4997807b7b02901c6014b76ffbc87f318e868ed7c6fb03b5",
    label: "MUSD / mUSDC",
    loanToken: MUSDC_TESTNET, loanSymbol: "mUSDC", loanDecimals: 6,
    collateralToken: MUSD_PROTOCOL.musd, collateralSymbol: "MUSD", collateralDecimals: 18,
    oracle: "0x05A5b3C1FEf4C5330BbFDC86f4c1757d43B04Bfd",
    irm: "0x0c97Fe017628636649ff374aD499529F91167441",
    lltv: 770000000000000000n,
  },
];

/** MezoGuard's own contract (deployed by contracts/script/Deploy.s.sol). Empty until deployed → automation UI disabled. */
export const PROTECTOR_ADDRESS = (process.env.NEXT_PUBLIC_PROTECTOR_ADDRESS || undefined) as Address | undefined;

export const explorerTx = (h: string) => `${EXPLORER_URL}/tx/${h}`;
export const explorerAddress = (a: string) => `${EXPLORER_URL}/address/${a}`;
