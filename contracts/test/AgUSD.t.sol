// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {Fixture} from "./utils/Fixture.sol";
import {AgUSD} from "../src/whitechain/AgUSD.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @notice agUSD on its own. The allocator role is played by the admin directly, so every number here is the
///         vault's arithmetic and nobody else's.
contract AgUSDTest is Fixture {
    function setUp() public override {
        super.setUp();
        vm.startPrank(admin);
        vault.grantRole(vault.ALLOCATOR_ROLE(), admin);
        wUsdc.approve(address(vault), type(uint256).max);
        vm.stopPrank();
    }

    function _push(uint256 amount) internal {
        vm.prank(admin);
        vault.pushToStrategy(amount);
    }

    function _report(uint256 nav) internal {
        skip(1 hours);
        vm.prank(admin);
        vault.reportNav(nav);
    }

    // ---- the basics ----

    function test_metadata() public view {
        assertEq(vault.name(), "Agama USD");
        assertEq(vault.symbol(), "agUSD");
        assertEq(vault.decimals(), 6);
        assertEq(vault.asset(), address(wUsdc));
    }

    function test_firstDepositIsOneForOne() public {
        assertEq(_deposit(alice, 1_000e6), 1_000e6);
        assertEq(vault.sharePrice(), 1e6);
    }

    function test_depositCapIsReportedAndEnforced() public {
        _deposit(alice, 9_999_000e6);
        assertEq(vault.maxDeposit(bob), 1_000e6);
        _fund(bob, 1_001e6);
        vm.startPrank(bob);
        wUsdc.approve(address(vault), 1_001e6);
        vm.expectRevert(abi.encodeWithSelector(ERC4626.ERC4626ExceededMaxDeposit.selector, bob, 1_001e6, 1_000e6));
        vault.deposit(1_001e6, bob);
        vm.stopPrank();
    }

    // ---- the buffer ----

    function test_maxWithdrawIsTheBufferNotTheBalance() public {
        _deposit(alice, 1_000e6);
        _push(800e6);
        assertEq(vault.maxWithdraw(alice), 200e6);
        assertEq(vault.maxRedeem(alice), 200e6);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ERC4626.ERC4626ExceededMaxWithdraw.selector, alice, 201e6, 200e6));
        vault.withdraw(201e6, alice, alice);

        vm.prank(alice);
        vault.withdraw(200e6, alice, alice);
        assertEq(wUsdc.balanceOf(alice), 200e6);
    }

    function test_theAllocatorCannotSpendThroughTheReserveFloor() public {
        _deposit(alice, 1_000e6);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(AgUSD.ReserveFloor.selector, 99e6, 100e6));
        vault.pushToStrategy(901e6);
        _push(900e6);
    }

    function test_onlyTheAllocatorMovesCapital() public {
        _deposit(alice, 1_000e6);
        vm.prank(bob);
        vm.expectRevert();
        vault.pushToStrategy(1e6);
    }

    // ---- the queue ----

    function test_aLargeExitQueuesAtTodaysPriceAndIsPaidWhenCashComesHome() public {
        _deposit(alice, 1_000e6);
        _push(900e6);

        vm.prank(alice);
        uint256 id = vault.requestRedeem(500e6, alice, alice);
        assertEq(vault.balanceOf(alice), 500e6, "shares burned at request");
        assertEq(vault.pendingRedemptions(), 500e6);
        assertEq(wUsdc.balanceOf(alice), 0, "not enough cash to pay yet");
        assertEq(vault.totalAssets(), 500e6);
        assertEq(vault.sharePrice(), 1e6, "leaving does not move the price for those who stay");

        // Instant exits can no longer reach the cash the queue is owed.
        assertEq(vault.maxWithdraw(alice), 0);

        vm.prank(admin);
        vault.returnFromStrategy(400e6);
        assertEq(wUsdc.balanceOf(alice), 500e6, "settled by the return itself");
        assertEq(vault.pendingRedemptions(), 0);
        (address receiver,,) = vault.redemptions(id);
        assertEq(receiver, address(0), "cleared");
    }

    function test_theQueueIsFirstInFirstOut() public {
        _deposit(alice, 1_000e6);
        _deposit(bob, 1_000e6);
        _push(1_800e6);
        vm.prank(alice);
        vault.requestRedeem(300e6, alice, alice);
        vm.prank(bob);
        vault.requestRedeem(300e6, bob, bob);
        assertEq(wUsdc.balanceOf(alice), 0);

        vm.prank(admin);
        vault.returnFromStrategy(150e6); // 350 idle: alice's 300 fits, bob's does not
        assertEq(wUsdc.balanceOf(alice), 300e6);
        assertEq(wUsdc.balanceOf(bob), 0);
        assertEq(vault.nextToSettle(), 1);

        vm.prank(admin);
        vault.returnFromStrategy(300e6);
        assertEq(wUsdc.balanceOf(bob), 300e6);
    }

    function test_requestRedeemOnBehalfSpendsTheAllowance() public {
        _deposit(alice, 100e6);
        vm.prank(bob);
        vm.expectRevert();
        vault.requestRedeem(10e6, bob, alice);

        vm.prank(alice);
        vault.approve(bob, 10e6);
        vm.prank(bob);
        vault.requestRedeem(10e6, bob, alice);
        assertEq(wUsdc.balanceOf(bob), 10e6);
    }

    // ---- NAV ----

    function test_aGainUnlocksLinearlyAndIsNotSandwichable() public {
        _deposit(alice, 1_000_000e6);
        _push(800_000e6);
        uint256 p0 = vault.sharePrice();

        _report(840_000e6); // +40k, 5% of deployed
        assertApproxEqAbs(vault.sharePrice(), p0, 1, "the report's own block sees nothing");

        // A depositor arriving right after the report buys at the old price, and gets only what unlocks after.
        skip(12 hours);
        uint256 mid = vault.sharePrice();
        assertGt(mid, p0);
        skip(12 hours);
        uint256 full = vault.sharePrice();
        assertApproxEqAbs(full - p0, (mid - p0) * 2, 2, "linear");
        // 40k gain, 4k fee to treasury in shares, 36k to holders: alice's 1M shares are worth 1.036M.
        assertApproxEqRel(vault.convertToAssets(vault.balanceOf(alice)), 1_036_000e6, 1e12);
        assertApproxEqRel(vault.convertToAssets(vault.balanceOf(treasury)), 4_000e6, 1e12, "exactly the fee, once vested");
    }

    function test_aLossEatsUnvestedProfitFirst() public {
        _deposit(alice, 1_000_000e6);
        _push(800_000e6);
        _report(840_000e6);
        skip(1 hours);
        uint256 pBefore = vault.sharePrice();
        vm.prank(admin);
        vault.reportNav(820_000e6); // -20k, absorbed by the ~34.5k still locked
        assertApproxEqAbs(vault.sharePrice(), pBefore, 1, "the holders' price does not move");
        assertGt(vault.unvestedProfit(), 14_000e6);
    }

    function test_aLossBeyondTheLockReachesThePrice() public {
        _deposit(alice, 1_000_000e6);
        _push(800_000e6);
        _report(760_000e6); // -40k, nothing locked to absorb it
        assertEq(vault.totalAssets(), 960_000e6);
        assertEq(vault.sharePrice(), 960_000);
    }

    function test_reportGuards() public {
        _deposit(alice, 1_000_000e6);

        vm.prank(admin);
        vm.expectRevert(AgUSD.NothingDeployed.selector);
        vault.reportNav(1);

        _push(800_000e6);
        skip(1 hours);
        // 501 bps on 800k. The guard reads whole basis points, so a move has to clear the bound by one to trip it.
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(AgUSD.NavChangeTooLarge.selector, 800_000e6, 840_080e6));
        vault.reportNav(840_080e6);

        vm.prank(admin);
        vault.reportNav(810_000e6);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(AgUSD.ReportTooSoon.selector, vm.getBlockTimestamp() + 1 hours));
        vault.reportNav(811_000e6);

        vm.prank(bob);
        vm.expectRevert();
        vault.reportNav(811_000e6);
    }

    function test_cashBeyondTheBookIsRecognizedNotDumpedInThePrice() public {
        _deposit(alice, 1_000e6);
        _push(800e6);
        _fund(admin, 100e6);
        uint256 p0 = vault.sharePrice();
        vm.prank(admin);
        vault.returnFromStrategy(900e6);
        assertEq(vault.deployedAssets(), 0);
        assertApproxEqAbs(vault.sharePrice(), p0, 1, "unreported profit vests like reported profit");
        skip(1 days);
        assertGt(vault.sharePrice(), p0);
    }

    // ---- governance ----

    function test_pauseClosesEveryDoorAndTheLimitsSayZero() public {
        _deposit(alice, 100e6);
        vm.prank(admin);
        vault.pause();
        assertEq(vault.maxDeposit(alice), 0);
        assertEq(vault.maxWithdraw(alice), 0);
        assertEq(vault.maxRedeem(alice), 0);
        vm.prank(alice);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.requestRedeem(1e6, alice, alice);

        vm.prank(admin);
        vault.unpause();
        vm.prank(alice);
        vault.redeem(100e6, alice, alice);
    }

    function test_configBounds() public {
        AgUSD.Config memory c = defaultConfig();
        c.performanceFeeBps = 3_001;
        vm.prank(admin);
        vm.expectRevert(AgUSD.InvalidConfig.selector);
        vault.setConfig(c);

        c = defaultConfig();
        c.feeRecipient = address(0);
        vm.prank(admin);
        vm.expectRevert(AgUSD.InvalidConfig.selector);
        vault.setConfig(c);

        c = defaultConfig();
        c.profitVestingPeriod = 31 days;
        vm.prank(admin);
        vm.expectRevert(AgUSD.InvalidConfig.selector);
        vault.setConfig(c);
    }

    // ---- fuzz ----

    function testFuzz_depositThenRedeemNeverPaysMoreThanItTook(uint256 a, uint256 b) public {
        a = bound(a, 1, 1_000_000e6);
        b = bound(b, 1, 1_000_000e6);
        _deposit(alice, a);
        uint256 shares = _deposit(bob, b);
        vm.prank(bob);
        uint256 out = vault.redeem(shares, bob, bob);
        assertLe(out, b);
    }

    function testFuzz_previewsMatchTheirActions(uint256 amount, uint256 gainBps) public {
        amount = bound(amount, 1e6, 1_000_000e6);
        gainBps = bound(gainBps, 0, 500);
        _deposit(alice, 1_000_000e6);
        _push(800_000e6);
        _report(800_000e6 + 800_000e6 * gainBps / 10_000);
        skip(6 hours);

        _fund(bob, amount);
        vm.startPrank(bob);
        wUsdc.approve(address(vault), amount);
        uint256 preview = vault.previewDeposit(amount);
        uint256 got = vault.deposit(amount, bob);
        assertEq(got, preview);
        uint256 previewOut = vault.previewRedeem(got);
        uint256 out = vault.redeem(got, bob, bob);
        vm.stopPrank();
        assertEq(out, previewOut);
        assertLe(out, amount, "no round trip profit inside one block");
    }
}
