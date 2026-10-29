// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {Fixture} from "./utils/Fixture.sol";
import {AttestedMessenger} from "../src/cctp/AttestedMessenger.sol";
import {CrossChainAllocator} from "../src/whitechain/CrossChainAllocator.sol";
import {AgamaL1Receiver} from "../src/l1/AgamaL1Receiver.sol";

/// @notice The whole route, in the order it runs on the two testnets: deposit on Whitechain, cross to Ethereum,
///         subscribe, off-ramp, earn off chain, mark, on-ramp, redeem, cross back, and a holder leaves richer.
contract RoundTripTest is Fixture {
    function _allocate(uint256 amount) internal returns (bytes memory message) {
        vm.recordLogs();
        vm.prank(admin);
        allocator.allocate(amount);
        message = _lastMessage();
    }

    function _nav() internal view returns (uint256) {
        // What the keeper reports: the L1 position plus whatever is still crossing in either direction.
        uint256 outbound = allocator.totalSent() - receiver.totalReceived();
        uint256 inbound = receiver.totalSentHome() - allocator.totalReturned();
        return receiver.positionValue() + outbound + inbound;
    }

    function test_theWholeRoute() public {
        _deposit(alice, 1_000_000e6);
        uint256 priceBefore = vault.sharePrice();

        // 1. Out: 800k of the 1M crosses, the 10% reserve floor stays behind with room to spare.
        bytes memory out = _allocate(800_000e6);
        assertEq(vault.deployedAssets(), 800_000e6);
        assertEq(wUsdc.balanceOf(address(vault)), 200_000e6);
        assertEq(vault.totalAssets(), 1_000_000e6, "a crossing is not a loss");

        // 2. In on Ethereum, subscribed by the hook in the same call.
        receiver.relay(out, _attest(out));
        assertEq(issuer.balanceOf(address(receiver)), 800_000e6);
        assertEq(_nav(), 800_000e6);

        // 3. The issuer wires 90% to custody and the book earns 10% a year for a quarter.
        vm.startPrank(admin);
        issuer.offRamp(720_000e6, "wire-0001");
        assertEq(eUsdc.balanceOf(custody), 720_000e6);
        vm.warp(block.timestamp + 91 days);
        uint256 interest = uint256(720_000e6) * 1_000 * 91 / (10_000 * 365);
        issuer.reportNav(720_000e6 + interest, keccak256("loan-tape-Q1"));
        vm.stopPrank();
        assertApproxEqAbs(_nav(), 800_000e6 + interest, 1);

        // 4. Whitechain marks it. The gain unlocks over a day rather than in one block.
        uint256 nav = _nav();
        vm.prank(admin);
        vault.reportNav(nav);
        assertEq(vault.sharePrice(), priceBefore + 0, "nothing unlocked in the report's own block");
        vm.warp(block.timestamp + 1 days);
        assertGt(vault.sharePrice(), priceBefore);

        // 5. Collections come home: custody on-ramps principal and interest, the receiver redeems and burns back.
        vm.startPrank(admin);
        eUsdc.mint(custody, interest);
        issuer.onRamp(720_000e6 + interest, "collections-Q1");
        vm.recordLogs();
        receiver.redeemAndSendHome(issuer.balanceOf(address(receiver)));
        vm.stopPrank();
        bytes memory back = _lastMessage();
        assertApproxEqAbs(_nav(), 800_000e6 + interest, 1, "in flight home still counts");

        // 6. Anyone relays it on Whitechain. The vault is whole and then some.
        vm.prank(bob);
        allocator.settleReturn(back, _attest(back));
        assertEq(vault.deployedAssets(), 0);
        assertApproxEqAbs(wUsdc.balanceOf(address(vault)), 1_000_000e6 + interest, 1);

        // 7. Alice leaves with her principal and the yield, net of the 10% performance fee.
        vm.warp(block.timestamp + 1 days);
        uint256 shares = vault.balanceOf(alice);
        vm.prank(alice);
        uint256 paid = vault.redeem(shares, alice, alice);
        uint256 expected = 1_000_000e6 + interest * 9 / 10;
        assertApproxEqRel(paid, expected, 1e14);
        assertGt(vault.balanceOf(treasury), 0, "the fee was taken in shares");
    }

    function test_aMessageCanOnlyBeExecutedByTheContractItWasMeantFor() public {
        _deposit(alice, 100e6);
        bytes memory out = _allocate(50e6);
        bytes memory att = _attest(out);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(AttestedMessenger.WrongCaller.selector, _b32(address(receiver))));
        eMessenger.receiveMessage(out, att);

        receiver.relay(out, att);
        vm.expectRevert(abi.encodeWithSelector(AttestedMessenger.NonceUsed.selector, bytes32(_nonce(out))));
        receiver.relay(out, att);
    }

    function test_aForgedAttestationIsRefused() public {
        _deposit(alice, 100e6);
        bytes memory out = _allocate(50e6);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xBAD, keccak256(out));
        vm.expectRevert(AttestedMessenger.InvalidAttestation.selector);
        receiver.relay(out, abi.encodePacked(r, s, v));
    }

    function test_aTamperedMessageNoLongerMatchesItsAttestation() public {
        _deposit(alice, 100e6);
        bytes memory out = _allocate(50e6);
        bytes memory att = _attest(out);
        out[148 + 68 + 31] = bytes1(uint8(out[148 + 68 + 31]) + 1); // nudge the amount by one unit
        vm.expectRevert(AttestedMessenger.InvalidAttestation.selector);
        receiver.relay(out, att);
    }

    function test_theReceiverOnlyAcceptsTheAllocator() public {
        // A burn by somebody else towards the receiver is valid CCTP, and still not ours to subscribe.
        _fund(bob, 10e6);
        vm.startPrank(bob);
        wUsdc.approve(address(wMessenger), 10e6);
        vm.recordLogs();
        wMessenger.depositForBurn(10e6, ETHEREUM, _b32(address(receiver)), address(wUsdc), bytes32(0), 0, 2000);
        vm.stopPrank();
        bytes memory m = _lastMessage();
        vm.expectRevert(abi.encodeWithSelector(AgamaL1Receiver.WrongSender.selector, _b32(bob)));
        receiver.relay(m, _attest(m));
    }

    function test_theDestinationIsLockedWhileCapitalIsOut() public {
        _deposit(alice, 100e6);
        _allocate(50e6);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(CrossChainAllocator.ReceiverLocked.selector, 50e6));
        allocator.setRemoteReceiver(_b32(bob));
    }

    function test_theAllowanceDoesNotOutliveTheBurn() public {
        _deposit(alice, 100e6);
        _allocate(50e6);
        assertEq(wUsdc.allowance(address(allocator), address(wMessenger)), 0);
    }

    function test_burnAndMintConservesSupplyAcrossBothLegs() public {
        _deposit(alice, 1_000e6);
        uint256 before = wUsdc.totalSupply() + eUsdc.totalSupply();
        bytes memory out = _allocate(600e6);
        assertEq(wUsdc.totalSupply() + eUsdc.totalSupply(), before - 600e6, "burned, not yet minted");
        receiver.relay(out, _attest(out));
        assertEq(wUsdc.totalSupply() + eUsdc.totalSupply(), before);
    }

    function _nonce(bytes memory m) private pure returns (uint256 n) {
        assembly {
            n := mload(add(m, add(32, 12)))
        }
    }
}
