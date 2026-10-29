// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {Fixture} from "./utils/Fixture.sol";
import {AttestedMessenger} from "../src/cctp/AttestedMessenger.sol";
import {CctpMessageV2Harness} from "./utils/CctpMessageV2Harness.sol";

/// @notice The transport on its own, held to Circle's layout.
contract AttestedMessengerTest is Fixture {
    CctpMessageV2Harness internal h = new CctpMessageV2Harness();

    function _burn(address from, uint256 amount, bytes32 to, bytes32 caller, bytes memory hook)
        internal
        returns (bytes memory)
    {
        _fund(from, amount);
        vm.startPrank(from);
        wUsdc.approve(address(wMessenger), amount);
        vm.recordLogs();
        wMessenger.depositForBurnWithHook(amount, ETHEREUM, to, address(wUsdc), caller, 0, 2000, hook);
        vm.stopPrank();
        return _lastMessage();
    }

    function test_theMessageIsLaidOutAtCirclesOffsets() public {
        bytes memory m = _burn(alice, 42e6, _b32(bob), bytes32(0), hex"c0ffee");
        assertEq(h.sourceDomain(m), WHITECHAIN);
        assertEq(h.destinationDomain(m), ETHEREUM);
        assertEq(h.sender(m), _b32(address(wMessenger)));
        assertEq(h.recipient(m), _b32(address(eMessenger)));
        assertEq(h.destinationCaller(m), bytes32(0));
        assertEq(h.burnToken(m), address(wUsdc));
        assertEq(h.mintRecipient(m), _b32(bob));
        assertEq(h.amount(m), 42e6);
        assertEq(h.messageSender(m), _b32(alice));
        assertEq(h.hookData(m), hex"c0ffee");
        assertEq(m.length, 148 + 228 + 3, "envelope + burn body + hook");
    }

    function test_burnsOnOneSideAndMintsOnTheOther() public {
        bytes memory m = _burn(alice, 42e6, _b32(bob), bytes32(0), "");
        assertEq(wUsdc.balanceOf(alice), 0);
        eMessenger.receiveMessage(m, _attest(m));
        assertEq(eUsdc.balanceOf(bob), 42e6);
    }

    function test_aReplayIsRefused() public {
        bytes memory m = _burn(alice, 1e6, _b32(bob), bytes32(0), "");
        bytes memory a = _attest(m);
        eMessenger.receiveMessage(m, a);
        vm.expectRevert();
        eMessenger.receiveMessage(m, a);
    }

    function test_aMessageForAnotherDomainIsRefused() public {
        bytes memory m = _burn(alice, 1e6, _b32(bob), bytes32(0), "");
        vm.expectRevert(abi.encodeWithSelector(AttestedMessenger.WrongDestination.selector, ETHEREUM));
        wMessenger.receiveMessage(m, _attest(m));
    }

    function test_anUnknownDomainCannotBeBurnedTowards() public {
        _fund(alice, 1e6);
        vm.startPrank(alice);
        wUsdc.approve(address(wMessenger), 1e6);
        vm.expectRevert(abi.encodeWithSelector(AttestedMessenger.UnknownDomain.selector, uint32(6)));
        wMessenger.depositForBurn(1e6, 6, _b32(bob), address(wUsdc), bytes32(0), 0, 2000);
        vm.stopPrank();
    }

    function test_anAddressThatIsNotOneIsRefusedRatherThanTruncated() public {
        bytes32 dirty = bytes32(uint256(1) << 200 | uint256(uint160(bob)));
        bytes memory m = _burn(alice, 1e6, dirty, bytes32(0), "");
        vm.expectRevert();
        eMessenger.receiveMessage(m, _attest(m));
    }

    function test_onlyTheOwnerRotatesTheAttester() public {
        vm.prank(bob);
        vm.expectRevert();
        eMessenger.setAttester(bob);
        vm.prank(admin);
        eMessenger.setAttester(bob);
        assertEq(eMessenger.attester(), bob);
    }

    function testFuzz_anyAmountCrossesWhole(uint96 amount) public {
        vm.assume(amount > 0);
        bytes memory m = _burn(alice, amount, _b32(bob), bytes32(0), "");
        eMessenger.receiveMessage(m, _attest(m));
        assertEq(eUsdc.balanceOf(bob), amount);
    }
}
