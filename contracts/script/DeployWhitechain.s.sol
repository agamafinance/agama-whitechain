// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";

import {TestUSDC} from "../src/mocks/TestUSDC.sol";
import {AttestedMessenger, IBurnMintToken} from "../src/cctp/AttestedMessenger.sol";
import {AgUSD} from "../src/whitechain/AgUSD.sol";
import {CrossChainAllocator} from "../src/whitechain/CrossChainAllocator.sol";
import {ITokenMessengerV2} from "../src/interfaces/cctp/ITokenMessengerV2.sol";
import {IMessageTransmitterV2} from "../src/interfaces/cctp/IMessageTransmitterV2.sol";
import {Domains} from "./Domains.sol";

/// @notice Step 1 of 3. The Whitechain leg: test dollar, messenger, agUSD, allocator, and a first deposit so the
///         vault opens with a price rather than an empty supply.
/// @dev forge script script/DeployWhitechain.s.sol --rpc-url whitechain_sepolia --broadcast \
///        --verify --verifier blockscout --verifier-url https://explorer.testnet.whitechain.io/api/
contract DeployWhitechain is Script {
    uint256 internal constant SEED = 10_000e6;

    function run() external {
        require(block.chainid == Domains.WHITECHAIN_SEPOLIA_CHAIN_ID, "not Whitechain Sepolia");
        uint256 key = vm.envUint("DEPLOYER_KEY");
        address deployer = vm.addr(key);
        address attester = vm.envAddress("ATTESTER");

        vm.startBroadcast(key);

        TestUSDC usdc = new TestUSDC(deployer);
        AttestedMessenger messenger =
            new AttestedMessenger(Domains.WHITECHAIN, IBurnMintToken(address(usdc)), attester, deployer);
        usdc.grantRole(usdc.MINTER_ROLE(), address(messenger));

        // Testnet tempo: reports every ten minutes and a six hour unlock, so a demo moves while somebody watches.
        AgUSD vault = new AgUSD(
            usdc,
            deployer,
            AgUSD.Config({
                depositCap: 5_000_000e6,
                reserveBps: 1_000,
                performanceFeeBps: 1_000,
                maxNavChangeBps: 500,
                minReportInterval: 10 minutes,
                profitVestingPeriod: 6 hours,
                feeRecipient: deployer
            })
        );
        CrossChainAllocator allocator = new CrossChainAllocator(
            vault,
            ITokenMessengerV2(address(messenger)),
            IMessageTransmitterV2(address(messenger)),
            Domains.ETHEREUM,
            deployer
        );
        vault.grantRole(vault.ALLOCATOR_ROLE(), address(allocator));
        vault.grantRole(vault.REPORTER_ROLE(), deployer);

        usdc.faucet();
        usdc.approve(address(vault), SEED);
        vault.deposit(SEED, deployer);

        vm.stopBroadcast();

        string memory j = "whitechain";
        vm.serializeUint(j, "chainId", block.chainid);
        vm.serializeUint(j, "domain", Domains.WHITECHAIN);
        vm.serializeUint(j, "deployedAtBlock", block.number);
        vm.serializeAddress(j, "usdc", address(usdc));
        vm.serializeAddress(j, "messenger", address(messenger));
        vm.serializeAddress(j, "agUSD", address(vault));
        vm.serializeAddress(j, "allocator", address(allocator));
        vm.serializeAddress(j, "attester", attester);
        string memory out = vm.serializeAddress(j, "admin", deployer);
        vm.writeJson(out, "./deployments/whitechain-sepolia.json");

        console2.log("agUSD     ", address(vault));
        console2.log("allocator ", address(allocator));
    }
}
