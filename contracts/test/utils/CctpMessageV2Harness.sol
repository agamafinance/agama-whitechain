// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {CctpMessageV2} from "../../src/libraries/CctpMessageV2.sol";

/// @dev The library reads calldata, so the test reaches it through an external call.
contract CctpMessageV2Harness {
    using CctpMessageV2 for bytes;

    function sourceDomain(bytes calldata m) external pure returns (uint32) {
        return m.sourceDomain();
    }

    function destinationDomain(bytes calldata m) external pure returns (uint32) {
        return m.destinationDomain();
    }

    function sender(bytes calldata m) external pure returns (bytes32) {
        return m.sender();
    }

    function recipient(bytes calldata m) external pure returns (bytes32) {
        return m.recipient();
    }

    function destinationCaller(bytes calldata m) external pure returns (bytes32) {
        return m.destinationCaller();
    }

    function burnToken(bytes calldata m) external pure returns (address) {
        return m.body().burnToken();
    }

    function mintRecipient(bytes calldata m) external pure returns (bytes32) {
        return m.body().mintRecipient();
    }

    function amount(bytes calldata m) external pure returns (uint256) {
        return m.body().amount();
    }

    function messageSender(bytes calldata m) external pure returns (bytes32) {
        return m.body().messageSender();
    }

    function hookData(bytes calldata m) external pure returns (bytes memory) {
        return m.body().hookData();
    }
}
