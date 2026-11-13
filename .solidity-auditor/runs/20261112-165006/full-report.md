# 🔐 Security Review — mezoguard

---

## Scope

|  |  |
| --- | --- |
| **Mode** | filename |
| **Files reviewed** | `contracts/src/MezoGuardProtector.sol` · `contracts/script/Deploy.s.sol` |
| **Confidence threshold (1-100)** | 75 |
| **Passes** | 2 |
| **Memory** | 0 records before this scan · 23 after · `edec6e7` |

---

## Findings

[75] **1. Re-arming leaves the earlier signature valid at the same nonce**

`MezoGuardProtector.arm` · Confidence: 75 · seen in 2/2 runs · NEW

**Description**
A second `arm` call keeps the BorrowerOperationsSignatures nonce, so any caller submits the old smaller repay and the new rule then fails.

**Fix**

```diff
+        if (_rules[msg.sender].armed && _bos.getNonce(msg.sender) == armedNonce[msg.sender]) revert PreviousSignatureLive();
         uint256 nonce = _bos.getNonce(msg.sender);
```

---

[75] **2. An armed rule stays active after the borrower closes the Trove**

`MezoGuardProtector.arm` · Confidence: 75 · seen in 2/2 runs · NEW

**Description**
Plain `closeTrove`, liquidation and redemption do not change the nonce, so after a reopen any keeper uses the old rule and budget on the new Trove.

**Fix**

```diff
+        // in the app's close-Trove flow, before closeTrove:
+        if (rule.armed) await write({ address: protector, abi: protectorAbi, functionName: "revoke" });
```

---

[75] **3. The protector accepts rules that BorrowerOperations rejects when they run**

`MezoGuardProtector.executeRepay` · Confidence: 75 · seen in 2/2 runs · NEW

**Description**
In Normal Mode, BorrowerOperations reverts a repay that leaves ICR below 110% or net debt below 1,800 MUSD, so executeRepay fails when the Trove needs it.

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

---

[75] **4. Any caller can submit the stored repay signature to BorrowerOperationsSignatures**

`MezoGuardProtector.executeRepay` · Confidence: 75 · seen in 2/2 runs · NEW

**Description**
Any MUSD holder submits the public signature to BorrowerOperationsSignatures, so the rule stops working, and that holder can later liquidate the Trove for the gas compensation.

**Fix (Option A — document the limit)**:

```diff
-/// The only possible effect on the user is debt reduction from their own pre-deposited budget.
+/// The trigger and executor limit only calls through this contract. The stored signature is public, and any
+/// MUSD holder can submit it to BorrowerOperationsSignatures with their own MUSD at any ICR before the deadline.
+/// That repays the borrower's debt, uses the nonce and disarms the rule. Use a short sigDeadline.
```

**Fix (Option B — ban the path in BorrowerOperationsSignatures)**:

```diff
-    "RepayMUSD(uint256 amount,address borrower,uint256 nonce,uint256 deadline)"
+    "RepayMUSD(uint256 amount,address borrower,address caller,uint256 nonce,uint256 deadline)"
+    require(msg.sender == caller, "BorrowerOperationsSignatures: wrong caller");
```

---

[75] **5. A 110% trigger fires only when a liquidator can already act**

`MezoGuardProtector.executeRepay` · Confidence: 75 · seen in 2/2 runs · NEW

**Description**
The protector accepts a trigger equal to MCR, so the rule runs only below 110%, and a liquidator can close the Trove in the same block.

**Fix**

```diff
-    uint256 public constant MIN_TRIGGER_ICR = 1.1e18;
+    uint256 public constant MIN_TRIGGER_ICR = 1.2e18;
```

---

[75] **6. Revoke does not cancel the stored signature**

`MezoGuardProtector.revoke` · Confidence: 75 · seen in 2/2 runs · NEW

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

---

Findings List

| # | Confidence | Title |
|---|---|---|
| 1 | [75] | Re-arming leaves the earlier signature valid at the same nonce |
| 2 | [75] | An armed rule stays active after the borrower closes the Trove |
| 3 | [75] | The protector accepts rules that BorrowerOperations rejects when they run |
| 4 | [75] | Any caller can submit the stored repay signature to BorrowerOperationsSignatures |
| 5 | [75] | A 110% trigger fires only when a liquidator can already act |
| 6 | [75] | Revoke does not cancel the stored signature |

---

## Leads

_Vulnerability trails with concrete code smells where the full exploit path could not be completed in one analysis pass. These are not false positives — they are high-signal leads for manual review. Not scored._

- **The deploy script accepts any address that has code** — `Deploy.run` · seen in 2/2 runs · NEW — Code smells: `vm.envOr` overrides; only `code.length > 0` is checked; immutable addresses. — A wrong override binds the protector to the wrong contracts forever. Only the deployer can cause it.
- **Each deploy run overwrites the deployment record** — `Deploy.run` · seen in 1/2 runs · NEW — Code smells: `vm.writeJson` to deployments/31611.json; local `block.number`. — The recorded block can differ from the broadcast block. Only the deployer is affected.
- **The arm function accepts a repay amount that BorrowerOperations later rejects** — `MezoGuardProtector.arm` · seen in 2/2 runs · NEW — Code smells: only `repayAmount != 0` is checked. — The same root cause as the `executeRepay` finding, at arm time.
- **The arm function accepts a one-wei repay** — `MezoGuardProtector.arm` · seen in 2/2 runs · NEW — Code smells: only `repayAmount != 0` is checked. — A dust rule can only end in NoImprovement.
- **The arm function does not read the current ICR** — `MezoGuardProtector.arm` · seen in 2/2 runs · NEW — Code smells: no ICR read; trigger up to 1000%. — A rule with a trigger above the live ICR runs at once. Only the owner chooses the trigger.
- **The arm function accepts a signature deadline with no upper limit** — `MezoGuardProtector.arm` · seen in 1/2 runs · NEW — Code smells: only `sigDeadline > block.timestamp` is checked. — A signature that never expires keeps the revoke gap open forever. It adds time to a known finding, not a new path.
- **canExecute reports ready for a repay that BorrowerOperations rejects** — `MezoGuardProtector.canExecute` · seen in 2/2 runs · NEW — Code smells: no post-repay MCR or min-net-debt check. — A keeper that trusts `ready` sends a call that reverts and loses gas.
- **The protector hard-codes the BorrowerOperationsSignatures digest** — `MezoGuardProtector.constructor` · seen in 2/2 runs · NEW — Code smells: constant name, version and typehash; immutable `_bos`; no owner. — A proxy upgrade that changes the digest stops every armed rule. Upgrade intent is unverified.
- **The constructor does not check that its TroveManager and PriceFeed match BorrowerOperations** — `MezoGuardProtector.constructor` · seen in 1/2 runs · NEW — Code smells: addresses checked only for zero. — A mismatched address gives the protector an ICR that BorrowerOperations does not use. Only the deployer can cause it.
- **deposit credits the budget before the token transfer** — `MezoGuardProtector.deposit` · seen in 2/2 runs · NEW — Code smells: `r.budget += amount` before `safeTransferFrom`. — A failed transfer reverts the credit, so this is safe while MUSD has no transfer fee. Three agents cleared it.
- **A BorrowerOperations upgrade can stop every executeRepay** — `MezoGuardProtector.executeRepay` · seen in 2/2 runs · NEW — Code smells: exact-burn check; hard-coded digest; upgradeable proxy. — An upgrade that changes the burn or the digest makes every call revert. We found no such upgrade.
- **The security doc says BorrowerOperations caps a large repay, but it reverts** — `MezoGuardProtector.executeRepay` · seen in 2/2 runs · NEW — Code smells: docs/SECURITY.md item 7 against `_requireValidMUSDRepayment`. — A repay above debt minus 200 MUSD reverts and the rule stays armed. The code is safe; the doc is wrong.
- **A very small repay always reverts with NoImprovement** — `MezoGuardProtector.executeRepay` · seen in 2/2 runs · NEW — Code smells: floored ICR comparison at line 166; `arm` accepts one wei. — A repay below about 2,000 to 72,000 wei, depending on the Trove, does not change the integer ICR. Only the borrower can set such an amount.
- **The rule disarms after one repay even when ICR stays below the trigger** — `MezoGuardProtector.executeRepay` · seen in 1/2 runs · NEW — Code smells: `r.armed = false` with no check of `icrAfter` against `triggerIcr`. — Protection stops until the borrower re-arms. This can be the intended one-shot design.
- **In Recovery Mode the protector accepts a repay that leaves ICR below 110%** — `MezoGuardProtector.executeRepay` · seen in 1/2 runs · NEW — Code smells: the only success test is `icrAfter > icrBefore`. — The budget is spent and the Trove can stay below 110%. We did not verify the Recovery Mode liquidation rule.
- **executeRepay checks no Trove identity** — `MezoGuardProtector.executeRepay` · seen in 2/2 runs · NEW — Code smells: rule keyed by address; no open-time snapshot. — The same root cause as the `arm` finding, at the execution point. We did not run the close and reopen on a fork.
- **Any other signed BorrowerOperations action disarms the rule** — `MezoGuardProtector.executeRepay` · seen in 1/2 runs · NEW — Code smells: `executeRepay` does not compare `armedNonce` with `getNonce`; every signed action bumps the shared nonce. — The rule stays armed but every call reverts. Only the borrower's own signed action causes this.

---

> ⚠️ This review was performed by an AI assistant. AI analysis can never verify the complete absence of vulnerabilities and no guarantee of security is given. Team security reviews, bug bounty programs, and on-chain monitoring are strongly recommended. For a consultation regarding your projects' security, visit [https://www.pashov.com](https://www.pashov.com)
