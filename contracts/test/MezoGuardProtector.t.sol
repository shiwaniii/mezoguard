// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ProtectorBase} from "./Base.t.sol";
import {MezoGuardProtector} from "../src/MezoGuardProtector.sol";
import {IMezoGuardProtector} from "../src/interfaces/IMezoGuardProtector.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {
    MockMUSD,
    MockPriceFeed,
    MockTroveManager,
    MockBorrowerOperationsSignatures,
    ReentrantBOS,
    OverBurnBOS,
    IProtectorReenter
} from "./mocks/MezoMocks.sol";

contract MezoGuardProtectorTest is ProtectorBase {
    uint256 internal constant AMOUNT = 10_000e18;
    uint256 internal constant TRIGGER = 1.3e18;

    function _deadline() internal view returns (uint256) {
        return block.timestamp + 30 days;
    }

    // ------------------------------------------------------------ constructor / views

    function test_constructor_zeroAddressReverts() public {
        vm.expectRevert(MezoGuardProtector.ZeroAddress.selector);
        new MezoGuardProtector(address(0), address(tm), address(feed), address(bos));
        vm.expectRevert(MezoGuardProtector.ZeroAddress.selector);
        new MezoGuardProtector(address(musd), address(0), address(feed), address(bos));
        vm.expectRevert(MezoGuardProtector.ZeroAddress.selector);
        new MezoGuardProtector(address(musd), address(tm), address(0), address(bos));
        vm.expectRevert(MezoGuardProtector.ZeroAddress.selector);
        new MezoGuardProtector(address(musd), address(tm), address(feed), address(0));
    }

    function test_immutables() public view {
        assertEq(p.musd(), address(musd));
        assertEq(p.troveManager(), address(tm));
        assertEq(p.priceFeed(), address(feed));
        assertEq(p.borrowerOperationsSignatures(), address(bos));
    }

    function test_digestMatchesBOS() public view {
        bytes32 sh = _structHash(AMOUNT, alice, 7, 123);
        assertEq(p.repayDigest(alice, AMOUNT, 7, 123), bos.hashTypedDataV4(sh));
    }

    // ------------------------------------------------------------ happy path

    function test_happyPath_repaysFromBudget_notFromWallet() public {
        _deposit(alice, 15_000e18);
        _armAlice(AMOUNT, TRIGGER, _deadline(), address(0));

        feed.setPrice(85_000e18); // ICR = 85k/70k = 121% < 130%
        uint256 walletBefore = musd.balanceOf(alice);
        uint256 protBefore = musd.balanceOf(address(p));
        uint256 supplyBefore = musd.totalSupply();
        uint256 icrBefore = tm.getCurrentICR(alice, 85_000e18);

        vm.expectEmit(true, true, false, true, address(p));
        emit IMezoGuardProtector.ProtectionExecuted(
            alice, keeper, AMOUNT, icrBefore, uint256(1e18) * 85_000e18 / 60_000e18, 85_000e18
        );
        vm.prank(keeper);
        p.executeRepay(alice, address(0), address(0));

        assertEq(musd.balanceOf(alice), walletBefore, "wallet untouched");
        assertEq(protBefore - musd.balanceOf(address(p)), AMOUNT, "protector burned exactly repayAmount");
        assertEq(supplyBefore - musd.totalSupply(), AMOUNT, "burned, not transferred");
        assertEq(musd.allowance(address(p), address(bos)), 0, "no allowance ever");
        assertEq(tm.getTroveDebt(alice), 60_000e18);
        IMezoGuardProtector.Rule memory r = p.ruleOf(alice);
        assertEq(r.budget, 5_000e18);
        assertFalse(r.armed);
        assertEq(r.signature.length, 0);
        assertEq(bos.getNonce(alice), 1);
    }

    function test_canExecute_reasons() public {
        (bool ok,, string memory why) = p.canExecute(alice);
        assertFalse(ok);
        assertEq(why, "not armed");

        _armAlice(AMOUNT, TRIGGER, _deadline(), address(0));
        (ok,, why) = p.canExecute(alice);
        assertEq(why, "insufficient budget");

        _deposit(alice, AMOUNT);
        uint256 icr;
        (ok, icr, why) = p.canExecute(alice);
        assertFalse(ok);
        assertEq(why, "above trigger");
        assertEq(icr, tm.getCurrentICR(alice, PRICE));

        feed.setStale(true);
        (ok,, why) = p.canExecute(alice);
        assertEq(why, "price unavailable");
        feed.setStale(false);

        feed.setPrice(85_000e18);
        (ok, icr, why) = p.canExecute(alice);
        assertTrue(ok);
        assertEq(bytes(why).length, 0);

        _bumpNonce();
        (ok,, why) = p.canExecute(alice);
        assertEq(why, "signature invalidated (nonce changed)");

        vm.warp(_deadline() + 31 days);
        (ok,, why) = p.canExecute(alice);
        assertEq(why, "expired");
    }

    // ------------------------------------------------------------ execute reverts

    function test_revert_aboveTrigger() public {
        _deposit(alice, AMOUNT);
        _armAlice(AMOUNT, TRIGGER, _deadline(), address(0));
        uint256 icr = tm.getCurrentICR(alice, PRICE);
        vm.expectRevert(abi.encodeWithSelector(IMezoGuardProtector.AboveTrigger.selector, icr, TRIGGER));
        p.executeRepay(alice, address(0), address(0));
    }

    function test_revert_atExactTrigger() public {
        _deposit(alice, AMOUNT);
        // 1 BTC @ 91k / 70k = 1.3 exactly
        _armAlice(AMOUNT, TRIGGER, _deadline(), address(0));
        feed.setPrice(91_000e18);
        assertEq(tm.getCurrentICR(alice, 91_000e18), TRIGGER);
        vm.expectRevert(abi.encodeWithSelector(IMezoGuardProtector.AboveTrigger.selector, TRIGGER, TRIGGER));
        p.executeRepay(alice, address(0), address(0));
    }

    function test_revert_notArmed() public {
        vm.expectRevert(IMezoGuardProtector.NotArmed.selector);
        p.executeRepay(alice, address(0), address(0));
    }

    function test_revert_expired() public {
        _deposit(alice, AMOUNT);
        uint256 dl = block.timestamp + 1 hours;
        _armAlice(AMOUNT, TRIGGER, dl, address(0));
        feed.setPrice(85_000e18);
        vm.warp(dl + 1);
        vm.expectRevert(IMezoGuardProtector.Expired.selector);
        p.executeRepay(alice, address(0), address(0));
    }

    function test_executeAtExactDeadline_ok() public {
        _deposit(alice, AMOUNT);
        uint256 dl = block.timestamp + 1 hours;
        _armAlice(AMOUNT, TRIGGER, dl, address(0));
        feed.setPrice(85_000e18);
        vm.warp(dl);
        p.executeRepay(alice, address(0), address(0));
    }

    function test_revert_wrongExecutor() public {
        _deposit(alice, AMOUNT);
        _armAlice(AMOUNT, TRIGGER, _deadline(), keeper);
        feed.setPrice(85_000e18);
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(IMezoGuardProtector.NotExecutor.selector);
        p.executeRepay(alice, address(0), address(0));
        vm.prank(keeper);
        p.executeRepay(alice, address(0), address(0));
    }

    function test_revert_insufficientBudget() public {
        _deposit(alice, AMOUNT - 1);
        _armAlice(AMOUNT, TRIGGER, _deadline(), address(0));
        feed.setPrice(85_000e18);
        vm.expectRevert(IMezoGuardProtector.InsufficientBudget.selector);
        p.executeRepay(alice, address(0), address(0));
    }

    function test_revert_stalePrice() public {
        _deposit(alice, AMOUNT);
        _armAlice(AMOUNT, TRIGGER, _deadline(), address(0));
        feed.setStale(true);
        vm.expectRevert("PriceFeed: Oracle is stale.");
        p.executeRepay(alice, address(0), address(0));
    }

    function test_replay_secondExecuteFails() public {
        _deposit(alice, 2 * AMOUNT);
        _armAlice(AMOUNT, TRIGGER, _deadline(), address(0));
        feed.setPrice(85_000e18);
        p.executeRepay(alice, address(0), address(0));
        vm.expectRevert(IMezoGuardProtector.NotArmed.selector);
        p.executeRepay(alice, address(0), address(0));
    }

    function test_replay_reArmWithConsumedSignatureFails() public {
        _deposit(alice, 2 * AMOUNT);
        bytes memory sig = _signRepay(aliceKey, AMOUNT, 0, _deadline());
        vm.prank(alice);
        p.arm(AMOUNT, TRIGGER, _deadline(), address(0), sig);
        feed.setPrice(85_000e18);
        p.executeRepay(alice, address(0), address(0));
        // Old signature was for nonce 0; BOS nonce is now 1.
        vm.prank(alice);
        vm.expectRevert(MezoGuardProtector.InvalidSignature.selector);
        p.arm(AMOUNT, TRIGGER, _deadline(), address(0), sig);
    }

    function test_replay_storedSigUnusableDirectlyAfterExecute() public {
        _deposit(alice, AMOUNT);
        bytes memory sig = _signRepay(aliceKey, AMOUNT, 0, _deadline());
        vm.prank(alice);
        p.arm(AMOUNT, TRIGGER, _deadline(), address(0), sig);
        feed.setPrice(80_000e18);
        p.executeRepay(alice, address(0), address(0));
        musd.mint(keeper, AMOUNT);
        vm.prank(keeper);
        vm.expectRevert("BorrowerOperationsSignatures: Invalid signature");
        bos.repayMUSDWithSignature(AMOUNT, address(0), address(0), alice, sig, _deadline());
    }

    function _bumpNonce() internal {
        uint256 dl = _deadline();
        bytes32 sh = keccak256(abi.encodePacked(ADD_COLL_TYPEHASH, abi.encode(uint256(0), alice), bos.getNonce(alice), dl));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(aliceKey, bos.hashTypedDataV4(sh));
        bos.addCollWithSignature(address(0), address(0), alice, abi.encodePacked(r, s, v), dl);
    }

    function test_nonceBumpInvalidatesStoredSignature() public {
        _deposit(alice, AMOUNT);
        _armAlice(AMOUNT, TRIGGER, _deadline(), address(0));
        _bumpNonce();
        feed.setPrice(85_000e18);
        uint256 budgetBefore = p.ruleOf(alice).budget;
        vm.expectRevert("BorrowerOperationsSignatures: Invalid signature");
        p.executeRepay(alice, address(0), address(0));
        // State fully rolled back: still armed, budget intact.
        assertEq(p.ruleOf(alice).budget, budgetBefore);
        assertTrue(p.ruleOf(alice).armed);
    }

    function test_frontRunDirectlyOnBOS_onlyBurnsFrontRunnersMUSD() public {
        _deposit(alice, AMOUNT);
        bytes memory sig = _signRepay(aliceKey, AMOUNT, 0, _deadline());
        vm.prank(alice);
        p.arm(AMOUNT, TRIGGER, _deadline(), address(0), sig);
        // Attacker copies the signature from calldata/storage and submits it to BOS directly.
        address attacker = makeAddr("attacker");
        musd.mint(attacker, AMOUNT);
        vm.prank(attacker);
        bos.repayMUSDWithSignature(AMOUNT, address(0), address(0), alice, sig, _deadline());
        assertEq(musd.balanceOf(attacker), 0, "attacker paid");
        assertEq(musd.balanceOf(address(p)), AMOUNT, "budget untouched");
        assertEq(tm.getTroveDebt(alice), 60_000e18, "alice's debt fell");
        feed.setPrice(70_000e18);
        vm.expectRevert("BorrowerOperationsSignatures: Invalid signature");
        p.executeRepay(alice, address(0), address(0));
        vm.prank(alice);
        p.revoke();
        assertEq(musd.balanceOf(address(p)), 0);
    }

    function test_arm_rejectsRepayBelowMinNetDebt() public {
        // debt 2,500 → net 2,300; repay 600 → 1,700 < 1,800 min.
        address bob;
        uint256 bobKey = 0xB0B;
        bob = vm.addr(bobKey);
        tm.setTrove(bob, 0.03e18, 2_500e18); // ICR 120%
        musd.mint(bob, 1_000e18);
        vm.startPrank(bob);
        musd.approve(address(p), type(uint256).max);
        p.deposit(600e18);
        // arm already refuses a repay that BorrowerOperations would reject for minimum net debt.
        bytes memory sig = _signRepay(bobKey, 600e18, 0, _deadline());
        vm.expectRevert(IMezoGuardProtector.RepayBelowMinNetDebt.selector);
        p.arm(600e18, 1.3e18, _deadline(), address(0), sig);
        vm.stopPrank();
    }

    function test_revert_overBurningBOS_protectsPool() public {
        OverBurnBOS evil = new OverBurnBOS(musd, tm, feed);
        tm.setBorrowerOperations(address(evil));
        musd.setSystem(address(evil), false, true);
        MezoGuardProtector p2 = new MezoGuardProtector(address(musd), address(tm), address(feed), address(evil));
        vm.startPrank(alice);
        musd.approve(address(p2), type(uint256).max);
        p2.deposit(AMOUNT + 1);
        bytes32 sh = _structHash(AMOUNT, alice, 0, _deadline());
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(aliceKey, evil.hashTypedDataV4(sh));
        p2.arm(AMOUNT, TRIGGER, _deadline(), address(0), abi.encodePacked(r, s, v));
        vm.stopPrank();
        feed.setPrice(85_000e18);
        vm.expectRevert(abi.encodeWithSelector(MezoGuardProtector.UnexpectedBurn.selector, AMOUNT, AMOUNT + 1));
        p2.executeRepay(alice, address(0), address(0));
    }

    // ------------------------------------------------------------ arm

    function test_arm_badSignatureReverts() public {
        bytes memory sig = _signRepay(0xBAD, AMOUNT, 0, _deadline()); // signed by someone else
        vm.prank(alice);
        vm.expectRevert(MezoGuardProtector.InvalidSignature.selector);
        p.arm(AMOUNT, TRIGGER, _deadline(), address(0), sig);
    }

    function test_arm_signatureForDifferentAmountReverts() public {
        bytes memory sig = _signRepay(aliceKey, AMOUNT, 0, _deadline());
        vm.prank(alice);
        vm.expectRevert(MezoGuardProtector.InvalidSignature.selector);
        p.arm(AMOUNT + 1, TRIGGER, _deadline(), address(0), sig);
    }

    function test_arm_signatureForDifferentDeadlineReverts() public {
        bytes memory sig = _signRepay(aliceKey, AMOUNT, 0, _deadline());
        vm.prank(alice);
        vm.expectRevert(MezoGuardProtector.InvalidSignature.selector);
        p.arm(AMOUNT, TRIGGER, _deadline() + 1, address(0), sig);
    }

    function test_arm_garbageSignatureReverts() public {
        vm.prank(alice);
        vm.expectRevert(MezoGuardProtector.InvalidSignature.selector);
        p.arm(AMOUNT, TRIGGER, _deadline(), address(0), hex"deadbeef");
    }

    function test_arm_someoneElsesSignatureCannotArmForThem() public {
        // Keeper submits Alice's valid signature as its own rule → recovers to alice != keeper.
        bytes memory sig = _signRepay(aliceKey, AMOUNT, 0, _deadline());
        tm.setTrove(keeper, 1e18, 50_000e18); // keeper has its own Trove, so only the signature check can stop it
        vm.prank(keeper);
        vm.expectRevert(MezoGuardProtector.InvalidSignature.selector);
        p.arm(AMOUNT, TRIGGER, _deadline(), address(0), sig);
    }

    function test_arm_invalidParams() public {
        bytes memory sig = _signRepay(aliceKey, AMOUNT, 0, _deadline());
        vm.startPrank(alice);
        vm.expectRevert(IMezoGuardProtector.InvalidParams.selector);
        p.arm(0, TRIGGER, _deadline(), address(0), sig);
        vm.expectRevert(IMezoGuardProtector.InvalidParams.selector);
        p.arm(AMOUNT, 1.1e18 - 1, _deadline(), address(0), sig);
        vm.expectRevert(IMezoGuardProtector.InvalidParams.selector);
        p.arm(AMOUNT, 10e18 + 1, _deadline(), address(0), sig);
        vm.expectRevert(IMezoGuardProtector.InvalidParams.selector);
        p.arm(AMOUNT, TRIGGER, block.timestamp, address(0), sig);
        vm.stopPrank();
    }

    function test_arm_beforeDeposit_thenDeposit() public {
        _armAlice(AMOUNT, TRIGGER, _deadline(), address(0));
        assertTrue(p.ruleOf(alice).armed);
        _deposit(alice, AMOUNT);
        feed.setPrice(85_000e18);
        p.executeRepay(alice, address(0), address(0));
    }

    function test_reArm_overwritesRule_afterNonceBump() public {
        _armAlice(AMOUNT, TRIGGER, _deadline(), keeper);
        _bumpNonce(); // the borrower consumes the old signature's nonce with any signed BOS action
        _armAlice(AMOUNT / 2, 1.5e18, _deadline(), address(0));
        IMezoGuardProtector.Rule memory r = p.ruleOf(alice);
        assertEq(r.repayAmount, AMOUNT / 2);
        assertEq(r.triggerIcr, 1.5e18);
        assertEq(r.executor, address(0));
    }

    // ------------------------------------------------------------ budget

    function test_deposit_withdraw() public {
        _deposit(alice, AMOUNT);
        assertEq(p.ruleOf(alice).budget, AMOUNT);
        vm.prank(alice);
        p.withdraw(4_000e18);
        assertEq(p.ruleOf(alice).budget, 6_000e18);
        assertEq(musd.balanceOf(alice), 100_000e18 - 6_000e18);
        vm.prank(alice);
        vm.expectRevert(IMezoGuardProtector.InsufficientBudget.selector);
        p.withdraw(6_000e18 + 1);
        vm.prank(alice);
        vm.expectRevert(IMezoGuardProtector.InvalidParams.selector);
        p.withdraw(0);
        vm.prank(alice);
        vm.expectRevert(IMezoGuardProtector.InvalidParams.selector);
        p.deposit(0);
    }

    function test_withdraw_cannotTakeOthersBudget() public {
        _deposit(alice, AMOUNT);
        vm.prank(keeper);
        vm.expectRevert(IMezoGuardProtector.InsufficientBudget.selector);
        p.withdraw(1);
    }

    function test_revoke_refundsAndDisarms() public {
        _deposit(alice, AMOUNT);
        _armAlice(AMOUNT, TRIGGER, _deadline(), keeper);
        uint256 before = musd.balanceOf(alice);
        vm.expectEmit(true, false, false, true, address(p));
        emit IMezoGuardProtector.Revoked(alice, AMOUNT);
        vm.prank(alice);
        p.revoke();
        assertEq(musd.balanceOf(alice), before + AMOUNT);
        IMezoGuardProtector.Rule memory r = p.ruleOf(alice);
        assertFalse(r.armed);
        assertEq(r.budget, 0);
        assertEq(r.signature.length, 0);
        feed.setPrice(85_000e18);
        vm.prank(keeper);
        vm.expectRevert(IMezoGuardProtector.NotArmed.selector);
        p.executeRepay(alice, address(0), address(0));
    }

    function test_revoke_emptyIsNoop() public {
        vm.prank(keeper);
        p.revoke();
    }

    function test_noApprovals_noAdmin() public view {
        // Protector exposes no function that can move another user's budget; spot check: zero allowances.
        assertEq(musd.allowance(address(p), address(bos)), 0);
        assertEq(musd.allowance(address(p), address(tm)), 0);
    }

    // ------------------------------------------------------------ reentrancy

    function test_reentrancy_executeRepay() public {
        ReentrantBOS evil = new ReentrantBOS(musd, tm, feed);
        MezoGuardProtector p2 = new MezoGuardProtector(address(musd), address(tm), address(feed), address(evil));
        evil.setAttack(IProtectorReenter(address(p2)), 1);
        _armOn(p2, evil);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        p2.executeRepay(alice, address(0), address(0));
    }

    function test_reentrancy_withdraw() public {
        ReentrantBOS evil = new ReentrantBOS(musd, tm, feed);
        MezoGuardProtector p2 = new MezoGuardProtector(address(musd), address(tm), address(feed), address(evil));
        evil.setAttack(IProtectorReenter(address(p2)), 2);
        _armOn(p2, evil);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        p2.executeRepay(alice, address(0), address(0));
    }

    function _armOn(MezoGuardProtector p2, MockBorrowerOperationsSignatures b) internal {
        vm.startPrank(alice);
        musd.approve(address(p2), type(uint256).max);
        p2.deposit(AMOUNT);
        bytes32 sh = _structHash(AMOUNT, alice, 0, _deadline());
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(aliceKey, b.hashTypedDataV4(sh));
        p2.arm(AMOUNT, TRIGGER, _deadline(), address(0), abi.encodePacked(r, s, v));
        vm.stopPrank();
        feed.setPrice(85_000e18);
    }

    // ------------------------------------------------------------ fuzz

    function testFuzz_triggerGate(uint256 trigger, uint256 price) public {
        trigger = bound(trigger, 1.2e18, 10e18);
        price = bound(price, 1_000e18, 1_000_000e18);
        _deposit(alice, AMOUNT);
        _armAlice(AMOUNT, trigger, _deadline(), address(0));
        feed.setPrice(price);
        uint256 icr = tm.getCurrentICR(alice, price);
        uint256 newIcr = (1e18 * price) / (70_000e18 - AMOUNT);
        if (icr >= trigger) {
            vm.expectRevert(abi.encodeWithSelector(IMezoGuardProtector.AboveTrigger.selector, icr, trigger));
        } else if (newIcr < 1.1e18) {
            vm.expectRevert(IMezoGuardProtector.RepayLeavesIcrBelowMcr.selector);
        }
        p.executeRepay(alice, address(0), address(0));
        if (icr < trigger && newIcr >= 1.1e18) {
            assertEq(tm.getTroveDebt(alice), 70_000e18 - AMOUNT);
            assertEq(p.ruleOf(alice).budget, 0);
        } else {
            assertEq(p.ruleOf(alice).budget, AMOUNT);
            assertTrue(p.ruleOf(alice).armed);
        }
    }

    function testFuzz_amount(uint256 amount, uint256 extra) public {
        amount = bound(amount, 1e15, 68_000e18); // max repay leaving net debt >= 1,800 (debt 70k - 200 gas comp)
        extra = bound(extra, 0, 30_000e18 - 1);
        vm.assume(amount + extra <= 100_000e18);
        _deposit(alice, amount + extra);
        _armAlice(amount, 5e18, _deadline(), address(0));
        uint256 supplyBefore = musd.totalSupply();
        p.executeRepay(alice, address(0), address(0));
        assertEq(supplyBefore - musd.totalSupply(), amount);
        assertEq(musd.balanceOf(address(p)), extra);
        assertEq(p.ruleOf(alice).budget, extra);
        assertEq(tm.getTroveDebt(alice), 70_000e18 - amount);
    }

    function test_dustRepay_revertsNoImprovement() public {
        // 1 wei does not move the integer ICR → strict-improvement check rejects it (state rolled back).
        _deposit(alice, 1);
        _armAlice(1, 5e18, _deadline(), address(0));
        vm.expectRevert(IMezoGuardProtector.NoImprovement.selector);
        p.executeRepay(alice, address(0), address(0));
        assertTrue(p.ruleOf(alice).armed);
    }

    function testFuzz_recoveryMode_allowsPartialRepayBelowMCR(uint256 amount) public {
        // ICR 100% (below MCR). In Recovery Mode pure repay is allowed even if result < MCR.
        amount = bound(amount, 1e18, 5_000e18);
        feed.setPrice(70_000e18);
        bos.setRecoveryMode(true);
        _deposit(alice, amount);
        _armAlice(amount, 1.5e18, _deadline(), address(0));
        p.executeRepay(alice, address(0), address(0));
        assertEq(tm.getTroveDebt(alice), 70_000e18 - amount);
    }

    // ------------------------------------------------------------ audit fixes (solidity-auditor scan 20261112)

    /// Finding 5 / 3A: a trigger at MCR fires only once the Trove is already liquidatable.
    function test_arm_triggerFloorIs120() public {
        bytes memory sig = _signRepay(aliceKey, AMOUNT, 0, _deadline());
        vm.startPrank(alice);
        vm.expectRevert(IMezoGuardProtector.InvalidParams.selector);
        p.arm(AMOUNT, 1.1e18, _deadline(), address(0), sig);
        vm.expectRevert(IMezoGuardProtector.InvalidParams.selector);
        p.arm(AMOUNT, 1.2e18 - 1, _deadline(), address(0), sig);
        p.arm(AMOUNT, 1.2e18, _deadline(), address(0), sig);
        vm.stopPrank();
        assertEq(p.MIN_TRIGGER_ICR(), 1.2e18);
    }

    /// Finding 3B: executeRepay fails with a clear error (not inside BorrowerOperations) when the repay would leave
    /// ICR below MCR in Normal Mode; canExecute reports the same instead of "ready".
    function test_executeRepay_icrBelowMcrAfterRepay_normalMode() public {
        _deposit(alice, 1_000e18);
        _armAlice(1_000e18, TRIGGER, _deadline(), address(0));
        feed.setPrice(75_000e18); // ICR 107.1%; after 1,000 repay 75,000/69,000 = 108.7% < 110%
        (bool ready,, string memory reason) = p.canExecute(alice);
        assertFalse(ready);
        assertEq(reason, "repay would leave ICR below MCR");
        vm.expectRevert(IMezoGuardProtector.RepayLeavesIcrBelowMcr.selector);
        p.executeRepay(alice, address(0), address(0));
        assertTrue(p.ruleOf(alice).armed);
        assertEq(p.ruleOf(alice).budget, 1_000e18);
    }

    function test_executeRepay_icrBelowMcrAfterRepay_allowedInRecoveryMode() public {
        _deposit(alice, 1_000e18);
        _armAlice(1_000e18, TRIGGER, _deadline(), address(0));
        feed.setPrice(75_000e18);
        bos.setRecoveryMode(true); // BorrowerOperations skips the MCR rule for a pure repay in Recovery Mode
        (bool ready,,) = p.canExecute(alice);
        assertTrue(ready);
        p.executeRepay(alice, address(0), address(0));
        assertEq(tm.getTroveDebt(alice), 69_000e18);
    }

    /// Finding 3B: debt that falls after arming (another repay) makes the rule break minimum net debt.
    function test_executeRepay_minNetDebtAfterDebtFalls() public {
        uint256 bobKey = 0xB0B;
        address bob = vm.addr(bobKey);
        tm.setTrove(bob, 0.03e18, 2_600e18); // ICR 115.4% < trigger 130%; net debt 2,400
        musd.mint(bob, 1_000e18);
        vm.startPrank(bob);
        musd.approve(address(p), type(uint256).max);
        p.deposit(500e18);
        p.arm(500e18, 1.3e18, _deadline(), address(0), _signRepay(bobKey, 500e18, 0, _deadline()));
        vm.stopPrank();
        vm.prank(address(bos));
        tm.decreaseDebt(bob, 200e18); // now 2,400 total → net after repay 1,700 < 1,800
        (bool ready,, string memory reason) = p.canExecute(bob);
        assertFalse(ready);
        assertEq(reason, "repay would leave net debt below minimum");
        vm.expectRevert(IMezoGuardProtector.RepayBelowMinNetDebt.selector);
        p.executeRepay(bob, address(0), address(0));
    }

    /// Finding 1: re-arming at the same nonce would leave the first signature usable at BorrowerOperationsSignatures.
    function test_reArm_blockedWhilePreviousSignatureLive() public {
        _armAlice(AMOUNT, TRIGGER, _deadline(), address(0));
        bytes memory sig2 = _signRepay(aliceKey, AMOUNT / 2, bos.getNonce(alice), _deadline());
        vm.prank(alice);
        vm.expectRevert(IMezoGuardProtector.PreviousSignatureLive.selector);
        p.arm(AMOUNT / 2, 1.5e18, _deadline(), address(0), sig2);
    }

    /// Finding 6: revoke cannot cancel the signature, so arming again right after revoke is also blocked.
    function test_revoke_thenArm_blockedUntilNonceBumpOrExpiry() public {
        uint256 dl = block.timestamp + 1 days;
        _armAlice(AMOUNT, TRIGGER, dl, address(0));
        vm.prank(alice);
        p.revoke();
        bytes memory sig = _signRepay(aliceKey, AMOUNT, bos.getNonce(alice), _deadline());
        vm.prank(alice);
        vm.expectRevert(IMezoGuardProtector.PreviousSignatureLive.selector);
        p.arm(AMOUNT, TRIGGER, _deadline(), address(0), sig);
        // Once the old deadline passes, the old signature is dead and arming works again.
        vm.warp(dl + 1);
        _armAlice(AMOUNT, TRIGGER, _deadline(), address(0));
        assertTrue(p.ruleOf(alice).armed);
    }

    function test_revoke_thenNonceBump_thenArm() public {
        _armAlice(AMOUNT, TRIGGER, _deadline(), address(0));
        vm.prank(alice);
        p.revoke();
        _bumpNonce();
        _armAlice(AMOUNT, TRIGGER, _deadline(), address(0));
        assertEq(p.lastSignedNonce(alice), 1);
    }

    /// Finding 4 mitigation: a stored signature lives at most MAX_SIG_DURATION.
    function test_arm_rejectsDeadlineBeyondMax() public {
        uint256 dl = block.timestamp + p.MAX_SIG_DURATION() + 1;
        bytes memory sig = _signRepay(aliceKey, AMOUNT, 0, dl);
        vm.prank(alice);
        vm.expectRevert(IMezoGuardProtector.InvalidParams.selector);
        p.arm(AMOUNT, TRIGGER, dl, address(0), sig);
    }

    /// Finding 2: a rule must not survive its Trove.
    function test_closedTrove_cannotExecute_anyoneCanDisarm_reopenDoesNotInherit() public {
        _deposit(alice, AMOUNT);
        _armAlice(AMOUNT, TRIGGER, _deadline(), address(0));
        tm.closeTrove(alice);
        vm.expectRevert(IMezoGuardProtector.TroveNotActive.selector);
        p.executeRepay(alice, address(0), address(0));

        vm.prank(keeper);
        p.disarmIfClosed(alice);
        IMezoGuardProtector.Rule memory r = p.ruleOf(alice);
        assertFalse(r.armed);
        assertEq(r.signature.length, 0);
        assertEq(r.budget, AMOUNT); // budget stays with the borrower

        tm.setTrove(alice, 1e18, 90_000e18); // reopened, ICR 111% < trigger
        vm.expectRevert(IMezoGuardProtector.NotArmed.selector);
        p.executeRepay(alice, address(0), address(0));
    }

    function test_disarmIfClosed_revertsForActiveTrove() public {
        _armAlice(AMOUNT, TRIGGER, _deadline(), address(0));
        vm.expectRevert(IMezoGuardProtector.TroveStillActive.selector);
        p.disarmIfClosed(alice);
    }

    function test_arm_rejectsClosedTrove() public {
        tm.closeTrove(alice);
        bytes memory sig = _signRepay(aliceKey, AMOUNT, 0, _deadline());
        vm.prank(alice);
        vm.expectRevert(IMezoGuardProtector.TroveNotActive.selector);
        p.arm(AMOUNT, TRIGGER, _deadline(), address(0), sig);
    }
}
