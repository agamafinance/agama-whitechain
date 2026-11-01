// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {TestUSDC} from "../src/mocks/TestUSDC.sol";
import {UsdcFaucet} from "../src/mocks/UsdcFaucet.sol";

contract UsdcFaucetTest is Test {
    TestUSDC usdc;
    UsdcFaucet faucet;
    address alice = makeAddr("alice");

    function setUp() public {
        usdc = new TestUSDC(address(this));
        faucet = new UsdcFaucet(usdc);
        usdc.grantRole(usdc.MINTER_ROLE(), address(faucet));
    }

    function test_DripsWithoutCooldown() public {
        vm.startPrank(alice);
        for (uint256 i; i < 5; i++) faucet.drip();
        vm.stopPrank();
        assertEq(usdc.balanceOf(alice), 5 * faucet.AMOUNT());
    }

    function test_RevertsWithoutMinterRole() public {
        usdc.revokeRole(usdc.MINTER_ROLE(), address(faucet));
        vm.prank(alice);
        vm.expectRevert();
        faucet.drip();
    }
}
