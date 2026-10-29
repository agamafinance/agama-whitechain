// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {Test, Vm} from "forge-std/Test.sol";

import {TestUSDC} from "../../src/mocks/TestUSDC.sol";
import {AttestedMessenger, IBurnMintToken} from "../../src/cctp/AttestedMessenger.sol";
import {AgUSD} from "../../src/whitechain/AgUSD.sol";
import {CrossChainAllocator} from "../../src/whitechain/CrossChainAllocator.sol";
import {AbfAssetIssuer} from "../../src/l1/AbfAssetIssuer.sol";
import {AgamaL1Receiver} from "../../src/l1/AgamaL1Receiver.sol";
import {ITokenMessengerV2} from "../../src/interfaces/cctp/ITokenMessengerV2.sol";
import {IMessageTransmitterV2} from "../../src/interfaces/cctp/IMessageTransmitterV2.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";

/// @notice Both legs in one EVM: Whitechain on one messenger and one test dollar, Ethereum on another pair, with
///         the attester played by a key the test holds. Messages are captured from the logs exactly as the relayer
///         captures them from a receipt.
abstract contract Fixture is Test {
    uint32 internal constant WHITECHAIN = 1874;
    uint32 internal constant ETHEREUM = 0;

    uint256 internal attesterKey = 0xA77E57;
    address internal attester;
    address internal admin = makeAddr("admin");
    address internal treasury = makeAddr("treasury");
    address internal custody = makeAddr("custody");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    // Whitechain
    TestUSDC internal wUsdc;
    AttestedMessenger internal wMessenger;
    AgUSD internal vault;
    CrossChainAllocator internal allocator;

    // Ethereum
    TestUSDC internal eUsdc;
    AttestedMessenger internal eMessenger;
    AbfAssetIssuer internal issuer;
    AgamaL1Receiver internal receiver;

    function defaultConfig() internal view returns (AgUSD.Config memory) {
        return AgUSD.Config({
            depositCap: 10_000_000e6,
            reserveBps: 1_000,
            performanceFeeBps: 1_000,
            maxNavChangeBps: 500,
            minReportInterval: 1 hours,
            profitVestingPeriod: 1 days,
            feeRecipient: treasury
        });
    }

    function setUp() public virtual {
        attester = vm.addr(attesterKey);
        vm.startPrank(admin);

        wUsdc = new TestUSDC(admin);
        wMessenger = new AttestedMessenger(WHITECHAIN, IBurnMintToken(address(wUsdc)), attester, admin);
        wUsdc.grantRole(wUsdc.MINTER_ROLE(), address(wMessenger));
        vault = new AgUSD(wUsdc, admin, defaultConfig());
        allocator = new CrossChainAllocator(
            vault, ITokenMessengerV2(address(wMessenger)), IMessageTransmitterV2(address(wMessenger)), ETHEREUM, admin
        );
        vault.grantRole(vault.ALLOCATOR_ROLE(), address(allocator));
        vault.grantRole(vault.REPORTER_ROLE(), admin);

        eUsdc = new TestUSDC(admin);
        eMessenger = new AttestedMessenger(ETHEREUM, IBurnMintToken(address(eUsdc)), attester, admin);
        eUsdc.grantRole(eUsdc.MINTER_ROLE(), address(eMessenger));
        issuer = new AbfAssetIssuer(eUsdc, admin, custody, 9_000);
        receiver = new AgamaL1Receiver(
            eUsdc,
            IMessageTransmitterV2(address(eMessenger)),
            ITokenMessengerV2(address(eMessenger)),
            IERC4626(address(issuer)),
            WHITECHAIN,
            _b32(address(allocator)),
            admin
        );
        issuer.setAllowlisted(address(receiver), true);
        allocator.setRemoteReceiver(_b32(address(receiver)));

        wMessenger.setRemote(ETHEREUM, _b32(address(eMessenger)), _b32(address(eUsdc)));
        eMessenger.setRemote(WHITECHAIN, _b32(address(wMessenger)), _b32(address(wUsdc)));

        // Off-chain income on the test chain is minted, the way a borrower's repayment would arrive at custody.
        eUsdc.grantRole(eUsdc.MINTER_ROLE(), admin);
        wUsdc.grantRole(wUsdc.MINTER_ROLE(), admin);
        vm.stopPrank();

        vm.prank(custody);
        eUsdc.approve(address(issuer), type(uint256).max);
        vm.warp(1_800_000_000);
    }

    // ---- helpers ----

    function _b32(address a) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(a)));
    }

    function _fund(address who, uint256 amount) internal {
        vm.prank(admin);
        wUsdc.mint(who, amount);
    }

    function _deposit(address who, uint256 amount) internal returns (uint256 shares) {
        _fund(who, amount);
        vm.startPrank(who);
        wUsdc.approve(address(vault), amount);
        shares = vault.deposit(amount, who);
        vm.stopPrank();
    }

    function _attest(bytes memory message) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attesterKey, keccak256(message));
        return abi.encodePacked(r, s, v);
    }

    /// @dev The last MessageSent in the recorded logs, which is what a relayer reads off the receipt.
    function _lastMessage() internal returns (bytes memory message) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 topic = keccak256("MessageSent(bytes)");
        for (uint256 i = logs.length; i > 0; i--) {
            if (logs[i - 1].topics[0] == topic) return abi.decode(logs[i - 1].data, (bytes));
        }
        revert("no MessageSent");
    }
}
