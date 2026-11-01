// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {TestUSDC} from "./TestUSDC.sol";

/// @title UsdcFaucet
/// @notice Ten thousand mock dollars to whoever asks, as often as they ask.
/// @dev TestUSDC's own faucet allows one drip an hour per address, and that is a constant in a token the vault
///      holds as its asset, so it cannot change without redeploying the route. This contract holds MINTER_ROLE on
///      the token instead and mints without a cooldown. It is a testnet dollar; there is nothing to protect.
contract UsdcFaucet {
    uint256 public constant AMOUNT = 10_000e6;

    TestUSDC public immutable usdc;

    event Dripped(address indexed to, uint256 amount);

    constructor(TestUSDC usdc_) {
        usdc = usdc_;
    }

    function drip() external {
        usdc.mint(msg.sender, AMOUNT);
        emit Dripped(msg.sender, AMOUNT);
    }
}
