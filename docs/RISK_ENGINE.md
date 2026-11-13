# Risk engine (lib/risk)

The engine is pure: bigint only, no I/O, and it does no floating-point math. Ratios and USD amounts are 1e18-scaled.
Token amounts stay in each token's native units. `lib/format` is the only place where numbers become strings.
`INFINITE_RATIO = 2²⁵⁶−1` is the CR of a position with zero debt, the same convention as Liquity's `_computeCR`.

| Module | Role |
|---|---|
| `math.ts` | `mulDivUp/Down`, `rescale`, `toUsd`, `ratio` (normalizer) |
| `valuation.ts` | protocol math: CR, Morpho oracle ⇄ USD, `repricePosition`, `withPrice` (valuator) |
| `liquidation.ts` | `liquidationPrice`, `isLiquidatable` (protocol condition) |
| `classify.ts` | `assess`, `riskScore`, thresholds |
| `scenario.ts` | `simulate`, `crCurve` |
| `recommend.ts` | repayment and collateral calculators |
| `redemption.ts` | Trove redemption-queue analyzer |
| `portfolio.ts` | `summarize` |
| `serialize.ts` | `toWire`, `fromWirePosition/Assessment/Recommendation/Summary/Scenario/PriceReading` |

## Collateral ratio and liquidation price (sources: the protocol contracts)
| | Trove (MUSD) | Morpho Blue |
|---|---|---|
| CR | `getCurrentICR` = `floor(coll × P / debt)` | `floor(coll × oracle / 1e36) × 1e18 / borrowed` |
| liquidationRatio | `MCR` (read live, 110%) | `ceil(1e36 / lltv)` (129.87%) |
| liquidatable ⇔ | `ICR < MCR` | `borrowed > floor(floor(coll × oracle / 1e36) × lltv / 1e18)` |
| liquidation price | `ceil(debt × MCR / coll)` | `ceil(borrowed × 10^cd × 1e36 / (10^ld × coll × lltv))` |
| price used | Mezo PriceFeed | that market's Morpho oracle (loan asset = $1) |

Example: 1 BTC, 40,000 MUSD, $100k, MCR 110% gives CR 250% and a liquidation price of $44,000.
Liquidation prices are **estimates**: debt keeps accruing interest, and Troves can receive redistributions. They are
rounded up so they never look better than reality.

## Levels (`assess`)
Thresholds are **multiples of the protocol's own liquidation ratio**, so one setting works for both protocols:

| level | condition | Trove (×110%) | Morpho (×129.87%) |
|---|---|---|---|
| liquidatable | protocol condition above | ICR < 110% | borrowed > maxBorrow |
| critical | CR < liqRatio × 1.10 | < 121% | < 142.9% |
| high | CR < liqRatio × 1.30 | < 143% | < 168.8% |
| watch | CR < liqRatio × 1.60 | < 176% | < 207.8% |
| healthy | otherwise | | |

`DEFAULT_THRESHOLDS = { watch: 1.6, high: 1.3, critical: 1.1 }`. These are MezoGuard's settings, not protocol parameters.
Any `t` argument also accepts `{ "mezo-musd-trove"?: T, "morpho-blue"?: T, default?: T }` for per-protocol overrides.
"liquidatable" is **only** set when the protocol condition holds; a CR exactly at MCR is critical, not liquidatable.

Other outputs of `assess`:
- `safetyMargin = CR − liqRatio`.
- `priceDeclineBuffer = (price − liqPrice) / price` (0 when price is at or below liqPrice).
- `nextLevelPriceUsd = liqPrice × multiplier(nextLevel)`. CR is linear in price, so the price at which CR = liqRatio·m
  is liqPrice·m.
- `stale = price.stale`. When it is set, the reasons say the level was computed from the last known price and is
  **unverified**, and they include the adapter's `staleReason`. Other reasons cover: CR versus liquidation, the
  liquidation price and buffer, the oracle and $1 assumption for Morpho, Recovery Mode (Trove), and redemption exposure
  when it is moderate or high.
- Positions that are closed or have zero debt are healthy and carry an explanatory reason.

## Risk score (`riskScore`, 0..100 integer)
`m = CR / liqRatio`. `score = round((2 − m) × 100)` clamped to [0, 100]. So m ≥ 2 gives 0, 1.6 gives 40, 1.3 gives 70,
1.1 gives 90, and 1.0 gives 100. Additions for Troves: Recovery Mode +5, redemption exposure moderate +3 or high +8.
Anything that is not liquidatable is capped at 99. Liquidatable is 100.

## Recommendations (`recommend`; all marked `kind: "estimate"`)
`targetRatio` defaults to `liqRatio × DEFAULT_TARGET_MULTIPLIER (1.6)`, which is 176% for a Trove and 207.8% for Morpho
at 77% LLTV.
- **Repay:** `CollValue` is collateral valued in debt-token units at the current price. `targetDebt = floor(CollValue ×
  1e18 / target)`, and `repay = max(0, debt − targetDebt)`.
- **Trove constraint:** `maxRepay = max(0, debt − gasComp − minNetDebt)`. If `repay > maxRepay`, then `repayAmount =
  maxRepay`, `repayFeasible = false`, and `repayNote` explains the minimum net debt and suggests closing (cost `debt −
  gasComp`) or adding collateral.
- **Add collateral (rounded up, exact inversion of the protocol's floor math):**
  - Trove: `ceil(debt × target / P) − coll`.
  - Morpho: `V = ceil(debt × target / 1e18)`, then `ceil(V × 1e36 / oracle) − coll`. One unit less does **not** reach
    the target (tested).
- `resultingRatioAfterRepay` and `resultingRatioAfterAdd` are recomputed with the protocol formula. Results are never
  negative, and 0 when the position is already at or above the target.

## Scenarios (`simulate`, `crCurve`)
`simulate` calls `adapter.reprice(p, priceUsd)`. For Morpho it converts the USD price back to an oracle price, then
re-runs `assess`, the buffer, and the repay and collateral targets at that price. Hypothetical prices are never marked
stale. `crCurve` returns `steps + 1` evenly spaced points.

## Redemption exposure (Trove)
`debtAhead` is the MUSD debt of Troves with a lower NICR and `ICR ≥ MCR`. `share = debtAhead / systemDebt`.
`share < 5%` is **high**, `< 20%` is **moderate**, otherwise **low** (MezoGuard heuristics). Exposure means the Trove can
be redeemed against, which swaps BTC for MUSD at par minus the fee. That is not a loss beyond the debt, so it only adds to
the score and is never a liquidation level.

## Portfolio (`summarize`)
Only active positions are included. Collateral and debt USD are summed. `aggregateRatio = Σ collUSD / Σ debtUSD`, a
debt-weighted value and **not** an average of ratios. `riskScore` = the debt-USD-weighted mean of position scores.
`level` = the worst level. `highestRiskPositionId` = the worst level, with ties broken by lowest `CR/liqRatio`.
`debtAtRiskUsd` = debt in positions at high or worse. `concentration` = each position's share of collateral and debt
USD. `stale` = true if any position is stale. `debtByAsset` is in native units per symbol (MUSD 18, mUSDC 6). Note:
Morpho collateral USD uses Mezo's PriceFeed, while Morpho CR uses the Morpho oracle, so the aggregate ratio is an
indicator. Liquidation is always per position.
