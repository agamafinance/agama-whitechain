// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Fixture} from "./utils/Fixture.sol";
import {AgUSD} from "../src/whitechain/AgUSD.sol";
import {TestUSDC} from "../src/mocks/TestUSDC.sol";

/// @dev Drives the vault through every door at random: deposits, instant exits, queued exits, allocations,
///      returns, NAV reports up and down, and time.
contract Handler is Test {
    AgUSD internal vault;
    TestUSDC internal usdc;
    address internal admin;
    address[3] internal actors = [address(0xA1), address(0xB2), address(0xC3)];

    uint256 public queuedSum;
    uint256 public paidSum;

    constructor(AgUSD v, TestUSDC u, address a) {
        vault = v;
        usdc = u;
        admin = a;
    }

    function deposit(uint256 who, uint256 amount) external {
        address a = actors[who % 3];
        amount = bound(amount, 1e6, 100_000e6);
        if (amount > vault.maxDeposit(a)) return;
        vm.prank(admin);
        usdc.mint(a, amount);
        vm.startPrank(a);
        usdc.approve(address(vault), amount);
        vault.deposit(amount, a);
        vm.stopPrank();
    }

    function redeem(uint256 who, uint256 shares) external {
        address a = actors[who % 3];
        uint256 max = vault.maxRedeem(a);
        if (max == 0) return;
        shares = bound(shares, 1, max);
        if (vault.previewRedeem(shares) == 0) return;
        vm.prank(a);
        vault.redeem(shares, a, a);
    }

    function requestRedeem(uint256 who, uint256 shares) external {
        address a = actors[who % 3];
        uint256 bal = vault.balanceOf(a);
        if (bal == 0) return;
        shares = bound(shares, 1, bal);
        uint256 assets = vault.previewRedeem(shares);
        if (assets == 0) return;
        // The request settles the head of the queue, which may be somebody else's.
        uint256[3] memory before;
        for (uint256 i; i < 3; i++) before[i] = usdc.balanceOf(actors[i]);
        vm.prank(a);
        vault.requestRedeem(shares, a, a);
        queuedSum += assets;
        for (uint256 i; i < 3; i++) paidSum += usdc.balanceOf(actors[i]) - before[i];
    }

    function allocate(uint256 amount) external {
        uint256 liquid = vault.liquidAssets();
        uint256 floor = vault.totalAssets() * 1_000 / 10_000 + 1;
        if (liquid <= floor) return;
        amount = bound(amount, 1, liquid - floor);
        vm.prank(admin);
        vault.pushToStrategy(amount);
    }

    function giveBack(uint256 amount, uint256 profitBps) external {
        uint256 deployed = vault.deployedAssets();
        if (deployed == 0) return;
        amount = bound(amount, 1, deployed);
        uint256 withProfit = amount + amount * bound(profitBps, 0, 200) / 10_000;
        vm.startPrank(admin);
        usdc.mint(admin, withProfit);
        usdc.approve(address(vault), withProfit);
        address[3] memory a = actors;
        uint256[3] memory before;
        for (uint256 i; i < 3; i++) before[i] = usdc.balanceOf(a[i]);
        vault.returnFromStrategy(withProfit);
        vm.stopPrank();
        for (uint256 i; i < 3; i++) paidSum += usdc.balanceOf(a[i]) - before[i];
    }

    function report(uint256 moveBps, bool up) external {
        uint256 deployed = vault.deployedAssets();
        if (deployed == 0) return;
        skip(1 hours);
        uint256 delta = deployed * bound(moveBps, 0, 500) / 10_000;
        vm.prank(admin);
        vault.reportNav(up ? deployed + delta : deployed - delta);
    }

    function wait(uint256 secs) external {
        skip(bound(secs, 1, 2 days));
    }
}

contract AgUSDInvariantTest is Fixture {
    Handler internal handler;

    function setUp() public override {
        super.setUp();
        vm.startPrank(admin);
        vault.grantRole(vault.ALLOCATOR_ROLE(), admin);
        handler = new Handler(vault, wUsdc, admin);
        wUsdc.grantRole(wUsdc.MINTER_ROLE(), address(handler));
        vm.stopPrank();
        targetContract(address(handler));
    }

    /// @dev The queue is owed exactly what was queued and not yet paid.
    function invariant_pendingIsWhatTheQueueIsOwed() public view {
        assertEq(vault.pendingRedemptions(), handler.queuedSum() - handler.paidSum());
    }

    /// @dev What the holders own never exceeds what the vault has, net of what it owes.
    function invariant_sharesAreBacked() public view {
        assertLe(vault.convertToAssets(vault.totalSupply()), vault.totalAssets() + 1);
    }

    /// @dev Instant exits can never reach the queue's cash.
    function invariant_liquidNeverIncludesThePending() public view {
        uint256 idle = wUsdc.balanceOf(address(vault));
        uint256 pending = vault.pendingRedemptions();
        assertEq(vault.liquidAssets(), idle > pending ? idle - pending : 0);
        assertLe(vault.maxWithdraw(address(0xA1)), vault.liquidAssets());
    }

    /// @dev The queue is senior. Locked profit is a slice of what is left after it, and if a loss ever leaves
    ///      less than the queue is owed, the holders' claim reads zero rather than negative.
    function invariant_theQueueIsSenior() public view {
        uint256 gross = wUsdc.balanceOf(address(vault)) + vault.deployedAssets();
        uint256 pending = vault.pendingRedemptions();
        if (gross >= pending) assertLe(vault.unvestedProfit(), gross - pending);
        else assertEq(vault.totalAssets(), 0);
    }
}
