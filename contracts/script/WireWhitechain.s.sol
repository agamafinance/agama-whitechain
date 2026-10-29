// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";

import {AttestedMessenger} from "../src/cctp/AttestedMessenger.sol";
import {CrossChainAllocator} from "../src/whitechain/CrossChainAllocator.sol";
import {Domains} from "./Domains.sol";

/// @notice Step 3 of 3. Points Whitechain at what step 2 deployed: the allocator at the receiver, the messenger
///         at its Ethereum twin. The allocator refuses a new receiver while capital is out, so this only runs
///         against an empty book.
contract WireWhitechain is Script {
    function run() external {
        require(block.chainid == Domains.WHITECHAIN_SEPOLIA_CHAIN_ID, "not Whitechain Sepolia");
        uint256 key = vm.envUint("DEPLOYER_KEY");

        string memory w = vm.readFile("./deployments/whitechain-sepolia.json");
        string memory e = vm.readFile("./deployments/ethereum-sepolia.json");

        vm.startBroadcast(key);
        CrossChainAllocator(vm.parseJsonAddress(w, ".allocator")).setRemoteReceiver(
            bytes32(uint256(uint160(vm.parseJsonAddress(e, ".receiver"))))
        );
        AttestedMessenger(vm.parseJsonAddress(w, ".messenger")).setRemote(
            Domains.ETHEREUM,
            bytes32(uint256(uint160(vm.parseJsonAddress(e, ".messenger")))),
            bytes32(uint256(uint160(vm.parseJsonAddress(e, ".usdc"))))
        );
        vm.stopBroadcast();
    }
}
