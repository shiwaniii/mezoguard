// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {MezoGuardProtector} from "../src/MezoGuardProtector.sol";

/// @notice Deploys MezoGuardProtector to Mezo testnet (31611) and writes deployments/31611.json.
/// Usage (from contracts/):
///   DEPLOYER_PRIVATE_KEY=0x... forge script script/Deploy.s.sol --rpc-url mezo_testnet --broadcast --skip-simulation --legacy
/// --skip-simulation: the BTC price precompile (0x7b7c…0015) cannot be executed by the local EVM.
/// --legacy: Mezo testnet expects legacy (type-0) transactions.
/// Address overrides (defaults = verified addresses in lib/chain/config.ts):
///   MEZO_MUSD, MEZO_TROVE_MANAGER, MEZO_PRICE_FEED, MEZO_BORROWER_OPERATIONS_SIGNATURES
contract Deploy is Script {
    address constant DEFAULT_MUSD = 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503;
    address constant DEFAULT_TROVE_MANAGER = 0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0;
    address constant DEFAULT_PRICE_FEED = 0x86bCF0841622a5dAC14A313a15f96A95421b9366;
    address constant DEFAULT_BOS = 0xD757e3646AF370b15f32EB557F0F8380Df7D639e;

    function run() external returns (MezoGuardProtector p) {
        address musd = vm.envOr("MEZO_MUSD", DEFAULT_MUSD);
        address tm = vm.envOr("MEZO_TROVE_MANAGER", DEFAULT_TROVE_MANAGER);
        address pf = vm.envOr("MEZO_PRICE_FEED", DEFAULT_PRICE_FEED);
        address bos = vm.envOr("MEZO_BORROWER_OPERATIONS_SIGNATURES", DEFAULT_BOS);
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");

        require(block.chainid == 31611, "Deploy: expected Mezo testnet 31611");
        require(musd.code.length > 0 && tm.code.length > 0 && pf.code.length > 0 && bos.code.length > 0, "Deploy: missing code");

        vm.startBroadcast(pk);
        p = new MezoGuardProtector(musd, tm, pf, bos);
        vm.stopBroadcast();

        console2.log("MezoGuardProtector:", address(p));

        string memory k = "deployment";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeAddress(k, "deployer", vm.addr(pk));
        vm.serializeUint(k, "block", block.number);
        vm.serializeAddress(k, "musd", musd);
        vm.serializeAddress(k, "troveManager", tm);
        vm.serializeAddress(k, "priceFeed", pf);
        vm.serializeAddress(k, "borrowerOperationsSignatures", bos);
        string memory json = vm.serializeAddress(k, "MezoGuardProtector", address(p));
        vm.writeJson(json, "./deployments/31611.json");
    }
}
