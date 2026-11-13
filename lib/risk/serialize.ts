/**
 * bigint ⇄ JSON wire format (bigint → decimal string). `toWire` is generic; `fromWire*` are explicit per type so a
 * string field that merely looks numeric (an address, an id) is never turned into a bigint by accident.
 */
import type { Wire } from "@/lib/api-types";
import type {
  MorphoParams, PortfolioSummary, Position, PriceReading, Recommendation, RiskAssessment, ScenarioResult, TroveParams,
  TroveRedemption,
} from "@/lib/risk/types";

export function toWire<T>(x: T): Wire<T> {
  return conv(x) as Wire<T>;
}

function conv(x: unknown): unknown {
  if (typeof x === "bigint") return x.toString();
  if (Array.isArray(x)) return x.map(conv);
  if (x !== null && typeof x === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(x)) if (v !== undefined) out[k] = conv(v);
    return out;
  }
  return x;
}

const B = (s: string): bigint => {
  if (typeof s !== "string" || !/^-?\d+$/.test(s)) throw new Error(`fromWire: expected integer string, got ${String(s)}`);
  return BigInt(s);
};
const Bopt = (s: string | undefined): bigint | undefined => (s === undefined || s === null ? undefined : B(s));

export function fromWirePriceReading(w: Wire<PriceReading>): PriceReading {
  return { ...w, usd: B(w.usd), blockNumber: B(w.blockNumber) };
}

function fromWireParams(w: Wire<TroveParams> | Wire<MorphoParams>): TroveParams | MorphoParams {
  if (w.kind === "trove") {
    return {
      ...w,
      mcr: B(w.mcr), ccr: B(w.ccr), minNetDebt: B(w.minNetDebt), gasCompensation: B(w.gasCompensation),
      borrowingRate: B(w.borrowingRate), redemptionRate: B(w.redemptionRate), tcr: B(w.tcr),
      systemColl: B(w.systemColl), systemDebt: B(w.systemDebt),
    };
  }
  return { ...w, lltv: B(w.lltv), oraclePrice: B(w.oraclePrice), borrowApr: Bopt(w.borrowApr) };
}

function fromWireRedemption(w: Wire<TroveRedemption>): TroveRedemption {
  return { ...w, debtAhead: B(w.debtAhead), debtAheadShare: B(w.debtAheadShare) };
}

export function fromWirePosition(w: Wire<Position>): Position {
  return {
    ...w,
    collateralAmount: B(w.collateralAmount),
    debtAmount: B(w.debtAmount),
    debtPrincipal: Bopt(w.debtPrincipal),
    debtInterest: Bopt(w.debtInterest),
    collateralValueUsd: B(w.collateralValueUsd),
    debtValueUsd: B(w.debtValueUsd),
    collateralRatio: B(w.collateralRatio),
    liquidationRatio: B(w.liquidationRatio),
    liquidationPriceUsd: B(w.liquidationPriceUsd),
    price: fromWirePriceReading(w.price),
    params: fromWireParams(w.params),
    redemption: w.redemption ? fromWireRedemption(w.redemption) : undefined,
    maxBorrowingCapacity: Bopt(w.maxBorrowingCapacity),
    blockNumber: B(w.blockNumber),
  } as Position;
}

export function fromWireAssessment(w: Wire<RiskAssessment>): RiskAssessment {
  return {
    ...w,
    safetyMargin: B(w.safetyMargin),
    priceDeclineBuffer: B(w.priceDeclineBuffer),
    nextLevelPriceUsd: Bopt(w.nextLevelPriceUsd),
  };
}

export function fromWireRecommendation(w: Wire<Recommendation>): Recommendation {
  return {
    ...w,
    targetRatio: B(w.targetRatio),
    repayAmount: B(w.repayAmount),
    addCollateral: B(w.addCollateral),
    resultingRatioAfterRepay: B(w.resultingRatioAfterRepay),
    resultingRatioAfterAdd: B(w.resultingRatioAfterAdd),
  };
}

export function fromWireSummary(w: Wire<PortfolioSummary>): PortfolioSummary {
  return {
    ...w,
    totalCollateralUsd: B(w.totalCollateralUsd),
    totalDebtUsd: B(w.totalDebtUsd),
    debtByAsset: Object.fromEntries(Object.entries(w.debtByAsset).map(([k, v]) => [k, B(v)])),
    aggregateRatio: B(w.aggregateRatio),
    debtAtRiskUsd: B(w.debtAtRiskUsd),
    concentration: w.concentration.map((c) => ({ ...c, collateralShare: B(c.collateralShare), debtShare: B(c.debtShare) })),
  };
}

export function fromWireScenario(w: Wire<ScenarioResult>): ScenarioResult {
  return {
    ...w,
    priceUsd: B(w.priceUsd),
    collateralValueUsd: B(w.collateralValueUsd),
    collateralRatio: B(w.collateralRatio),
    priceDeclineBuffer: B(w.priceDeclineBuffer),
    repayToTarget: B(w.repayToTarget),
    addCollToTarget: B(w.addCollToTarget),
  };
}

/** Alias names used in lib/api-types.ts comments. */
export const serialize = toWire;
export const deserializePosition = fromWirePosition;
