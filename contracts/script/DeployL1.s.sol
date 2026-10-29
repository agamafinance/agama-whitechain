// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";

import {TestUSDC} from "../src/mocks/TestUSDC.sol";
import {AttestedMessenger, IBurnMintToken} from "../src/cctp/AttestedMessenger.sol";
import {AbfAssetIssuer} from "../src/l1/AbfAssetIssuer.sol";
import {AgamaL1Receiver} from "../src/l1/AgamaL1Receiver.sol";
import {ITokenMessengerV2} from "../src/interfaces/cctp/ITokenMessengerV2.sol";
import {IMessageTransmitterV2} from "../src/interfaces/cctp/IMessageTransmitterV2.sol";
import {Domains} from "./Domains.sol";

/// @notice Step 2 of 3. The Ethereum Sepolia leg: test dollar, messenger, the simulated ABF issuer and the
///         receiver, which needs the Whitechain allocator's address and so comes second.
contract DeployL1 is Script {
    function run() external {
        require(block.chainid == Domains.ETHEREUM_SEPOLIA_CHAIN_ID, "not Ethereum Sepolia");
        uint256 key = vm.envUint("DEPLOYER_KEY");
        address deployer = vm.addr(key);
        address attester = vm.envAddress("ATTESTER");

        string memory w = vm.readFile("./deployments/whitechain-sepolia.json");
        address allocator = vm.parseJsonAddress(w, ".allocator");
        address wMessenger = vm.parseJsonAddress(w, ".messenger");
        address wUsdc = vm.parseJsonAddress(w, ".usdc");

        vm.startBroadcast(key);

        TestUSDC usdc = new TestUSDC(deployer);
        AttestedMessenger messenger =
            new AttestedMessenger(Domains.ETHEREUM, IBurnMintToken(address(usdc)), attester, deployer);
        usdc.grantRole(usdc.MINTER_ROLE(), address(messenger));
        // Interest from the borrowers arrives at custody off chain. On the test chain it is minted there.
        usdc.grantRole(usdc.MINTER_ROLE(), deployer);

        // TESTNET: the deployer is custody too, the SPV's bank account stood in for by a key.
        AbfAssetIssuer issuer = new AbfAssetIssuer(usdc, deployer, deployer, 9_000);
        AgamaL1Receiver receiver = new AgamaL1Receiver(
            usdc,
            IMessageTransmitterV2(address(messenger)),
            ITokenMessengerV2(address(messenger)),
            IERC4626(address(issuer)),
            Domains.WHITECHAIN,
            bytes32(uint256(uint160(allocator))),
            deployer
        );
        issuer.setAllowlisted(address(receiver), true);
        usdc.approve(address(issuer), type(uint256).max); // custody's standing approval for on-ramps

        messenger.setRemote(
            Domains.WHITECHAIN, bytes32(uint256(uint160(wMessenger))), bytes32(uint256(uint160(wUsdc)))
        );

        vm.stopBroadcast();

        string memory j = "l1";
        vm.serializeUint(j, "chainId", block.chainid);
        vm.serializeUint(j, "domain", Domains.ETHEREUM);
        vm.serializeUint(j, "deployedAtBlock", block.number);
        vm.serializeAddress(j, "usdc", address(usdc));
        vm.serializeAddress(j, "messenger", address(messenger));
        vm.serializeAddress(j, "issuer", address(issuer));
        vm.serializeAddress(j, "receiver", address(receiver));
        vm.serializeAddress(j, "custody", deployer);
        string memory out = vm.serializeAddress(j, "admin", deployer);
        vm.writeJson(out, "./deployments/ethereum-sepolia.json");

        console2.log("issuer   ", address(issuer));
        console2.log("receiver ", address(receiver));
    }
}
