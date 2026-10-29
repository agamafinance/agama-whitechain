// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

/// @notice The subset of Circle's CCTP V2 TokenMessengerV2 that Agama calls.
/// @dev Signatures are Circle's, byte for byte (evm-cctp-contracts, src/v2/TokenMessengerV2.sol), so the
///      allocator and the L1 receiver compile against Circle's deployment unchanged.
interface ITokenMessengerV2 {
    function depositForBurn(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold
    ) external;

    function depositForBurnWithHook(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold,
        bytes calldata hookData
    ) external;
}
