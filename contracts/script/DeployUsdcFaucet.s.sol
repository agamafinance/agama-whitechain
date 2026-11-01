// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {TestUSDC} from "../src/mocks/TestUSDC.sol";
import {UsdcFaucet} from "../src/mocks/UsdcFaucet.sol";

/// forge script script/DeployUsdcFaucet.s.sol --rpc-url whitechain_sepolia --broadcast
/// Deploys the cooldown-free faucet next to an existing TestUSDC and gives it MINTER_ROLE.
contract DeployUsdcFaucet is Script {
    function run() external {
        TestUSDC usdc = TestUSDC(vm.parseJsonAddress(vm.readFile("deployments/whitechain-sepolia.json"), ".usdc"));
        vm.startBroadcast(vm.envUint("DEPLOYER_KEY"));
        UsdcFaucet faucet = new UsdcFaucet(usdc);
        usdc.grantRole(usdc.MINTER_ROLE(), address(faucet));
        vm.stopBroadcast();
        console.log("usdcFaucet", address(faucet));
    }
}
