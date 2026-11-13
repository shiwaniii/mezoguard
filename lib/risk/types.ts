/**
 * FROZEN — the common read model every protocol adapter produces, and the risk-engine output.
 * All token/price values are bigint. Ratios are 1e18-scaled fractions (1.5e18 = 150%). USD values are 1e18-scaled.
 * Never use JS numbers for money; convert to display strings only in lib/format.
 */
import type { Address, Hex } from "viem";

export type ProtocolId = "mezo-musd-trove" | "morpho-blue";

export type RiskLevel = "healthy" | "watch" | "high" | "critical" | "liquidatable";
export const RISK_ORDER: Record<RiskLevel, number> = { healthy: 0, watch: 1, high: 2, critical: 3, liquidatable: 4 };

/** A price reading with provenance. `stale` is set by the adapter using the source's own staleness rule. */
export interface PriceReading {
  /** USD per 1 whole collateral unit, 1e18-scaled. */
  usd: bigint;
  source: "mezo-pricefeed" | "mezo-oracle-precompile" | "morpho-oracle";
  sourceAddress: Address;
  /** Unix seconds the source says it was updated (oracle updatedAt), or block timestamp for instant reads. */
  updatedAt: number;
  blockNumber: bigint;
  stale: boolean;
  staleReason?: string;
}

/** Protocol parameters that drive liquidation/redemption. Read live, never hardcoded. */
export interface TroveParams {
  kind: "trove";
  mcr: bigint;            // 1.1e18
  ccr: bigint;            // 1.5e18
  minNetDebt: bigint;     // 1800e18
  gasCompensation: bigint; // 200e18
  borrowingRate: bigint;  // 1e18-scaled fraction
  redemptionRate: bigint; // 1e18-scaled fraction
  recoveryMode: boolean;
  tcr: bigint;
  systemColl: bigint;
  systemDebt: bigint;
}

export interface MorphoParams {
  kind: "morpho";
  marketId: Hex;
  marketLabel: string;
  loanToken: Address;
  collateralToken: Address;
  oracle: Address;
  irm: Address;
  /** 1e18-scaled liquidation LTV (0.77e18). Liquidation when debt > collateralValue * lltv, i.e. CR < 1/lltv. */
  lltv: bigint;
  /** Raw Morpho oracle price (1e36-scaled, decimal-adjusted). */
  oraclePrice: bigint;
  /** Borrow APR from IRM, 1e18-scaled per-second rate × seconds/year (approx, display only). */
  borrowApr?: bigint;
}

export interface TroveRedemption {
  /** 1-based position from the riskiest end of SortedTroves (1 = redeemed first). */
  queuePosition: number;
  queueSize: number;
  /** Total MUSD debt of troves that would be redeemed before this one (lower NICR, ICR >= MCR). 1e18. */
  debtAhead: bigint;
  /** Share of system debt ahead of this trove, 1e18-scaled. */
  debtAheadShare: bigint;
  exposure: "low" | "moderate" | "high";
}

/** Common read model (Section 3.3 of the brief). Produced by every adapter. */
export interface Position {
  protocol: ProtocolId;
  /** Trove: borrower address. Morpho: `${marketId}:${owner}`. Stable across syncs. */
  positionId: string;
  owner: Address;
  chainId: number;
  collateralAsset: { symbol: string; address: Address; decimals: number };
  /** Native units of collateral token. */
  collateralAmount: bigint;
  debtAsset: { symbol: string; address: Address; decimals: number };
  /** Native units of debt token, INCLUDING accrued interest (Trove: principal+interest from getEntireDebtAndColl, which already folds in pending redistribution; Morpho: shares→assets rounded up). */
  debtAmount: bigint;
  /** Breakdown where the protocol exposes it. */
  debtPrincipal?: bigint;
  debtInterest?: bigint;
  /** USD, 1e18. */
  collateralValueUsd: bigint;
  debtValueUsd: bigint;
  /** Collateral ratio as the PROTOCOL computes it (Trove: getCurrentICR; Morpho: collateral*price/1e36/debt). 1e18. */
  collateralRatio: bigint;
  /** Ratio at/below which the protocol allows liquidation (Trove: MCR; Morpho: 1/LLTV). 1e18. */
  liquidationRatio: bigint;
  /** USD per collateral unit at which collateralRatio == liquidationRatio. 1e18. Estimate (see RISK_ENGINE.md). */
  liquidationPriceUsd: bigint;
  price: PriceReading;
  status: "active" | "closed" | "liquidated" | "redeemed";
  params: TroveParams | MorphoParams;
  redemption?: TroveRedemption;
  /** Interest rate in bps/year where fixed (Trove). */
  interestRateBps?: number;
  /** Max borrowing capacity (Trove only). */
  maxBorrowingCapacity?: bigint;
  blockNumber: bigint;
  /** Unix ms. */
  readAt: number;
}

/** App-level warning thresholds, expressed as ratio-above-liquidation multipliers so they work across protocols. */
export interface RiskThresholds {
  /** Position is "watch" if CR < liquidationRatio * watch (e.g. 1.6 → 176% for a 110% MCR). 1e18. */
  watch: bigint;
  high: bigint;
  critical: bigint;
}

export interface RiskAssessment {
  positionId: string;
  level: RiskLevel;
  /** collateralRatio - liquidationRatio, 1e18. */
  safetyMargin: bigint;
  /** (price - liqPrice)/price, 1e18-scaled fraction; 0 if at/below. */
  priceDeclineBuffer: bigint;
  /** Price at which the position enters the next-worse level (undefined at liquidatable). USD 1e18. */
  nextLevelPriceUsd?: bigint;
  nextLevel?: RiskLevel;
  /** True if price data is stale → level must be shown as unverified. */
  stale: boolean;
  reasons: string[];
}

export interface ScenarioResult {
  positionId: string;
  priceUsd: bigint;
  collateralValueUsd: bigint;
  collateralRatio: bigint;
  level: RiskLevel;
  priceDeclineBuffer: bigint;
  repayToTarget: bigint;     // debt-token native units, 0 if none needed
  addCollToTarget: bigint;   // collateral native units, 0 if none needed
}

export interface Recommendation {
  positionId: string;
  targetRatio: bigint;
  /** Debt-token native units. Never negative. Respects protocol rules (Trove: min net debt / gas comp). */
  repayAmount: bigint;
  repayFeasible: boolean;
  repayNote?: string;
  /** Collateral native units, rounded up. */
  addCollateral: bigint;
  resultingRatioAfterRepay: bigint;
  resultingRatioAfterAdd: bigint;
  kind: "estimate";
}

export interface PortfolioSummary {
  owner: Address;
  positions: number;
  totalCollateralUsd: bigint;
  totalDebtUsd: bigint;
  debtByAsset: Record<string, bigint>;
  /** Debt-weighted CR (sum coll USD / sum debt USD), 1e18. */
  aggregateRatio: bigint;
  /** Debt-weighted average of per-position risk scores 0..100 (integer). */
  riskScore: number;
  level: RiskLevel;
  highestRiskPositionId?: string;
  /** Debt USD in positions at high/critical/liquidatable. */
  debtAtRiskUsd: bigint;
  concentration: { positionId: string; protocol: ProtocolId; collateralShare: bigint; debtShare: bigint }[];
  stale: boolean;
}

/** Every adapter implements this. Pure reads; no wallet. */
export interface ProtocolAdapter {
  id: ProtocolId;
  label: string;
  /** Discover all open positions for a wallet; reconciled against live state (never events alone). */
  discover(owner: Address): Promise<Position[]>;
  /** Re-read one position. */
  refresh(positionId: string): Promise<Position | null>;
  /** Pure: re-price a position at a hypothetical collateral price (USD 1e18) using protocol-specific math. */
  reprice(p: Position, priceUsd: bigint): { collateralValueUsd: bigint; collateralRatio: bigint };
}
