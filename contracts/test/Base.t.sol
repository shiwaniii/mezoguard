// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MezoGuardProtector} from "../src/MezoGuardProtector.sol";
import {MockMUSD, MockPriceFeed, MockTroveManager, MockBorrowerOperationsSignatures} from "./mocks/MezoMocks.sol";

abstract contract ProtectorBase is Test {
    bytes32 internal constant REPAY_TYPEHASH =
        keccak256("RepayMUSD(uint256 amount,address borrower,uint256 nonce,uint256 deadline)");
    bytes32 internal constant ADD_COLL_TYPEHASH =
        keccak256("AddColl(uint256 assetAmount,address borrower,uint256 nonce,uint256 deadline)");

    MockMUSD internal musd;
    MockPriceFeed internal feed;
    MockTroveManager internal tm;
    MockBorrowerOperationsSignatures internal bos;
    MezoGuardProtector internal p;

    uint256 internal aliceKey = 0xA11CE;
    address internal alice;
    address internal keeper = makeAddr("keeper");

    uint256 internal constant PRICE = 100_000e18; // $100k BTC

    function setUp() public virtual {
        vm.chainId(31611);
        vm.warp(1_750_000_000);
        alice = vm.addr(aliceKey);
        musd = new MockMUSD();
        feed = new MockPriceFeed(PRICE);
        tm = new MockTroveManager();
        bos = new MockBorrowerOperationsSignatures(musd, tm, feed);
        tm.setBorrowerOperations(address(bos));
        musd.setSystem(address(bos), false, true);
        p = new MezoGuardProtector(address(musd), address(tm), address(feed), address(bos));

        // Alice: 1 BTC, 70k debt → ICR 142.8%.
        tm.setTrove(alice, 1e18, 70_000e18);
        musd.mint(alice, 100_000e18);
        vm.prank(alice);
        musd.approve(address(p), type(uint256).max);
    }

    function _structHash(uint256 amount, address borrower, uint256 nonce, uint256 deadline)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encodePacked(REPAY_TYPEHASH, abi.encode(amount, borrower), nonce, deadline));
    }

    function _signRepay(uint256 key, uint256 amount, uint256 nonce, uint256 deadline) internal view returns (bytes memory) {
        address borrower = vm.addr(key);
        bytes32 digest = bos.hashTypedDataV4(_structHash(amount, borrower, nonce, deadline));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _armAlice(uint256 amount, uint256 trigger, uint256 deadline, address executor) internal {
        bytes memory sig = _signRepay(aliceKey, amount, bos.getNonce(alice), deadline);
        vm.prank(alice);
        p.arm(amount, trigger, deadline, executor, sig);
    }

    function _deposit(address who, uint256 amount) internal {
        vm.prank(who);
        p.deposit(amount);
    }
}
