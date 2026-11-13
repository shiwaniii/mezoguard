# MezoGuard — Security

> Sections below are owned by different agents. "Contract" and "Automation" are owned by the Solidity agent;
> other sections (web app, sessions, API, worker) are added by their owners.

## Contract: MezoGuardProtector

Source: `contracts/src/MezoGuardProtector.sol` (implements the frozen `contracts/src/interfaces/IMezoGuardProtector.sol`).
Mezo semantics referenced below come from `research/musd/` (mezo-org/musd source).

### What the contract is

A per-borrower vault of MUSD ("budget") plus ONE stored EIP-712 `RepayMUSD` signature that the borrower made for
`BorrowerOperationsSignatures` (BOS, `0xD757…639e`). When the Trove's live ICR drops below the borrower's trigger,
an allowed caller runs `executeRepay`, and the protector calls `BOS.repayMUSDWithSignature`. BOS forwards to
`BorrowerOperations.restrictedAdjustTrove(borrower, borrower, msg.sender = protector, …)`, and `_repayMUSD`
**burns MUSD from the caller (the protector)**, not from the borrower. MUSD's `burn` is gated by its `burnList`
(BorrowerOperations is on it) and needs **no allowance**, so the protector never approves anything.

### Properties

| Property | How it's enforced |
|---|---|
| No admin | No owner, no roles, no pause, no upgrade proxy, no `selfdestruct`, no delegatecall. Constructor addresses are `immutable`. |
| Only the borrower moves their budget | `withdraw` / `revoke` act on `msg.sender`'s rule only. The only other outflow is the repay burn inside `executeRepay`. |
| Repay-only | The only external write call is `repayMUSDWithSignature`. A `RepayMUSD` signature can only reduce debt; it cannot withdraw collateral, borrow, or pick a recipient. |
| Budget-capped | `executeRepay` requires `budget >= repayAmount` and subtracts exactly `repayAmount`. It then checks that the protector's MUSD balance fell by **exactly** `repayAmount` (`UnexpectedBurn` otherwise), so a misbehaving downstream contract can never eat other borrowers' budgets. |
| Trigger-gated | `icrBefore = TroveManager.getCurrentICR(borrower, PriceFeed.fetchPrice())` must be `< triggerIcr` (strict). Trigger is bounded to `[1.2e18, 10e18]`: a trigger at the 110% MCR would only fire once anyone can already liquidate the Trove. |
| Predicts BorrowerOperations | Before calling BOS, `executeRepay` requires an active Trove, `debt − 200 MUSD − repayAmount ≥ BorrowerOperations.minNetDebt()` (read live) and, outside Recovery Mode, `ICR after repay ≥ 110%` (`TroveNotActive`, `RepayBelowMinNetDebt`, `RepayLeavesIcrBelowMcr`). `arm` checks the Trove status and minimum net debt too, and `canExecute` reports all three. |
| One live signature | `arm` records the nonce and deadline of every signature it accepts (`lastSignedNonce`, `lastSignedDeadline`, never cleared) and reverts `PreviousSignatureLive` while the previous one is still usable at BOS (same nonce, deadline not passed). Deadlines are capped at `MAX_SIG_DURATION` (90 days). |
| Closed Trove | `executeRepay` reverts `TroveNotActive` once the Trove is closed, liquidated or redeemed, and anyone can call `disarmIfClosed(borrower)`. The budget stays with the borrower. |
| Must help | `icrAfter > icrBefore` at the same price, else `NoImprovement` (also rejects dust repays that don't move the integer ICR). |
| One-shot | Rule is disarmed and the signature deleted before the external call; BOS consumes the nonce. A second `executeRepay` reverts `NotArmed`. |
| Garbage rejected at arm time | `arm` rebuilds the BOS digest (`getNonce(msg.sender)`, typehash `RepayMUSD(uint256 amount,address borrower,uint256 nonce,uint256 deadline)`, `keccak256(abi.encodePacked(typeHash, abi.encode(amount, borrower), nonce, deadline))`, domain `BorrowerOperationsSignatures`/`1`/chainId/BOS) and requires `ECDSA.tryRecover == msg.sender`. So you can only arm with your own signature for your own trove, current nonce, exact amount and deadline. |
| Reentrancy | Every state-changing function is `nonReentrant` (OZ `ReentrancyGuard`; transient storage isn't available on the london EVM target). Checks-effects-interactions in `executeRepay`. |
| Accounting | Invariant tested: sum of budgets == protector MUSD balance; deposits − withdrawals − burns == balance. |

### Who can do what

| Actor | Can | Cannot |
|---|---|---|
| Borrower | deposit, withdraw (any time, even while armed), arm (only when no earlier signature is still live), revoke (disarm + full refund), cancel the stored signature at BOS with any signed BOS op (the app sends a 1-wei `RepayMUSD`) | Move anyone else's budget |
| Executor / keeper (anyone if `executor == 0`) | Call `executeRepay` when every check passes; choose hints | Change the amount, the trove or the recipient; run it above trigger, after expiry, twice, or with someone else's budget **through the protector** |
| Anyone else | Read rules (the signature is public in storage and calldata); submit that signature to BOS directly with their own MUSD (threat 2); call `disarmIfClosed` for a closed Trove | Withdraw, re-arm, revoke for someone else |
| MUSD / BOS / BorrowerOperations / TroveManager / PriceFeed | Trusted system contracts set once at deploy | — |

### Threats and worst cases

1. **Signature replay.** BOS uses sequential per-borrower nonces and checks deadlines. Once a repay goes through (from
   the protector or anyone else) the nonce moves on and the stored signature is dead. The protector disarms on
   execution, and re-arming with an old signature fails at `arm` (`InvalidSignature`). Cross-chain replay is ruled
   out by `chainId` in the domain; cross-contract replay by `verifyingContract = BOS`.
2. **Submitting the signature directly to BOS.** The signature is public once armed, and BOS's `RepayMUSD` digest has
   no caller field, so **the trigger and the executor limit only calls through the protector.** Anyone can submit
   the signature to `BOS.repayMUSDWithSignature` at any ICR before its deadline, paying with **their own** MUSD. The
   borrower's debt falls and their budget is untouched, but the nonce is consumed, so the armed rule can no longer
   run. An attacker could pay that cost to switch protection off and later liquidate the Trove for the gas
   compensation if the price falls. The protector cannot close this alone (it needs a caller field in BOS).
   Mitigations: deadlines are capped at 90 days, `canExecute` reports `"signature invalidated (nonce changed)"`, and
   the app prompts the borrower to re-arm. Tested in `test_frontRunDirectlyOnBOS_onlyBurnsFrontRunnersMUSD`.
3. **Griefing the keeper.** Any BOS signed op by the borrower (or a front-run as above) makes the next
   `executeRepay` revert inside BOS. Cost to the keeper is gas only. `canExecute` reports
   `"signature invalidated (nonce changed)"` by comparing `armedNonce` with `BOS.getNonce`, so keepers should
   simulate or check `canExecute` before sending.
4. **Trigger manipulation through price.** ICR uses `PriceFeed.fetchPrice()`, which reads Mezo's BTC/USD oracle
   precompile and reverts when it's more than 60 s stale. A caller can't pick the price. If the oracle reports a
   low price, the repay goes through, but the only result is the borrower's own pre-authorised repayment of
   their own debt from their own budget. Nothing is extracted. Worst case: an earlier-than-wanted repay of
   exactly `repayAmount`.
5. **Hints.** The executor supplies `upperHint`/`lowerHint`. Bad hints only cost gas in `SortedTroves.reInsert`
   (Liquity falls back to a list walk) and can't change the result.
6. **BorrowerOperations-side reverts (the rule stays armed and the budget intact, because the whole tx reverts):**
   - **Min net debt:** a repay that leaves net debt (`debt − 200 MUSD gas compensation − amount`) below
     `minNetDebt` (1,800 MUSD on testnet) would revert in BorrowerOperations. `arm` refuses such an amount, and if
     debt later falls (another repay), `executeRepay` reverts `RepayBelowMinNetDebt` before calling BOS.
   - **Normal Mode MCR check:** in Normal Mode `_adjustTrove` requires `newICR >= MCR (110%)` even for a pure repay.
     The 120% trigger floor means the rule normally fires while the repay can still succeed; after a large price gap
     `executeRepay` reverts `RepayLeavesIcrBelowMcr` and `canExecute` says so.
   - **Recovery Mode** (TCR < 150%): pure repayments are allowed without the MCR check, so the protector skips it too.
   - **Trove closed / liquidated / redeemed:** `executeRepay` reverts `TroveNotActive` and anyone can call
     `disarmIfClosed`, so the rule cannot carry over to a later Trove at the same address. The app's close flow
     revokes the rule before `closeTrove`.
   - **Stale price:** `fetchPrice` reverts. `executeRepay` reverts and `canExecute` reports `"price unavailable"`.
7. **Over-repayment.** BorrowerOperations does **not** cap a repay: one above `debt − gas compensation` reverts
   (`_requireValidMUSDRepayment`). The minimum-net-debt check above already rejects such amounts first. On success the
   burn equals `repayAmount` exactly (principal + interest adjustment sum to the payment in
   `InterestRateMath.calculateDebtAdjustment`).
8. **Fee-on-transfer / rebasing token.** Not applicable: MUSD is a plain ERC-20. `deposit` credits `amount`
   without balance-delta accounting, which is fine for MUSD only. The token address is immutable.
9. **Funds stuck.** No path locks budget: `withdraw`/`revoke` have no conditions beyond the caller's own balance.
   MUSD sent to the contract by plain `transfer` (not `deposit`) isn't credited to anyone and can't be recovered.
   That's the accepted cost of having no admin.
10. **Mezo system upgrades.** BOS, BorrowerOperations and TroveManager are upgradeable proxies controlled by Mezo
    governance. A malicious or buggy upgrade is outside this contract's control. The exact-burn check limits the
    protector's exposure to at most one rule's `repayAmount` per call.

### Not checked on-chain (documented, by design)

- `canExecute` does not check `executor` (it depends on who's calling). It does predict Trove status, minimum net
  debt and the Normal-Mode MCR rule. Keepers should still `eth_call` `executeRepay` before sending.
- `revoke` cannot cancel the signature at BOS (only the borrower can move their BOS nonce). The app follows `revoke`
  with a signed 1-wei `RepayMUSD` the borrower sends themselves; without it the signature stays usable at BOS until
  its deadline (threat 2), though the protector itself will no longer run it.
- There's no minimum `repayAmount`. Dust rules arm fine but can only end in `NoImprovement`.

### Verification artefacts

- Unit + fuzz + invariant tests: `contracts/test/MezoGuardProtector.t.sol`, `contracts/test/Invariant.t.sol`, with
  mocks in `contracts/test/mocks/MezoMocks.sol` that port BOS `_verifySignature` verbatim (OZ EIP712 with the same
  name/version) and the BorrowerOperations repay checks.
- Opt-in fork tests against the real Mezo contracts: `MEZO_FORK=true forge test --mc Fork` (not part of the default
  run). `ForkTest` checks the domain and that the real `_verifySignature` accepts our digest; `ForkE2ETest` opens a
  real Trove (PriceFeed mocked, the precompile can't run on a fork) and covers a keeper repay after 30 days of
  interest, the min-net-debt refusal at `arm`, the live-signature refusal and `closeTrove` + `disarmIfClosed`.
- Audit: Pashov solidity-auditor, 2 passes × 12 agents (2026-11-12); all 6 findings fixed as described above.

## Automation limits

- **One shot per signature.** Each signed `RepayMUSD` covers one repayment of one exact amount. After it fires, the
  user has to sign and arm again. There's no recurring or "repay until target" mode, because each repayment needs
  a fresh nonce-bound signature.
- **Expiry.** The signature deadline is also the rule's expiry. After it, `executeRepay` reverts `Expired`. Long
  deadlines keep a valid repay authorisation around longer, but the worst case is still the user repaying their
  own debt from their own budget.
- **Needs a live keeper.** Nothing on-chain fires by itself. If MezoGuard's worker (or any keeper) is down, the
  protection doesn't run. Liquidation (ICR < 110%) is open to anyone and can land before a keeper does. Choose a
  trigger well above 110% so there's time to react.
- **Oracle freshness.** The PriceFeed reverts when the oracle is more than 60 s old. Execution waits for a fresh
  price, and so does liquidation.
- **Any other signed BOS operation cancels the rule in practice.** It bumps the nonce, and `canExecute` reports it.
  The UI prompts the user to re-arm.
- **Budget isn't reserved.** A user can withdraw below `repayAmount` while armed. The rule then reports
  `"insufficient budget"` until topped up.
- **Executor restriction is optional, and only binds the protector path.** With `executor = 0` anyone may run the
  repay through the protector once the trigger is hit (same outcome no matter who calls). Either way, the signature
  itself can be submitted to BOS by anyone (threat 2).

## Wallets and sign-in (Mezo Passport)
- Wallet connection uses Mezo Passport (`@mezo-org/passport` 0.17.2, wagmi 2 + RainbowKit). Bitcoin wallets get an
  OrangeKit smart account (a Safe at a CREATE2 address derived from the Bitcoin key); Ethereum wallets connect directly.
- Sign-in accepts either an EIP-191 signature from the address, or a BIP-137 Bitcoin signature whose recovered key
  owns the OrangeKit Safe at that address (`lib/server/bitcoin-signin.ts`: hash160 → CREATE2 from factory
  0x7E80…1052). The prediction matches the live factory's `predictAddresses` on Mezo testnet (LIVE test).
  Taproot addresses are not supported, matching OrangeKit.
- Smart-account transactions are relayed, so `/api/actions` also accepts a tx sent to the wallet's own Safe that
  emitted `ExecutionSuccess` and touched BorrowerOperations, TroveManager, Morpho or the protector.
- Repay automation needs an EOA: `BorrowerOperationsSignatures` verifies with `ECDSA.recover`, and Passport smart
  accounts can't sign EIP-712. The UI says so instead of offering the form.
