// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MezoGuardProtector} from "../src/MezoGuardProtector.sol";
import {MockMUSD, MockPriceFeed, MockTroveManager, MockBorrowerOperationsSignatures} from "./mocks/MezoMocks.sol";

contract ProtectorHandler is Test {
    MezoGuardProtector public p;
    MockMUSD public musd;
    MockPriceFeed public feed;
    MockTroveManager public tm;
    MockBorrowerOperationsSignatures public bos;

    uint256[] public keys;
    address[] public actors;

    uint256 public ghostDeposited;
    uint256 public ghostWithdrawn;
    uint256 public ghostBurned;
    uint256 public executions;

    bytes32 internal constant REPAY_TYPEHASH =
        keccak256("RepayMUSD(uint256 amount,address borrower,uint256 nonce,uint256 deadline)");

    constructor(
        MezoGuardProtector p_,
        MockMUSD m,
        MockPriceFeed f,
        MockTroveManager t,
        MockBorrowerOperationsSignatures b
    ) {
        p = p_;
        musd = m;
        feed = f;
        tm = t;
        bos = b;
        for (uint256 i = 1; i <= 4; i++) {
            uint256 k = 0x1000 + i;
            address a = vm.addr(k);
            keys.push(k);
            actors.push(a);
            tm.setTrove(a, 1e18, 60_000e18);
            deal(address(musd), a, 1_000_000e18, true);
            vm.prank(a);
            musd.approve(address(p), type(uint256).max);
        }
    }

    function deposit(uint256 who, uint256 amount) external {
        address a = actors[who % actors.length];
        amount = bound(amount, 1, 50_000e18);
        vm.prank(a);
        p.deposit(amount);
        ghostDeposited += amount;
    }

    function withdraw(uint256 who, uint256 amount) external {
        address a = actors[who % actors.length];
        uint256 b = p.ruleOf(a).budget;
        if (b == 0) return;
        amount = bound(amount, 1, b);
        vm.prank(a);
        p.withdraw(amount);
        ghostWithdrawn += amount;
    }

    function arm(uint256 who, uint256 amount, uint256 trigger) external {
        uint256 i = who % actors.length;
        address a = actors[i];
        amount = bound(amount, 1e18, 5_000e18);
        trigger = bound(trigger, 1.1e18, 10e18);
        uint256 dl = block.timestamp + 7 days;
        bytes32 sh = keccak256(abi.encodePacked(REPAY_TYPEHASH, abi.encode(amount, a), bos.getNonce(a), dl));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(keys[i], bos.hashTypedDataV4(sh));
        vm.prank(a);
        p.arm(amount, trigger, dl, address(0), abi.encodePacked(r, s, v));
    }

    function revoke(uint256 who) external {
        address a = actors[who % actors.length];
        uint256 b = p.ruleOf(a).budget;
        vm.prank(a);
        p.revoke();
        ghostWithdrawn += b;
    }

    function setPrice(uint256 price) external {
        feed.setPrice(bound(price, 40_000e18, 200_000e18));
    }

    function execute(uint256 who, address caller) external {
        address a = actors[who % actors.length];
        uint256 amt = p.ruleOf(a).repayAmount;
        vm.prank(caller);
        try p.executeRepay(a, address(0), address(0)) {
            ghostBurned += amt;
            executions++;
        } catch {}
    }

    function sumBudgets() external view returns (uint256 s) {
        for (uint256 i; i < actors.length; i++) s += p.ruleOf(actors[i]).budget;
    }
}

contract ProtectorInvariantTest is Test {
    ProtectorHandler internal h;
    MezoGuardProtector internal p;
    MockMUSD internal musd;

    function setUp() public {
        vm.chainId(31611);
        vm.warp(1_750_000_000);
        musd = new MockMUSD();
        MockPriceFeed feed = new MockPriceFeed(100_000e18);
        MockTroveManager tm = new MockTroveManager();
        MockBorrowerOperationsSignatures bos = new MockBorrowerOperationsSignatures(musd, tm, feed);
        tm.setBorrowerOperations(address(bos));
        musd.setSystem(address(bos), false, true);
        p = new MezoGuardProtector(address(musd), address(tm), address(feed), address(bos));
        h = new ProtectorHandler(p, musd, feed, tm, bos);
        targetContract(address(h));
    }

    /// Sum of per-borrower budgets always equals the protector's MUSD balance.
    function invariant_budgetsEqualBalance() public view {
        assertEq(h.sumBudgets(), musd.balanceOf(address(p)));
    }

    /// Conservation: deposits − withdrawals/refunds − repay burns == balance.
    function invariant_conservation() public view {
        assertEq(h.ghostDeposited() - h.ghostWithdrawn() - h.ghostBurned(), musd.balanceOf(address(p)));
    }

    /// The protector never grants allowances.
    function invariant_noAllowance() public view {
        assertEq(musd.allowance(address(p), p.borrowerOperationsSignatures()), 0);
    }

    /// Non-vacuity: the handler path really reaches a successful repay (a probe invariant confirmed several
    /// executions happen within single invariant runs).
    function test_handlerCanExecute() public {
        h.deposit(0, 10_000e18);
        h.arm(0, 1_000e18, 5e18);
        h.execute(0, address(0xBEEF));
        assertEq(h.executions(), 1);
    }
}
