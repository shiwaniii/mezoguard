# Run 1 — solidity-auditor

<!--RUN pass=1 of=2 stamp=20261112-165006 sha=edec6e7 agents=12/12-->

Pass 1 of 2 · 2026-11-12 · `edec6e7` · 12/12 agents returned.

## Findings

<!--F key=mezoguardprotector|executerepay|caller-agnostic-signature conf=75 kind=FINDING agents=10-->

[75] **Any caller can submit the stored repay signature to BorrowerOperationsSignatures**

`MezoGuardProtector.executeRepay` · Confidence: 75

**Description**
Any MUSD holder reads the signature from `ruleOf` and calls `repayMUSDWithSignature` directly, so the trigger and executor checks do not run and the rule stops working.

**Fix**

```diff
-/// The only possible effect on the user is debt reduction from their own pre-deposited budget.
+/// The trigger and executor limit only calls through this contract. The stored signature is public, and any
+/// MUSD holder can submit it to BorrowerOperationsSignatures with their own MUSD at any ICR before the deadline.
+/// That repays the borrower's debt, uses the nonce and disarms the rule. Use a short sigDeadline.
```

<!--/F-->

<!--F key=mezoguardprotector|executerepay|bos-repay-revert-unpredicted conf=75 kind=FINDING agents=3-->

[75] **The protector accepts rules that BorrowerOperations rejects when they run**

`MezoGuardProtector.executeRepay` · Confidence: 75

**Description**
The protector accepts a 110% trigger and does not check minimum net debt, so in Normal Mode the keeper repay reverts exactly when the Trove needs it.

**Fix (Option A — restrict the trigger floor)**:

```diff
-    uint256 public constant MIN_TRIGGER_ICR = 1.1e18;
+    uint256 public constant MIN_TRIGGER_ICR = 1.2e18;
```

**Fix (Option B — validate the repay before it runs)**:

```diff
+        (uint256 debt, uint256 coll) = _troveDebtAndColl(borrower);
+        if (debt - r.repayAmount < MUSD_GAS_COMPENSATION + MIN_NET_DEBT) revert RepayBelowMinNetDebt();
+        if (coll * price / (debt - r.repayAmount) < MCR) revert RepayLeavesIcrBelowMcr();
```

<!--/F-->

<!--F key=mezoguardprotector|revoke|revoke-leaves-signature-live conf=75 kind=FINDING agents=8-->

[75] **Revoke does not cancel the stored signature**

`MezoGuardProtector.revoke` · Confidence: 75

**Description**
The borrower calls `revoke`, but the BorrowerOperationsSignatures nonce does not change, so any MUSD holder can still use the signature until its deadline.

**Fix**

```diff
-/// Revocation: `revoke()` disarms and refunds the remaining budget immediately. The user can also invalidate the
-/// stored signature by any other signed operation (nonce bump).
+/// Revocation: `revoke()` disarms and refunds the remaining budget. It does NOT cancel the signature at
+/// BorrowerOperationsSignatures: the signature stays valid until its deadline or until the borrower signs another
+/// BorrowerOperationsSignatures operation. The app must ask the borrower for that nonce bump after revoke.
```

<!--/F-->

<!--F key=mezoguardprotector|arm|rule-survives-trove-close conf=75 kind=FINDING agents=3-->

[75] **An armed rule stays active after the borrower closes the Trove**

`MezoGuardProtector.arm` · Confidence: 75

**Description**
`closeTrove` and `openTrove` do not change the signature nonce, so after a close and reopen any keeper uses the old rule on the new Trove.

**Fix**

```diff
+        // in the app's close-Trove flow, before closeTrove:
+        if (rule.armed) await write({ address: protector, abi: protectorAbi, functionName: "revoke" });
```

<!--/F-->

## Leads

<!--F key=mezoguardprotector|arm|caller-agnostic-signature kind=LEAD agents=1-->

- **The arm function stores the repay signature in public storage** — `MezoGuardProtector.arm` — Code smells: `ruleOf` returns the signature; the interface says the only effect is a repay from the user's budget. — `arm` makes the signature readable, so any caller can repay the debt with their own MUSD. The user does not lose funds.

<!--/F-->

<!--F key=mezoguardprotector|executerepay|rule-survives-trove-close kind=LEAD agents=1-->

- **The rule keys on the borrower address, not on the Trove** — `MezoGuardProtector.executeRepay` — Code smells: `_rules` mapping by address; no Trove snapshot. — A new Trove at the same address receives the old repay. We did not run the close and reopen on a fork.

<!--/F-->

<!--F key=mezoguardprotector|executerepay|keeper-liveness-enables-liquidation kind=LEAD agents=1-->

- **A single offline executor leaves the Trove without protection** — `MezoGuardProtector.executeRepay` — Code smells: executor check at line 141; liquidation is open to anyone. — When the named executor is offline, the rule never runs and a liquidator can close the Trove first. We did not measure keeper uptime.

<!--/F-->

<!--F key=mezoguardprotector|executerepay|dust-repay-no-improvement kind=LEAD agents=1-->

- **A very small repay always reverts with NoImprovement** — `MezoGuardProtector.executeRepay` — Code smells: floored `getCurrentICR` comparison. — For a 60,000 MUSD Trove a repay under about 36,000 wei does not change ICR, so the keeper call reverts. The amount is dust.

<!--/F-->

<!--F key=mezoguardprotector|executerepay|doc-claims-bos-caps-over-repay kind=LEAD agents=1-->

- **The security doc says BorrowerOperations caps a large repay, but it reverts** — `MezoGuardProtector.executeRepay` — Code smells: docs/SECURITY.md item 7 against `_requireValidMUSDRepayment`. — A repay above debt minus 200 MUSD reverts and the rule stays armed. The code is safe; the doc is wrong.

<!--/F-->

<!--F key=mezoguardprotector|executerepay|bos-upgrade-breaks-protector kind=LEAD agents=1-->

- **A BorrowerOperations upgrade can stop every executeRepay** — `MezoGuardProtector.executeRepay` — Code smells: exact-burn check at line 163; BorrowerOperationsSignatures is an upgradeable proxy. — An upgrade that changes the burn makes every call revert with UnexpectedBurn. We found no such upgrade.

<!--/F-->

<!--F key=mezoguardprotector|constructor|bos-upgrade-breaks-protector kind=LEAD agents=1-->

- **The protector hard-codes the BorrowerOperationsSignatures digest** — `MezoGuardProtector.constructor` — Code smells: constant name, version and typehash; immutable `_bos`; no owner. — A proxy upgrade that changes the digest stops every armed rule, and the contract has no way to update. Upgrade intent is unverified.

<!--/F-->

<!--F key=mezoguardprotector|arm|no-price-or-icr-check-at-arm kind=LEAD agents=1-->

- **The arm function does not read the current ICR** — `MezoGuardProtector.arm` — Code smells: no ICR read in `arm`; zero budget accepted. — An owner can arm a rule that runs at once or never. We did not confirm the owner intent.

<!--/F-->

<!--F key=mezoguardprotector|arm|bos-repay-revert-unpredicted kind=LEAD agents=1-->

- **The arm function accepts a repay amount that BorrowerOperations later rejects** — `MezoGuardProtector.arm` — Code smells: only `repayAmount != 0` is checked. — A rule whose repay leaves net debt under 1,800 MUSD reverts when it runs. The Trove state at trigger time is unknown.

<!--/F-->

<!--F key=mezoguardprotector|arm|dust-repay-no-improvement kind=LEAD agents=1-->

- **The arm function accepts a one-wei repay** — `MezoGuardProtector.arm` — Code smells: only `repayAmount != 0` is checked. — A dust rule can only end in NoImprovement, so the keeper pays gas for nothing. docs/SECURITY.md records this.

<!--/F-->

<!--F key=mezoguardprotector|canexecute|bos-repay-revert-unpredicted kind=LEAD agents=1-->

- **canExecute reports ready for a repay that BorrowerOperations rejects** — `MezoGuardProtector.canExecute` — Code smells: no post-repay MCR or min-net-debt check. — A keeper that trusts `ready` sends a call that reverts. Traced on the research/musd source only.

<!--/F-->

<!--F key=mezoguardprotector|deposit|budget-credit-before-transfer kind=LEAD agents=1-->

- **deposit credits the budget before the token transfer** — `MezoGuardProtector.deposit` — Code smells: `r.budget += amount` before `safeTransferFrom`. — A token with a transfer fee gives more budget than the contract holds. MUSD has no fee in the deployed source we know of.

<!--/F-->

<!--F key=deploy|run|deploy-address-override kind=LEAD agents=2-->

- **The deploy script accepts any address that has code** — `Deploy.run` — Code smells: `vm.envOr` overrides; only `code.length > 0` is checked; immutable addresses. — A wrong override binds the protector to the wrong contracts forever. Only the deployer can cause it.

<!--/F-->
