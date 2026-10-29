// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {ITokenMessengerV2} from "../interfaces/cctp/ITokenMessengerV2.sol";
import {IMessageTransmitterV2} from "../interfaces/cctp/IMessageTransmitterV2.sol";
import {CctpMessageV2} from "../libraries/CctpMessageV2.sol";

interface IBurnMintToken is IERC20 {
    function mint(address to, uint256 amount) external;
    function burn(uint256 amount) external;
}

/// @title AttestedMessenger
/// @notice Burn-and-mint transport that speaks CCTP V2: Circle's function signatures, Circle's message layout,
///         Circle's attestation encoding. One contract per chain plays both TokenMessengerV2 and
///         MessageTransmitterV2.
/// @dev Exists because Circle has not given Whitechain a CCTP domain. Everything above this contract, the
///      allocator on Whitechain and the receiver on Ethereum, is written against Circle's interfaces and never
///      against this one, so moving to Circle is a constructor argument, not a code change.
///
///      Where it differs from Circle, deliberately:
///      - one attester instead of Circle's quorum, so the trust assumption is a single key and it is ours
///      - the nonce is assigned on chain at send time; Circle's V2 assigns it off chain at attestation time
///      - no fast transfer: every message is executed at the finalized threshold and fees are zero
contract AttestedMessenger is ITokenMessengerV2, IMessageTransmitterV2, Ownable2Step {
    using SafeERC20 for IBurnMintToken;
    using CctpMessageV2 for bytes;

    uint32 public immutable override localDomain;
    IBurnMintToken public immutable token;

    address public attester;
    uint64 public sent;

    /// @notice The messenger on each remote domain, and the token it burns there.
    mapping(uint32 domain => bytes32) public remoteMessenger;
    mapping(uint32 domain => bytes32) public remoteToken;

    mapping(bytes32 nonce => bool) public usedNonces;

    event MessageSent(bytes message);
    event MessageReceived(
        address indexed caller, uint32 sourceDomain, bytes32 indexed nonce, bytes32 sender, uint32 finalityThreshold
    );
    event DepositForBurn(
        address indexed burnToken,
        uint256 amount,
        address indexed depositor,
        bytes32 mintRecipient,
        uint32 destinationDomain,
        bytes32 destinationTokenMessenger,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 indexed minFinalityThreshold,
        bytes hookData
    );
    event MintAndWithdraw(address indexed mintRecipient, uint256 amount, address indexed mintToken, uint256 feeCollected);
    event AttesterChanged(address indexed previous, address indexed next);
    event RemoteSet(uint32 indexed domain, bytes32 messenger, bytes32 token);

    error ZeroAmount();
    error ZeroRecipient();
    error UnknownDomain(uint32 domain);
    error UnsupportedToken(address token);
    error WrongDestination(uint32 domain);
    error WrongRecipient(bytes32 recipient);
    error UnknownSender(bytes32 sender);
    error WrongCaller(bytes32 expected);
    error NonceUsed(bytes32 nonce);
    error InvalidAttestation();
    error FeeAboveAmount();

    constructor(uint32 localDomain_, IBurnMintToken token_, address attester_, address owner_) Ownable(owner_) {
        localDomain = localDomain_;
        token = token_;
        attester = attester_;
        emit AttesterChanged(address(0), attester_);
    }

    // ---- admin ----

    function setAttester(address next) external onlyOwner {
        emit AttesterChanged(attester, next);
        attester = next;
    }

    function setRemote(uint32 domain, bytes32 messenger, bytes32 token_) external onlyOwner {
        remoteMessenger[domain] = messenger;
        remoteToken[domain] = token_;
        emit RemoteSet(domain, messenger, token_);
    }

    // ---- TokenMessengerV2 ----

    function depositForBurn(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold
    ) external override {
        _depositForBurn(amount, destinationDomain, mintRecipient, burnToken, destinationCaller, maxFee, minFinalityThreshold, "");
    }

    function depositForBurnWithHook(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold,
        bytes calldata hookData
    ) external override {
        _depositForBurn(amount, destinationDomain, mintRecipient, burnToken, destinationCaller, maxFee, minFinalityThreshold, hookData);
    }

    function _depositForBurn(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold,
        bytes memory hookData
    ) private {
        if (amount == 0) revert ZeroAmount();
        if (mintRecipient == bytes32(0)) revert ZeroRecipient();
        if (burnToken != address(token)) revert UnsupportedToken(burnToken);
        if (maxFee >= amount) revert FeeAboveAmount();
        bytes32 destination = remoteMessenger[destinationDomain];
        if (destination == bytes32(0)) revert UnknownDomain(destinationDomain);

        token.safeTransferFrom(msg.sender, address(this), amount);
        token.burn(amount);

        bytes memory body = CctpMessageV2.formatBurnBody(
            burnToken, mintRecipient, amount, CctpMessageV2.toBytes32(msg.sender), maxFee, hookData
        );
        bytes32 n = keccak256(abi.encode(block.chainid, localDomain, ++sent));
        bytes memory message = CctpMessageV2.formatMessage(
            localDomain,
            destinationDomain,
            n,
            CctpMessageV2.toBytes32(address(this)),
            destination,
            destinationCaller,
            minFinalityThreshold,
            body
        );

        emit DepositForBurn(
            burnToken, amount, msg.sender, mintRecipient, destinationDomain, destination, destinationCaller, maxFee,
            minFinalityThreshold, hookData
        );
        emit MessageSent(message);
    }

    // ---- MessageTransmitterV2 ----

    function receiveMessage(bytes calldata message, bytes calldata attestation) external override returns (bool) {
        if (ECDSA.recover(keccak256(message), attestation) != attester) revert InvalidAttestation();

        uint32 source = message.sourceDomain();
        if (message.destinationDomain() != localDomain) revert WrongDestination(message.destinationDomain());
        if (message.recipient() != CctpMessageV2.toBytes32(address(this))) revert WrongRecipient(message.recipient());
        if (message.sender() != remoteMessenger[source] || remoteMessenger[source] == bytes32(0)) {
            revert UnknownSender(message.sender());
        }
        bytes32 caller = message.destinationCaller();
        if (caller != bytes32(0) && caller != CctpMessageV2.toBytes32(msg.sender)) revert WrongCaller(caller);

        bytes32 n = message.nonce();
        if (usedNonces[n]) revert NonceUsed(n);
        usedNonces[n] = true;

        bytes calldata b = message.body();
        if (bytes32(uint256(uint160(b.burnToken()))) != remoteToken[source]) revert UnsupportedToken(b.burnToken());
        uint256 fee = b.feeExecuted();
        uint256 gross = b.amount();
        if (fee > gross) revert FeeAboveAmount();
        address to = CctpMessageV2.toAddress(b.mintRecipient());

        token.mint(to, gross - fee);

        emit MessageReceived(msg.sender, source, n, message.sender(), CctpMessageV2.FINALITY_FINALIZED);
        emit MintAndWithdraw(to, gross - fee, address(token), fee);
        return true;
    }
}
