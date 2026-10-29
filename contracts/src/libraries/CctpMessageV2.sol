// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

/// @title CctpMessageV2
/// @notice Reads and writes the two CCTP V2 wire formats: the MessageV2 envelope and the BurnMessageV2 body.
/// @dev Offsets follow Circle's MessageV2.sol and BurnMessageV2.sol. Everything is big endian and packed, so a
///      message built here is a message Circle's MessageTransmitterV2 parses, and the reverse.
///
///      MessageV2                                  BurnMessageV2 (the body)
///      version                   uint32    0      version          uint32   0
///      sourceDomain              uint32    4      burnToken        bytes32  4
///      destinationDomain         uint32    8      mintRecipient    bytes32  36
///      nonce                     bytes32  12      amount           uint256  68
///      sender                    bytes32  44      messageSender    bytes32  100
///      recipient                 bytes32  76      maxFee           uint256  132
///      destinationCaller         bytes32 108      feeExecuted      uint256  164
///      minFinalityThreshold      uint32  140      expirationBlock  uint256  196
///      finalityThresholdExecuted uint32  144      hookData         bytes    228
///      messageBody               bytes   148
library CctpMessageV2 {
    uint32 internal constant MESSAGE_VERSION = 1;
    uint32 internal constant BURN_MESSAGE_VERSION = 1;
    uint32 internal constant FINALITY_FINALIZED = 2000;

    uint256 private constant SOURCE_DOMAIN = 4;
    uint256 private constant DESTINATION_DOMAIN = 8;
    uint256 private constant NONCE = 12;
    uint256 private constant SENDER = 44;
    uint256 private constant RECIPIENT = 76;
    uint256 private constant DESTINATION_CALLER = 108;
    uint256 private constant MESSAGE_BODY = 148;

    uint256 private constant BURN_TOKEN = 4;
    uint256 private constant MINT_RECIPIENT = 36;
    uint256 private constant AMOUNT = 68;
    uint256 private constant MESSAGE_SENDER = 100;
    uint256 private constant FEE_EXECUTED = 164;
    uint256 private constant HOOK_DATA = 228;

    error MalformedMessage();

    function formatMessage(
        uint32 sourceDomain_,
        uint32 destinationDomain_,
        bytes32 nonce_,
        bytes32 sender_,
        bytes32 recipient_,
        bytes32 destinationCaller_,
        uint32 minFinalityThreshold_,
        bytes memory body_
    ) internal pure returns (bytes memory) {
        return abi.encodePacked(
            MESSAGE_VERSION,
            sourceDomain_,
            destinationDomain_,
            nonce_,
            sender_,
            recipient_,
            destinationCaller_,
            minFinalityThreshold_,
            uint32(0), // finalityThresholdExecuted is filled in by the attester, never by the sender_
            body_
        );
    }

    function formatBurnBody(
        address burnToken_,
        bytes32 mintRecipient_,
        uint256 amount_,
        bytes32 messageSender_,
        uint256 maxFee_,
        bytes memory hookData_
    ) internal pure returns (bytes memory) {
        return abi.encodePacked(
            BURN_MESSAGE_VERSION,
            toBytes32(burnToken_),
            mintRecipient_,
            amount_,
            messageSender_,
            maxFee_,
            uint256(0), // feeExecuted
            uint256(0), // expirationBlock
            hookData_
        );
    }

    // ---- envelope ----

    function sourceDomain(bytes calldata m) internal pure returns (uint32) {
        return uint32(bytes4(_at(m, SOURCE_DOMAIN, 4)));
    }

    function destinationDomain(bytes calldata m) internal pure returns (uint32) {
        return uint32(bytes4(_at(m, DESTINATION_DOMAIN, 4)));
    }

    function nonce(bytes calldata m) internal pure returns (bytes32) {
        return bytes32(_at(m, NONCE, 32));
    }

    function sender(bytes calldata m) internal pure returns (bytes32) {
        return bytes32(_at(m, SENDER, 32));
    }

    function recipient(bytes calldata m) internal pure returns (bytes32) {
        return bytes32(_at(m, RECIPIENT, 32));
    }

    function destinationCaller(bytes calldata m) internal pure returns (bytes32) {
        return bytes32(_at(m, DESTINATION_CALLER, 32));
    }

    function body(bytes calldata m) internal pure returns (bytes calldata) {
        if (m.length < MESSAGE_BODY) revert MalformedMessage();
        return m[MESSAGE_BODY:];
    }

    // ---- burn body ----

    function burnToken(bytes calldata b) internal pure returns (address) {
        return toAddress(bytes32(_at(b, BURN_TOKEN, 32)));
    }

    function mintRecipient(bytes calldata b) internal pure returns (bytes32) {
        return bytes32(_at(b, MINT_RECIPIENT, 32));
    }

    function amount(bytes calldata b) internal pure returns (uint256) {
        return uint256(bytes32(_at(b, AMOUNT, 32)));
    }

    function messageSender(bytes calldata b) internal pure returns (bytes32) {
        return bytes32(_at(b, MESSAGE_SENDER, 32));
    }

    function feeExecuted(bytes calldata b) internal pure returns (uint256) {
        return uint256(bytes32(_at(b, FEE_EXECUTED, 32)));
    }

    function hookData(bytes calldata b) internal pure returns (bytes calldata) {
        if (b.length < HOOK_DATA) revert MalformedMessage();
        return b[HOOK_DATA:];
    }

    // ---- helpers ----

    function toBytes32(address a) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(a)));
    }

    /// @dev CCTP carries 32 bare bytes. An address is only an address if the top 12 of them are zero, so a
    ///      recipient that is not one is refused rather than truncated into somebody else.
    function toAddress(bytes32 b) internal pure returns (address) {
        if (uint256(b) >> 160 != 0) revert MalformedMessage();
        return address(uint160(uint256(b)));
    }

    function _at(bytes calldata m, uint256 offset, uint256 len) private pure returns (bytes calldata) {
        if (m.length < offset + len) revert MalformedMessage();
        return m[offset:offset + len];
    }
}
