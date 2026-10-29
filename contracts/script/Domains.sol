// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

/// @notice CCTP domains for the two legs.
/// @dev Ethereum is Circle's domain 0. Whitechain has none, so the attested messenger uses the chain id as its
///      domain until Circle assigns one; it is a constructor argument on both sides and nowhere else.
library Domains {
    uint32 internal constant ETHEREUM = 0;
    uint32 internal constant WHITECHAIN = 1874;

    uint256 internal constant WHITECHAIN_SEPOLIA_CHAIN_ID = 1874;
    uint256 internal constant ETHEREUM_SEPOLIA_CHAIN_ID = 11155111;
}
