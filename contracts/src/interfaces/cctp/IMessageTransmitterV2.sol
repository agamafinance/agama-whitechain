// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

/// @notice The subset of Circle's CCTP V2 MessageTransmitterV2 that Agama calls.
/// @dev `receiveMessage` takes the raw message and the concatenated attester signatures over its keccak256,
///      exactly as Circle's attestation API returns them.
interface IMessageTransmitterV2 {
    function receiveMessage(bytes calldata message, bytes calldata attestation) external returns (bool success);

    function localDomain() external view returns (uint32);
}
