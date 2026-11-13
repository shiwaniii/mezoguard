/**
 * Valuator + normalizer: protocol-specific pure math that turns (collateral, debt, price) into the numbers each
 * protocol actually checks. Shared by the adapters (reprice) and the engine (scenario/recommendations).
 *
 *   Trove (MUSD, all 18 dec):  CR = coll × price / debt                         (LiquityMath._computeCR)
 *   Morpho:                    CR = (coll × oraclePrice / 1e36) × 1e18 / borrowAssets
 *                              maxBorrow = floor(floor(coll × oraclePrice / 1e36) × lltv / 1e18)
 *                              liquidatable ⇔ borrowAssets > maxBorrow           (Morpho._isHealthy)
 *
 * USD conventions: `priceUsd` is USD per WHOLE collateral token, 1e18-scaled. Morpho loan assets (mUSDC, MUSD) are
 * treated as $1 — a stated assumption, so a Morpho oracle price (1e36, decimal-adjusted, loan units per collateral
 * unit) converts to USD with  usd = oraclePrice × 10^collDec / 10^loanDec / 1e18.
 */
import type { MorphoParams, Position, TroveParams } from "@/lib/risk/types";
import { INFINITE_RATIO, ORACLE_PRICE_SCALE, WAD, mulDivUp, pow10, ratio, toUsd } from "@/lib/risk/math";

export function isTrove(p: Position): p is Position & { params: TroveParams } {
  return p.params.kind === "trove";
}
export function isMorpho(p: Position): p is Position & { params: MorphoParams } {
  return p.params.kind === "morpho";
}

// ───────────────────────────── Morpho oracle ⇄ USD ─────────────────────────────

/** Morpho oracle price (1e36, decimal-adjusted) → USD per whole collateral token (1e18), loan asset = $1. Floor. */
export function morphoOracleToUsd(oraclePrice: bigint, collDecimals: number, loanDecimals: number): bigint {
  // oraclePrice = usd/1e18 × 1e36 × 10^loanDec / 10^collDec
  return (oraclePrice * pow10(collDecimals)) / (pow10(loanDecimals) * 10n ** 18n);
}

/** Inverse of morphoOracleToUsd. Floor. */
export function usdToMorphoOracle(priceUsd: bigint, collDecimals: number, loanDecimals: number): bigint {
  return (priceUsd * pow10(loanDecimals) * 10n ** 18n) / pow10(collDecimals);
}

/** Morpho: collateral value in loan-token native units (floor, as Morpho computes it). */
export function morphoCollateralInLoanUnits(collateral: bigint, oraclePrice: bigint): bigint {
  return (collateral * oraclePrice) / ORACLE_PRICE_SCALE;
}

/** Morpho: maximum borrow before liquidation (Morpho._isHealthy). */
export function morphoMaxBorrow(collateral: bigint, oraclePrice: bigint, lltv: bigint): bigint {
  return (morphoCollateralInLoanUnits(collateral, oraclePrice) * lltv) / WAD;
}

export function morphoCollateralRatio(collateral: bigint, oraclePrice: bigint, borrowAssets: bigint): bigint {
  return ratio(morphoCollateralInLoanUnits(collateral, oraclePrice), borrowAssets);
}

/** 1/LLTV as a 1e18 ratio, rounded up (so "CR < liquidationRatio" never under-reports risk). */
export function morphoLiquidationRatio(lltv: bigint): bigint {
  if (lltv === 0n) return INFINITE_RATIO;
  return mulDivUp(WAD, WAD, lltv);
}

// ───────────────────────────── Trove ─────────────────────────────

export function troveCollateralRatio(coll: bigint, debt: bigint, price: bigint): bigint {
  if (debt === 0n) return INFINITE_RATIO;
  return (coll * price) / debt;
}

// ───────────────────────────── Generic, dispatching on params.kind ─────────────────────────────

/** Collateral value expressed in debt-token native units at `priceUsd` (USD per whole collateral). */
export function collateralInDebtUnits(p: Position, collateral: bigint, priceUsd: bigint): bigint {
  if (isMorpho(p)) {
    const oracle = usdToMorphoOracle(priceUsd, p.collateralAsset.decimals, p.debtAsset.decimals);
    return morphoCollateralInLoanUnits(collateral, oracle);
  }
  // Trove: MUSD debt, BTC collateral, both 18 dec; MUSD treated by the protocol as $1.
  return (collateral * priceUsd) / pow10(p.collateralAsset.decimals);
}

/** The oracle price in protocol units for a hypothetical USD price (Morpho: 1e36 oracle; Trove: USD 1e18). */
export function protocolPrice(p: Position, priceUsd: bigint): bigint {
  if (isMorpho(p)) return usdToMorphoOracle(priceUsd, p.collateralAsset.decimals, p.debtAsset.decimals);
  return priceUsd;
}

/** CR the protocol would compute for (collateral, debt) at `priceUsd`. */
export function ratioAt(p: Position, collateral: bigint, debt: bigint, priceUsd: bigint): bigint {
  if (isMorpho(p)) return morphoCollateralRatio(collateral, protocolPrice(p, priceUsd), debt);
  return troveCollateralRatio(collateral, debt, priceUsd);
}

/**
 * Collateral USD for display/portfolio. Trove & Morpho-BTC: collateral × priceUsd. MUSD collateral: × $1.
 * (For a hypothetical price the given price is used for BTC collateral.)
 */
export function collateralUsdAt(p: Position, collateral: bigint, priceUsd: bigint): bigint {
  if (isMorpho(p) && p.collateralAsset.symbol === "MUSD") return toUsd(collateral, p.collateralAsset.decimals, WAD);
  return toUsd(collateral, p.collateralAsset.decimals, priceUsd);
}

/** Pure re-price used by both adapters' `reprice`. */
export function repricePosition(p: Position, priceUsd: bigint): { collateralValueUsd: bigint; collateralRatio: bigint } {
  return {
    collateralValueUsd: collateralUsdAt(p, p.collateralAmount, priceUsd),
    collateralRatio: ratioAt(p, p.collateralAmount, p.debtAmount, priceUsd),
  };
}

/** Returns a copy of `p` as it would look at a hypothetical collateral USD price (amounts unchanged). */
export function withPrice(p: Position, priceUsd: bigint): Position {
  const r = repricePosition(p, priceUsd);
  const params = isMorpho(p)
    ? { ...p.params, oraclePrice: protocolPrice(p, priceUsd) }
    : p.params;
  return {
    ...p,
    collateralValueUsd: r.collateralValueUsd,
    collateralRatio: r.collateralRatio,
    price: { ...p.price, usd: priceUsd },
    params,
  } as Position;
}
