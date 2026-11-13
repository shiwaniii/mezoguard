/**
 * Display formatting — the ONLY place bigint becomes a display string. All math stays bigint; nothing here is fed back
 * into calculations. Rounding is half-up at the last shown digit.
 */

const INFINITE_THRESHOLD = 10n ** 60n; // anything this large is the "zero debt" sentinel (INFINITE_RATIO)

function groupThousands(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Rounds |v| (scaled by 10^decimals) half-up to `frac` decimals and renders it with thousands separators. */
function renderAbs(v: bigint, decimals: number, frac: number, minFrac = 0): string {
  if (frac > decimals) frac = decimals;
  const drop = decimals - frac;
  let scaled = v;
  if (drop > 0) {
    const d = 10n ** BigInt(drop);
    scaled = (v + d / 2n) / d;
  }
  const base = 10n ** BigInt(frac);
  const intPart = (scaled / base).toString();
  let fracPart = frac > 0 ? (scaled % base).toString().padStart(frac, "0") : "";
  // trim trailing zeros down to minFrac
  while (fracPart.length > minFrac && fracPart.endsWith("0")) fracPart = fracPart.slice(0, -1);
  return fracPart.length ? `${groupThousands(intPart)}.${fracPart}` : groupThousands(intPart);
}

/** Token amount in native units → "1,234.5678" (trailing zeros trimmed). */
export function fmtUnits(v: bigint, decimals: number, maxFrac = 4): string {
  const neg = v < 0n;
  const s = renderAbs(neg ? -v : v, decimals, maxFrac);
  return neg && s !== "0" ? `-${s}` : s;
}

/** 1e18 USD → "$74,123.45" (always 2 decimals). */
export function fmtUsd(v1e18: bigint): string {
  const neg = v1e18 < 0n;
  const s = renderAbs(neg ? -v1e18 : v1e18, 18, 2, 2);
  return neg && s !== "0.00" ? `-$${s}` : `$${s}`;
}

/** 1e18 ratio → "186.2%". Zero-debt sentinel → "∞". */
export function fmtRatio(v1e18: bigint): string {
  if (v1e18 >= INFINITE_THRESHOLD) return "∞";
  const neg = v1e18 < 0n;
  // ratio × 100 as a 1e18 number, one decimal
  const s = renderAbs((neg ? -v1e18 : v1e18) * 100n, 18, 1, 1);
  return `${neg ? "-" : ""}${s}%`;
}

/** 1e18 fraction → "12.34%" (up to maxFrac decimals, trailing zeros trimmed). */
export function fmtPct(frac1e18: bigint, maxFrac = 2): string {
  if (frac1e18 >= INFINITE_THRESHOLD) return "∞";
  const neg = frac1e18 < 0n;
  const s = renderAbs((neg ? -frac1e18 : frac1e18) * 100n, 18, maxFrac);
  return `${neg && s !== "0" ? "-" : ""}${s}%`;
}

/**
 * Parses a user-typed decimal ("1,234.5", "0.01") into native units. Returns null for anything invalid, negative,
 * or with more fractional digits than `decimals`.
 */
export function parseUnitsSafe(str: string, decimals: number): bigint | null {
  if (typeof str !== "string") return null;
  const s = str.trim().replace(/,/g, "").replace(/_/g, "");
  if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const [i, f = ""] = s.split(".");
  if (f.length > decimals) return null;
  try {
    return BigInt(i || "0") * 10n ** BigInt(decimals) + BigInt((f || "").padEnd(decimals, "0") || "0");
  } catch {
    return null;
  }
}
