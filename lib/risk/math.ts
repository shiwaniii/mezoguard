/** Pure bigint helpers shared by the risk engine and the adapters. No floats. */

export const WAD = 10n ** 18n;
/** Morpho's ORACLE_PRICE_SCALE. */
export const ORACLE_PRICE_SCALE = 10n ** 36n;
/** Returned as the ratio of a position with zero debt (mirrors Liquity's `_computeCR` returning type(uint256).max). */
export const INFINITE_RATIO = 2n ** 256n - 1n;

export const pow10 = (n: number): bigint => {
  if (!Number.isInteger(n) || n < 0) throw new Error(`pow10: bad exponent ${n}`);
  return 10n ** BigInt(n);
};

export function mulDivDown(x: bigint, y: bigint, d: bigint): bigint {
  if (d === 0n) throw new Error("mulDivDown: division by zero");
  return (x * y) / d;
}

/** Ceil division for non-negative operands (Morpho/Solady `mulDivUp`). */
export function mulDivUp(x: bigint, y: bigint, d: bigint): bigint {
  if (d === 0n) throw new Error("mulDivUp: division by zero");
  const n = x * y;
  if (n === 0n) return 0n;
  return (n + d - 1n) / d;
}

export function divUp(n: bigint, d: bigint): bigint {
  return mulDivUp(n, 1n, d);
}

export const max = (a: bigint, b: bigint) => (a > b ? a : b);
export const min = (a: bigint, b: bigint) => (a < b ? a : b);
export const clamp0 = (a: bigint) => (a < 0n ? 0n : a);

/** Rescales a native token amount between decimal bases (floor when shrinking). */
export function rescale(amount: bigint, fromDecimals: number, toDecimals: number): bigint {
  if (fromDecimals === toDecimals) return amount;
  if (toDecimals > fromDecimals) return amount * pow10(toDecimals - fromDecimals);
  return amount / pow10(fromDecimals - toDecimals);
}

/** Native amount → 1e18 USD at `priceUsd` (USD per whole token, 1e18). Floor. */
export function toUsd(amount: bigint, decimals: number, priceUsd: bigint): bigint {
  return (amount * priceUsd) / pow10(decimals);
}

/** Native amount of a $1 token → 1e18 USD. */
export function stableToUsd(amount: bigint, decimals: number): bigint {
  return rescale(amount, decimals, 18);
}

/** a / b as a 1e18 ratio (floor); INFINITE_RATIO when b == 0. */
export function ratio(a: bigint, b: bigint): bigint {
  if (b === 0n) return INFINITE_RATIO;
  return (a * WAD) / b;
}
