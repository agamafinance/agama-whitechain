// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {Fixture} from "./utils/Fixture.sol";
import {AbfAssetIssuer} from "../src/l1/AbfAssetIssuer.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";

/// @notice The issuer's closed doors, and the order cash and NAV have to arrive in.
contract AbfAssetIssuerTest is Fixture {
    address internal investor = makeAddr("investor");

    function setUp() public override {
        super.setUp();
        vm.startPrank(admin);
        issuer.setAllowlisted(investor, true);
        eUsdc.mint(investor, 1_000_000e6);
        vm.stopPrank();
        vm.prank(investor);
        eUsdc.approve(address(issuer), type(uint256).max);
    }

    function _subscribe(uint256 amount) internal {
        vm.prank(investor);
        issuer.deposit(amount, investor);
    }

    function test_somebodyComplianceHasNotSeenCannotSubscribe() public {
        vm.prank(admin);
        eUsdc.mint(bob, 10e6);
        vm.startPrank(bob);
        eUsdc.approve(address(issuer), 10e6);
        vm.expectRevert(abi.encodeWithSelector(ERC4626.ERC4626ExceededMaxDeposit.selector, bob, 10e6, 0));
        issuer.deposit(10e6, bob);
        vm.stopPrank();
    }

    function test_notesOnlyMoveBetweenAllowlistedHolders() public {
        _subscribe(100e6);
        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(AbfAssetIssuer.NotAllowlisted.selector, bob));
        // forge-lint: disable-next-line(erc20-unchecked-transfer)
        issuer.transfer(bob, 1e6);
    }

    function test_theBookIsCappedAtItsShareOfTheIssuer() public {
        _subscribe(1_000e6);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(AbfAssetIssuer.OffChainCap.selector, 901e6, 900e6));
        issuer.offRamp(901e6, "too-much");
    }

    function test_aRaisedNavIsAClaimNotCash() public {
        _subscribe(1_000e6);
        vm.startPrank(admin);
        issuer.offRamp(900e6, "wire");
        issuer.reportNav(990e6, "tape");
        vm.stopPrank();

        assertEq(issuer.totalAssets(), 1_090e6);
        // Worth 1,090 and only 100 of it is here: the redemption is bounded by the cash, not the NAV.
        assertEq(issuer.maxWithdraw(investor), 100e6);
        vm.prank(investor);
        vm.expectRevert();
        issuer.withdraw(101e6, investor, investor);
    }

    function test_collectionsComingHomeMakeTheYieldPayable() public {
        _subscribe(1_000e6);
        vm.startPrank(admin);
        issuer.offRamp(900e6, "wire");
        issuer.reportNav(990e6, "tape");
        eUsdc.mint(custody, 90e6); // the borrowers' interest
        issuer.onRamp(990e6, "collections");
        vm.stopPrank();

        assertEq(issuer.offChainAssets(), 0);
        assertEq(issuer.cash(), 1_090e6);
        uint256 shares = issuer.balanceOf(investor);
        vm.prank(investor);
        uint256 out = issuer.redeem(shares, investor, investor);
        assertApproxEqAbs(out, 1_090e6, 1);
    }

    function test_onlyTheIssuerTouchesTheBook() public {
        _subscribe(1_000e6);
        vm.startPrank(bob);
        vm.expectRevert();
        issuer.offRamp(1e6, "x");
        vm.expectRevert();
        issuer.reportNav(1e6, "x");
        vm.expectRevert();
        issuer.onRamp(1e6, "x");
        vm.stopPrank();
    }

    function testFuzz_navMovesThePriceAndNotTheShareCount(uint256 amount, uint256 yieldBps) public {
        amount = bound(amount, 1e6, 1_000_000e6);
        yieldBps = bound(yieldBps, 0, 2_000);
        _subscribe(amount);
        uint256 shares = issuer.balanceOf(investor);
        uint256 out = amount * 9 / 10;
        vm.startPrank(admin);
        issuer.offRamp(out, "wire");
        issuer.reportNav(out + out * yieldBps / 10_000, "tape");
        vm.stopPrank();
        assertEq(issuer.balanceOf(investor), shares);
        assertApproxEqAbs(issuer.convertToAssets(shares), amount + out * yieldBps / 10_000, 1);
    }
}
