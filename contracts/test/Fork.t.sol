// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MezoGuardProtector} from "../src/MezoGuardProtector.sol";
import {IMezoGuardProtector} from "../src/interfaces/IMezoGuardProtector.sol";

interface IRealBOS {
    function getNonce(address user) external view returns (uint256);
    function eip712Domain()
        external
        view
        returns (bytes1, string memory, string memory, uint256, address, bytes32, uint256[] memory);
    function repayMUSDWithSignature(uint256, address, address, address, bytes memory, uint256) external;
}

/// @notice Read-only checks against the REAL Mezo testnet BorrowerOperationsSignatures.
/// OPT-IN: runs only with MEZO_FORK=true (e.g. `MEZO_FORK=true forge test --mc ForkTest`); skipped otherwise.
/// Nothing here touches the BTC price precompile except as the documented expected failure point.
contract ForkTest is Test {
    address constant MUSD = 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503;
    address constant TROVE_MANAGER = 0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0;
    address constant PRICE_FEED = 0x86bCF0841622a5dAC14A313a15f96A95421b9366;
    address constant BOS = 0xD757e3646AF370b15f32EB557F0F8380Df7D639e;

    bytes32 constant REPAY_TYPEHASH = keccak256("RepayMUSD(uint256 amount,address borrower,uint256 nonce,uint256 deadline)");
    bytes32 constant INVALID_SIG = keccak256(bytes("BorrowerOperationsSignatures: Invalid signature"));

    MezoGuardProtector p;
    uint256 key = uint256(keccak256("mezoguard-throwaway"));
    address user;

    function setUp() public {
        if (!vm.envOr("MEZO_FORK", false)) vm.skip(true);
        try vm.createSelectFork("mezo_testnet") {}
        catch {
            vm.skip(true);
        }
        user = vm.addr(key);
        p = new MezoGuardProtector(MUSD, TROVE_MANAGER, PRICE_FEED, BOS);
    }

    function test_fork_domainMatchesRealBOS() public view {
        (, string memory name, string memory version, uint256 chainId, address vc,,) = IRealBOS(BOS).eip712Domain();
        assertEq(name, "BorrowerOperationsSignatures");
        assertEq(version, "1");
        assertEq(chainId, 31611);
        assertEq(vc, BOS);
        bytes32 expected = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(name)),
                keccak256(bytes(version)),
                chainId,
                vc
            )
        );
        assertEq(p.domainSeparator(), expected);
    }

    function _sign(uint256 amount, uint256 nonce, uint256 deadline) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, p.repayDigest(user, amount, nonce, deadline));
        return abi.encodePacked(r, s, v);
    }

    /// Strongest check: the REAL BOS accepts our signature (passes _verifySignature) and only fails later inside
    /// BorrowerOperations (no trove / price precompile), while a tampered signature fails with "Invalid signature".
    function test_fork_realBOSVerifiesOurDigest() public {
        uint256 deadline = block.timestamp + 1 days;
        uint256 nonce = IRealBOS(BOS).getNonce(user);

        (bool ok, bytes memory ret) = BOS.call(
            abi.encodeCall(IRealBOS.repayMUSDWithSignature, (1e18, address(0), address(0), user, _sign(1e18, nonce, deadline), deadline))
        );
        assertFalse(ok, "no trove: must revert later");
        assertTrue(keccak256(_reason(ret)) != INVALID_SIG, "real BOS rejected our signature");

        (ok, ret) = BOS.call(
            abi.encodeCall(IRealBOS.repayMUSDWithSignature, (1e18 + 1, address(0), address(0), user, _sign(1e18, nonce, deadline), deadline))
        );
        assertFalse(ok);
        assertEq(keccak256(_reason(ret)), INVALID_SIG, "control: tampered amount must fail signature check");
    }

    function _reason(bytes memory ret) internal pure returns (bytes memory) {
        if (ret.length < 68 || bytes4(ret) != 0x08c379a0) return ret; // not Error(string): custom error / panic / empty
        assembly {
            ret := add(ret, 4)
        }
        return bytes(abi.decode(ret, (string)));
    }
}

interface IRealBO {
    function openTrove(uint256 debtAmount, address upperHint, address lowerHint) external payable;
    function closeTrove() external;
    function minNetDebt() external view returns (uint256);
}

interface IRealTM {
    function getTroveDebt(address) external view returns (uint256);
    function getTroveStatus(address) external view returns (uint8);
}

/// @notice End-to-end against the REAL Mezo BorrowerOperations / BorrowerOperationsSignatures / TroveManager on a
/// local fork (nothing is broadcast). PriceFeed.fetchPrice is mocked because the BTC price precompile cannot run on a
/// fork. A throwaway key opens a real Trove (0.1 BTC, 2,500 MUSD). OPT-IN: MEZO_FORK=true.
contract ForkE2ETest is Test {
    address constant MUSD = 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503;
    address constant TM = 0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0;
    address constant PF = 0x86bCF0841622a5dAC14A313a15f96A95421b9366;
    address constant BOS = 0xD757e3646AF370b15f32EB557F0F8380Df7D639e;
    address constant BO = 0xCdF7028ceAB81fA0C6971208e83fa7872994beE5;
    uint256 constant PRICE = 73_736e18;

    uint256 key = uint256(keccak256("mezoguard-fork-e2e"));
    address user;
    MezoGuardProtector p;

    function setUp() public {
        if (!vm.envOr("MEZO_FORK", false)) vm.skip(true);
        try vm.createSelectFork("mezo_testnet") {}
        catch {
            vm.skip(true);
        }
        user = vm.addr(key);
        vm.mockCall(PF, abi.encodeWithSignature("fetchPrice()"), abi.encode(PRICE));
        p = new MezoGuardProtector(MUSD, TM, PF, BOS);
        vm.deal(user, 1 ether);
        vm.prank(user);
        IRealBO(BO).openTrove{value: 0.1 ether}(2500e18, address(0), address(0));
    }

    function _sig(uint256 amount, uint256 deadline) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, p.repayDigest(user, amount, IRealBOS(BOS).getNonce(user), deadline));
        return abi.encodePacked(r, s, v);
    }

    function _arm(uint256 amount, uint256 trigger) internal {
        uint256 dl = block.timestamp + 60 days;
        bytes memory sig = _sig(amount, dl);
        vm.startPrank(user);
        IERC20(MUSD).approve(address(p), amount);
        p.deposit(amount);
        p.arm(amount, trigger, dl, address(0), sig);
        vm.stopPrank();
    }

    function test_fork_wiresRealBorrowerOperations() public view {
        assertEq(p.borrowerOperations(), BO);
        assertEq(IRealBO(BO).minNetDebt(), 1800e18);
    }

    /// Third-party keeper runs the stored repay through the real BOS after 30 days of interest: debt falls by exactly
    /// the signed amount, the borrower's wallet is untouched and the BOS nonce is consumed.
    function test_fork_e2e_executeRepay() public {
        _arm(300e18, 5e18);
        vm.warp(block.timestamp + 30 days);
        (bool ready,, string memory reason) = p.canExecute(user);
        assertTrue(ready, reason);
        uint256 debtPre = IRealTM(TM).getTroveDebt(user);
        uint256 walletBefore = IERC20(MUSD).balanceOf(user);
        uint256 n0 = IRealBOS(BOS).getNonce(user);
        vm.prank(address(0xBEEF));
        p.executeRepay(user, address(0), address(0));
        assertEq(debtPre - IRealTM(TM).getTroveDebt(user), 300e18);
        assertEq(IERC20(MUSD).balanceOf(user), walletBefore);
        assertEq(IERC20(MUSD).balanceOf(address(p)), 0);
        assertEq(IRealBOS(BOS).getNonce(user), n0 + 1);
    }

    /// Finding 3: arm refuses a repay the real BorrowerOperations would reject for minimum net debt.
    function test_fork_arm_rejectsRepayBelowMinNetDebt() public {
        uint256 debt = IRealTM(TM).getTroveDebt(user);
        uint256 amount = debt - 200e18 - 1800e18 + 1;
        bytes memory sig = _sig(amount, block.timestamp + 1 days);
        vm.prank(user);
        vm.expectRevert(IMezoGuardProtector.RepayBelowMinNetDebt.selector);
        p.arm(amount, 5e18, block.timestamp + 1 days, address(0), sig);
    }

    /// Finding 1: re-arming at the same real nonce is refused.
    function test_fork_reArm_blockedWhilePreviousSignatureLive() public {
        _arm(300e18, 5e18);
        bytes memory sig = _sig(100e18, block.timestamp + 1 days);
        vm.prank(user);
        vm.expectRevert(IMezoGuardProtector.PreviousSignatureLive.selector);
        p.arm(100e18, 5e18, block.timestamp + 1 days, address(0), sig);
    }

    /// Finding 2: after a real closeTrove the rule cannot run, and anyone can disarm it.
    function test_fork_closedTrove_disarm() public {
        _arm(300e18, 5e18);
        deal(MUSD, user, 10_000e18);
        vm.prank(user);
        IRealBO(BO).closeTrove();
        assertTrue(IRealTM(TM).getTroveStatus(user) != 1);
        vm.expectRevert(IMezoGuardProtector.TroveNotActive.selector);
        p.executeRepay(user, address(0), address(0));
        p.disarmIfClosed(user);
        assertFalse(p.ruleOf(user).armed);
        assertEq(p.ruleOf(user).budget, 300e18);
    }
}
