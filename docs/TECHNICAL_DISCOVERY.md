# Technical discovery (2026-11-09, Mezo testnet chain 31611)

Everything below was read on-chain with `cast` against `https://rpc.test.mezo.org` or from verified explorer sources.

## Network
- Chain ID 31611 (`cast chain-id`), RPC `https://rpc.test.mezo.org`, explorer `https://explorer.test.mezo.org`, Blockscout API `https://api.explorer.test.mezo.org/api/v2`.
- `eth_getLogs` is capped at ~10,000 blocks per call. Multicall3 is deployed at the canonical `0xcA11…CA11`.

## MUSD Trove protocol (Liquity-v1 style)
Addresses from `mezo-org/musd` `solidity/artifacts/deployments/matsnet/*.json`; every one has code. Proxies are EIP-1967; the implementation bytecode was checked for every selector MezoGuard calls.

| Contract | Address |
|---|---|
| MUSD | 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503 |
| BorrowerOperations | 0xCdF7028ceAB81fA0C6971208e83fa7872994beE5 (impl 0xc05b…0dcc) |
| BorrowerOperationsSignatures | 0xD757e3646AF370b15f32EB557F0F8380Df7D639e (impl 0xeec6…c235) |
| TroveManager | 0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0 (impl 0x9aab…0b07) |
| SortedTroves | 0x722E4D24FD6Ff8b0AC679450F3D91294607268fA |
| HintHelpers | 0x4e4cBA3779d56386ED43631b4dCD6d8EacEcBCF6 |
| PriceFeed | 0x86bCF0841622a5dAC14A313a15f96A95421b9366 → oracle 0x7b7c…0015 |
| InterestRateManager | 0xD4D6c36A592A2c5e86035A6bca1d57747a567f37 |
| ActivePool / DefaultPool / StabilityPool / CollSurplusPool | 0x143A…FF51 / 0x5985…3300 / 0x1CCA…680e / 0xB4C3…6fa9 |

Live parameters (read 2026-11-09): MCR 110%, CCR 150%, minNetDebt 1,800 MUSD, gas compensation 200 MUSD, redemption rate 0.75%, system interest rate 1% (100 bps), 344 open Troves, BTC price ≈ $74,1xx.

**Discovery.** One Trove per address: `TroveManager.getTroveStatus(owner) == 1` is exact and needs no indexing. `getEntireDebtAndColl(owner)` returns coll, principal, interest and pending redistribution. `getCurrentICR(owner, price)` is the protocol's own CR. Example: wallet `0x017FF5FB886E90f9e5ADb405D8eFddffC1162dD2` has an active Trove — 0.0709 BTC, 2,822.25 MUSD principal + 1.09 interest, ICR ≈ 186%.

**Price.** `PriceFeed.fetchPrice()` reads the BTC/USD precompile (`latestRoundData`, 18 dec) and **reverts if updatedAt is older than 60 s**. Observed lag: ~7 s. A revert ⇒ we mark price stale and never show the number as real-time.

**Redemptions.** `redeemCollateral` starts at `SortedTroves.getLast()` (lowest NICR) and walks `getPrev`, skipping Troves below MCR. A Trove's redemption exposure = MUSD debt of active Troves ahead of it in that walk. Fee 0.75%.

**Signed operations (automation).** `BorrowerOperationsSignatures` (EIP-712 domain `BorrowerOperationsSignatures`/`1`, chainId 31611) has per-borrower sequential nonces and deadlines. `RepayMUSD(uint256 amount,address borrower,uint256 nonce,uint256 deadline)` → `restrictedAdjustTrove(borrower, borrower, msg.sender, …)` → `_repayMUSD` **burns from `msg.sender` (the caller), not the borrower**. So a third party holding the signature can only reduce the borrower's debt using its own MUSD. This makes a repay-only, user-funded protector contract safe by construction.

## Morpho Blue (mUSDC lending) — LIVE on testnet
Not listed in Mezo docs. Found by following the Mezo USDC lending vault `0x9F9b82ab72C3418B617357f4f5E501D22366dF08` (Morpho VaultV2, asset mUSDC) → adapter `0x21A1…90eB` → `morpho()`:

- Morpho Blue: **0xCe1da828cA15cb1FDAfa84C366A53C8106655a73** (explorer-verified "Morpho", created block 13,272,318).
- mUSDC (testnet): 0xe1a26db653708A2AD8F824E92Db9852410e33A59, 6 dec. ⚠ The docs' mUSDC 0x0467…c197 is mainnet; testnet uses this one.

| Market | id | loan / collateral | oracle | LLTV |
|---|---|---|---|---|
| BTC / mUSDC (the vault's market) | 0x1a7f…0b2e | mUSDC / BTC | 0x72fB…0E6C (price ≈ $76,970) | 77% |
| BTC / MUSD | 0xf0bb…e3ff | MUSD / BTC | 0xfC1F…00Cc (≈ $73,816) | 77% |
| MUSD / mUSDC | 0x9ab3…03b5 | mUSDC / MUSD | 0x05A5…4Bfd (≈ 1.0028) | 77% |

Real borrowing activity exists (Borrow / SupplyCollateral / Repay events from several wallets). The BTC/mUSDC market had 44,570 mUSDC supplied and 10,697 mUSDC borrowed on 2026-11-09.

⚠ The Morpho oracles report different BTC prices than Mezo's PriceFeed (≈ $76,970 vs ≈ $74,130). Each protocol's risk is computed with **its own** oracle — that is what its liquidations use. The UI shows both.

**Discovery.** Morpho has no per-owner enumeration. We index `SupplyCollateral` / `Borrow` (onBehalf) since block 13,272,318 (explorer API + RPC getLogs in 10k windows) to get candidate (market, owner) pairs, then reconcile every candidate with `position(id, owner)`. Events alone never define state.

## Decisions
1. Adapters are TypeScript read services, not on-chain contracts (no security benefit from on-chain adapters).
2. One contract: `MezoGuardProtector` (repay-only automation, see IMezoGuardProtector.sol).
3. Both protocols are integrated: MUSD Trove (read + repay/add/close/adjust) and Morpho Blue (read + repay/supplyCollateral).
