# Mezo integration (lib/protocols)

All reads go to Mezo testnet (chain 31611, `https://rpc.test.mezo.org`). Addresses come only from `lib/chain/config.ts`;
ABIs only from `lib/chain/abis.ts` (plus two Multicall3 view helpers, `getBlockNumber` and `getCurrentBlockTimestamp`,
declared locally in `lib/protocols/client.ts`). Every on-chain fact here was checked with `cast` on 2026-11-09.

## Client (`client.ts`)
- viem `http` transport: `retryCount: 4`, `retryDelay: 300` (viem's exponential backoff: 300/600/1200/2400 ms), `timeout: 20 s`.
- `batch.multicall` (Multicall3 `0xcA11…CA11`, 24 KB calldata per chunk, 10 ms coalescing window). Adapters also call
  `client.multicall` explicitly, so each logical read happens in one `eth_call` and therefore one block.
- `getLogsChunked`: splits `[from, to]` into windows with `to − from ≤ LOG_RANGE_CAP` (9,999). The RPC rejects larger
  ranges with "maximum [from, to] blocks distance: 10000". Windows run with a concurrency limit (default 12). Raw topics,
  so any indexed slot can be filtered and topic0 can be an OR-list.

## BTC price (`price.ts`)
One multicall in one block reads:
| Call | Purpose |
|---|---|
| `PriceFeed.fetchPrice()` | The price MUSD uses. Reverts if `block.timestamp − updatedAt > 60` (PriceFeed.sol L51). |
| `oracle.latestRoundData()` (precompile `0x7b7c…0015`) | `answer`, `updatedAt` (provenance) |
| `oracle.decimals()` | Scaling, same as `PriceFeed._scalePriceByDigits` (18 on testnet) |
| Multicall3 `getBlockNumber` / `getCurrentBlockTimestamp` | Block reference |

- `fetchPrice` succeeds: `{ usd: fetchPrice, source: "mezo-pricefeed", stale: false, updatedAt: oracle updatedAt }`.
- `fetchPrice` reverts: `{ usd: scale(answer), source: "mezo-oracle-precompile", stale: true, staleReason }`. The reason
  gives the oracle age in seconds when that age is over 60 s.
- The precompile also fails, `answer ≤ 0`, or `decimals()` fails: **throws**. We never make up a price.

## MUSD Trove (`mezo-trove.ts`)
**Discovery.** `TroveManager.getTroveStatus(owner)` (one Trove per address). `1` means active. Discovery returns only
active Troves. `refresh()` maps `2/3/4` to `closed/liquidated/redeemed` and `0` to `null`.

**Read** (one multicall, one block, at price `P` from `readBtcPrice`):
`getTroveStatus, getEntireDebtAndColl, getCurrentICR(owner, P), getTroveInterestRate, getTroveMaxBorrowingCapacity`,
`BorrowerOperations.MCR, CCR, minNetDebt, MUSD_GAS_COMPENSATION, borrowingRate, redemptionRate`,
`TroveManager.checkRecoveryMode(P), getTCR(P), getEntireSystemColl, getEntireSystemDebt`, block number.

**Debt and collateral.** `getEntireDebtAndColl` already adds pending redistribution into the `coll`, `principal` and
`interest` it returns (TroveManager.sol L797-801: `coll += pendingCollateral; principal += pendingPrincipal; interest +=
pendingInterest`). It also includes interest accrued up to `block.timestamp`. So:

```
debt = principal + interest          coll = coll
```

Adding the `pending*` outputs again would double-count. (The task brief said `principal+interest+pendingPrincipal+
pendingInterest`; the source code shows that is wrong.) This matches `_getCurrentTroveAmounts`, which is what
`getCurrentICR` uses, so `collateralRatio = getCurrentICR(owner, P) = floor(coll × P / debt)`. The LIVE test asserts this.

- `liquidationRatio = MCR`. `liquidationPriceUsd = ceil(debt × MCR / coll)`.
- `collateralValueUsd = coll × P / 1e18`. `debtValueUsd = debt` (MUSD is the protocol's $1 unit).
- Liquidation condition: `ICR < MCR`. Mezo's TroveManager has no Recovery-Mode liquidation at CCR (L1148 is the only
  check). Recovery Mode is still reported because it blocks some operations.

**Redemption exposure.** `redeemCollateral` starts at `SortedTroves.getLast()` (lowest NICR), walks `getPrev`, and skips
ICR < MCR. `getPrev` is sequential, so walking 344 Troves would take 344 dependent round trips. Instead we read the
TroveOwners array (`getTroveOwnersCount` + `getTroveFromTroveOwnersArray(i)`, which holds the same members: active
Troves) plus `getNominalICR`, `getCurrentICR(P)` and `getEntireDebtAndColl` for each, all in batched multicalls. Then we
sort by NICR, the key SortedTroves uses. Sanity check: `SortedTroves.getSize()` must equal the owner count, and the NICR
of `getLast()` must equal the minimum NICR. If either check fails, we walk the list for real. The result is cached for
30 s. `debtAhead` = the sum of debt of Troves earlier in that order with `ICR ≥ MCR`. The thresholds are in RISK_ENGINE.md.
NICR ties are broken by address, which is an approximation: the on-chain order between equal NICRs depends on insertion
order.

**Pure helpers for transaction forms.**
- `maxRepay(p) = max(0, debt − gasComp − minNetDebt)`. Source: `_requireAtLeastMinNetDebt(_getNetDebt(debt) − repay)`
  and `_requireValidMUSDRepayment`.
- `closeCost(p) = debt − gasComp`. `closeTrove` burns `debt − MUSD_GAS_COMPENSATION` from the caller; the gas
  compensation comes from the GasPool.
- `getHints(client, coll, principal)`: `NICR = coll × 1e20 / principal`, then `HintHelpers.getApproxHint(NICR, max(15,
  15·√size), seed)`, then `SortedTroves.findInsertPosition(NICR, hint, hint)`. The frozen signature names the second
  argument `debt`, but callers must pass the resulting **principal**, because NICR ignores interest.

## Morpho Blue (`morpho.ts`, `morpho-math.ts`)
**Markets.** `MORPHO_MARKETS` ∪ `CreateMarket` events, with params re-read via `idToMarketParams`. On-chain params win
over config, and a warning is pushed if they differ. Markets outside the allowlist are supported only when their tokens
are among {BTC, MUSD, mUSDC}, because those are the only tokens we can value. Others are skipped with a warning in
`morphoWarnings`.

**Owner candidates** (events only produce candidates; state always comes from `position(id, owner)`):
- RPC: one global index scanned from `MORPHO.deployBlock` (13,272,318) with topic0 ∈ {CreateMarket, Borrow,
  SupplyCollateral}. That is about 340 windows of 10k blocks at concurrency 12. It records `onBehalf` (Borrow `topic2`,
  SupplyCollateral `topic3`) → market ids, plus created markets. The cursor is kept in memory and later calls only scan
  the new blocks. One index serves every owner. This replaces the per-owner cursor from the brief, because a per-owner
  scan costs about 680 requests for each new wallet.
- Blockscout: `https://api.explorer.test.mezo.org/api?module=logs&action=getLogs` (Etherscan-compatible). It **does**
  filter by topic over the full range in one request (`topic0` + `topic2`/`topic3`, `topic0_N_opr=and`). The v2
  `/addresses/{a}/logs` endpoint does not filter. If a response hits 1,000 results we treat it as truncated, which counts
  as a failure.
- Policy: if Blockscout answers and the RPC index has not finished its first scan, discovery does not wait (the index
  keeps warming in the background). Otherwise it waits for the index (incremental, fast). If both fail, it throws, and
  `discoverAll` reports `status: "error"`.
- `position(id, owner)` is then read for **every** known market plus the candidates (only a handful of markets). So
  discovery is exact whenever the market list is complete. Positions with zero borrow and zero collateral are dropped.

**Debt (mirrors Morpho exactly).** Per market, in one block: `position`, `market`, `oracle.price()`, block number and
timestamp. Then `IRM.borrowRateView(params, market)` is pinned to the same block number.

```
elapsed   = blockTimestamp − lastUpdate
interest  = wMulDown(totalBorrowAssets, wTaylorCompounded(rate, elapsed))   # x·n + (x·n)²/2 + (x·n)³/6, floor each
borrowed  = mulDivUp(borrowShares, totalBorrowAssets + interest + 1, totalBorrowShares + 1e6)   # toAssetsUp
```
(The fee mints supply shares only, so it does not change the borrow side.)

**Risk numbers (Morpho oracle: 1e36-scaled, decimal-adjusted, loan units per collateral unit).**
```
collInLoan  = floor(collateral × oraclePrice / 1e36)
CR          = collInLoan × 1e18 / borrowed
maxBorrow   = floor(collInLoan × lltv / 1e18);  liquidatable ⇔ borrowed > maxBorrow     (Morpho._isHealthy)
liqRatio    = ceil(1e36 / lltv)                                                         (129.87% for 77%)
oracleUsd   = oraclePrice × 10^collDec / 10^loanDec / 1e18            (USD per whole collateral, loan asset = $1)
liqPriceUsd = ceil(borrowed × 10^collDec × 1e36 / (10^loanDec × collateral × lltv))
```
- `Position.price` is the **Morpho oracle** (`source: "morpho-oracle"`, `updatedAt` = block timestamp, `stale: false`,
  because Morpho oracles expose no staleness rule). Liquidations use this price. Testnet BTC/mUSDC reads about $76,970
  while Mezo's PriceFeed reads about $74,100.
- `collateralValueUsd`: BTC collateral × the Mezo PriceFeed price (falls back to the oracle's USD if PriceFeed is
  unreadable). MUSD collateral × $1. `debtValueUsd = borrowed` rescaled to 1e18 at $1.
- **Assumption:** mUSDC and MUSD loan assets are worth exactly $1. Stated in the UI.

## Live test
`LIVE=1 npx vitest run tests/protocols/live.test.ts`
- Trove `0x017F…2dD2`: checks `floor(coll × P / (principal + interest)) == getCurrentICR` inside one multicall, and checks
  the adapter's CR against `getCurrentICR` at the position's block.
- Morpho: discovers `0x09aB…eD06` (BTC/mUSDC) and `0xD13F…6c67` (MUSD/mUSDC) with the full RPC index, then confirms
  with `refresh`.

**Status: written, not run** (the owner instructed no live runs).
