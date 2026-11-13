/**
 * Client-side decoders for the HTTP API (lib/api-types.ts). bigint fields travel as decimal strings; these turn them
 * back into the frozen read model (lib/risk/types.ts) with explicit field lists, so the browser never relies on
 * server-only modules. Unknown/missing numeric fields decode to 0n rather than throwing.
 */
import type {
  MorphoParams,
  PortfolioSummary,
  Position,
  PriceReading,
  Recommendation,
  RiskAssessment,
  TroveParams,
  TroveRedemption,
} from "@/lib/risk/types";
import type { PortfolioResponse, PositionDetailResponse, ProtocolStatus, Wire } from "@/lib/api-types";

export function big(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isFinite(v)) return BigInt(Math.trunc(v));
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return BigInt(v.trim());
  return 0n;
}
const optBig = (v: unknown) => (v === undefined || v === null ? undefined : big(v));

export function decodePrice(w: Wire<PriceReading>): PriceReading {
  return { ...w, usd: big(w.usd), blockNumber: big(w.blockNumber) } as PriceReading;
}

function decodeParams(w: Wire<TroveParams | MorphoParams>): TroveParams | MorphoParams {
  if (w.kind === "trove") {
    const t = w as Wire<TroveParams>;
    return {
      ...t,
      mcr: big(t.mcr), ccr: big(t.ccr), minNetDebt: big(t.minNetDebt), gasCompensation: big(t.gasCompensation),
      borrowingRate: big(t.borrowingRate), redemptionRate: big(t.redemptionRate), tcr: big(t.tcr),
      systemColl: big(t.systemColl), systemDebt: big(t.systemDebt),
    } as TroveParams;
  }
  const m = w as Wire<MorphoParams>;
  return { ...m, lltv: big(m.lltv), oraclePrice: big(m.oraclePrice), borrowApr: optBig(m.borrowApr) } as MorphoParams;
}

function decodeRedemption(w: Wire<TroveRedemption> | undefined): TroveRedemption | undefined {
  if (!w) return undefined;
  return { ...w, debtAhead: big(w.debtAhead), debtAheadShare: big(w.debtAheadShare) };
}

export function decodePosition(w: Wire<Position>): Position {
  return {
    ...w,
    owner: w.owner as Position["owner"],
    collateralAsset: w.collateralAsset as Position["collateralAsset"],
    debtAsset: w.debtAsset as Position["debtAsset"],
    collateralAmount: big(w.collateralAmount),
    debtAmount: big(w.debtAmount),
    debtPrincipal: optBig(w.debtPrincipal),
    debtInterest: optBig(w.debtInterest),
    collateralValueUsd: big(w.collateralValueUsd),
    debtValueUsd: big(w.debtValueUsd),
    collateralRatio: big(w.collateralRatio),
    liquidationRatio: big(w.liquidationRatio),
    liquidationPriceUsd: big(w.liquidationPriceUsd),
    price: decodePrice(w.price),
    params: decodeParams(w.params),
    redemption: decodeRedemption(w.redemption),
    maxBorrowingCapacity: optBig(w.maxBorrowingCapacity),
    blockNumber: big(w.blockNumber),
  };
}

export function decodeAssessment(w: Wire<RiskAssessment>): RiskAssessment {
  return {
    ...w,
    safetyMargin: big(w.safetyMargin),
    priceDeclineBuffer: big(w.priceDeclineBuffer),
    nextLevelPriceUsd: optBig(w.nextLevelPriceUsd),
    reasons: w.reasons ?? [],
  };
}

export function decodeRecommendation(w: Wire<Recommendation>): Recommendation {
  return {
    ...w,
    targetRatio: big(w.targetRatio),
    repayAmount: big(w.repayAmount),
    addCollateral: big(w.addCollateral),
    resultingRatioAfterRepay: big(w.resultingRatioAfterRepay),
    resultingRatioAfterAdd: big(w.resultingRatioAfterAdd),
  };
}

export function decodeSummary(w: Wire<PortfolioSummary>): PortfolioSummary {
  const debtByAsset: Record<string, bigint> = {};
  for (const [k, v] of Object.entries(w.debtByAsset ?? {})) debtByAsset[k] = big(v);
  return {
    ...w,
    owner: w.owner as PortfolioSummary["owner"],
    totalCollateralUsd: big(w.totalCollateralUsd),
    totalDebtUsd: big(w.totalDebtUsd),
    debtByAsset,
    aggregateRatio: big(w.aggregateRatio),
    debtAtRiskUsd: big(w.debtAtRiskUsd),
    concentration: (w.concentration ?? []).map((c) => ({
      ...c,
      collateralShare: big(c.collateralShare),
      debtShare: big(c.debtShare),
    })),
  };
}

export interface Portfolio {
  owner: string;
  chainId: number;
  positions: Position[];
  assessments: Record<string, RiskAssessment>;
  recommendations: Record<string, Recommendation>;
  summary: PortfolioSummary;
  btcPrice: PriceReading;
  protocols: ProtocolStatus[];
  readAt: number;
}

export function decodePortfolio(r: PortfolioResponse): Portfolio {
  const assessments: Record<string, RiskAssessment> = {};
  for (const a of r.assessments ?? []) assessments[a.positionId] = decodeAssessment(a);
  const recommendations: Record<string, Recommendation> = {};
  for (const x of r.recommendations ?? []) recommendations[x.positionId] = decodeRecommendation(x);
  return {
    owner: r.owner,
    chainId: r.chainId,
    positions: (r.positions ?? []).map(decodePosition),
    assessments,
    recommendations,
    summary: decodeSummary(r.summary),
    btcPrice: decodePrice(r.btcPrice),
    protocols: r.protocols ?? [],
    readAt: r.readAt,
  };
}

export interface PositionDetail {
  position: Position;
  assessment: RiskAssessment;
  recommendation: Recommendation;
  history: { timestamp: number; btcPrice: bigint; collateralRatio: bigint; riskLevel: RiskAssessment["level"]; liquidationPrice: bigint; priceStale: boolean }[];
  historyAvailable: boolean;
}

export function decodePositionDetail(r: PositionDetailResponse): PositionDetail {
  return {
    position: decodePosition(r.position),
    assessment: decodeAssessment(r.assessment),
    recommendation: decodeRecommendation(r.recommendation),
    history: (r.history ?? []).map((h) => ({
      timestamp: Date.parse(h.timestamp),
      btcPrice: big(h.btcPrice),
      collateralRatio: big(h.collateralRatio),
      riskLevel: h.riskLevel,
      liquidationPrice: big(h.liquidationPrice),
      priceStale: h.priceStale,
    })),
    historyAvailable: r.historyAvailable,
  };
}
