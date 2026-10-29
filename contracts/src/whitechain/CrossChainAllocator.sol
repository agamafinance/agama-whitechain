// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {ITokenMessengerV2} from "../interfaces/cctp/ITokenMessengerV2.sol";
import {IMessageTransmitterV2} from "../interfaces/cctp/IMessageTransmitterV2.sol";
import {CctpMessageV2} from "../libraries/CctpMessageV2.sol";
import {AgUSD} from "./AgUSD.sol";

/// @title CrossChainAllocator
/// @notice Moves agUSD's capital between Whitechain and the chain the credit book settles on, over CCTP V2.
/// @dev The only holder of the vault's ALLOCATOR_ROLE. Outbound, it takes USDC from the vault and burns it towards
///      the L1 receiver with a hook that tells the receiver to subscribe. Inbound, anyone may relay a return the
///      receiver burned towards this contract: the message is checked against the one sender it may come from,
///      and the minted USDC goes straight back into the vault.
///
///      `destinationCaller` is set on every burn in both directions, so only the contract on the far side can
///      receive the message. CCTP carries 32 bare bytes with no type tag, and a message somebody else executes is
///      USDC delivered without the subscription that was meant to follow it.
contract CrossChainAllocator is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using CctpMessageV2 for bytes;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    /// @notice The hook the receiver reads: subscribe what arrived to the asset issuer.
    uint8 public constant ACTION_SUBSCRIBE = 1;

    AgUSD public immutable vault;
    IERC20 public immutable usdc;
    ITokenMessengerV2 public immutable tokenMessenger;
    IMessageTransmitterV2 public immutable messageTransmitter;
    uint32 public immutable remoteDomain;

    /// @notice The L1 receiver, as CCTP writes it. Locked while any capital is deployed, because a wrong
    ///         recipient on a burn is unrecoverable and a changed one strands what is already over there.
    bytes32 public remoteReceiver;

    uint256 public totalSent;
    uint256 public totalReturned;

    event Allocated(uint256 amount, bytes32 indexed remoteReceiver, uint256 totalSent);
    event ReturnSettled(bytes32 indexed nonce, uint256 amount, uint256 totalReturned);
    event RemoteReceiverSet(bytes32 previous, bytes32 next);

    error ZeroAmount();
    error ReceiverNotSet();
    error ReceiverLocked(uint256 deployedAssets);
    error WrongSourceDomain(uint32 domain);
    error WrongSender(bytes32 sender);
    error WrongRecipient(bytes32 recipient);
    error NothingMinted();

    constructor(
        AgUSD vault_,
        ITokenMessengerV2 tokenMessenger_,
        IMessageTransmitterV2 messageTransmitter_,
        uint32 remoteDomain_,
        address admin
    ) {
        vault = vault_;
        usdc = IERC20(vault_.asset());
        tokenMessenger = tokenMessenger_;
        messageTransmitter = messageTransmitter_;
        remoteDomain = remoteDomain_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
    }

    function setRemoteReceiver(bytes32 next) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (next == bytes32(0)) revert ReceiverNotSet();
        uint256 deployed = vault.deployedAssets();
        if (deployed != 0) revert ReceiverLocked(deployed);
        emit RemoteReceiverSet(remoteReceiver, next);
        remoteReceiver = next;
    }

    /// @notice Sends `amount` of the vault's USDC to the credit book.
    function allocate(uint256 amount) external onlyRole(OPERATOR_ROLE) nonReentrant {
        if (amount == 0) revert ZeroAmount();
        bytes32 receiver = remoteReceiver;
        if (receiver == bytes32(0)) revert ReceiverNotSet();

        vault.pushToStrategy(amount);
        usdc.forceApprove(address(tokenMessenger), amount);
        tokenMessenger.depositForBurnWithHook(
            amount,
            remoteDomain,
            receiver,
            address(usdc),
            receiver,
            0,
            CctpMessageV2.FINALITY_FINALIZED,
            abi.encode(ACTION_SUBSCRIBE)
        );
        // The messenger pulls exactly `amount`; an allowance left behind is a door left open.
        usdc.forceApprove(address(tokenMessenger), 0);

        totalSent += amount;
        emit Allocated(amount, receiver, totalSent);
    }

    /// @notice Relays a return from the L1 receiver and pays it into the vault. Permissionless: the message
    ///         and the attestation are the authority, not the caller.
    function settleReturn(bytes calldata message, bytes calldata attestation) external nonReentrant {
        if (message.sourceDomain() != remoteDomain) revert WrongSourceDomain(message.sourceDomain());
        bytes calldata body = message.body();
        if (body.messageSender() != remoteReceiver) revert WrongSender(body.messageSender());
        if (body.mintRecipient() != CctpMessageV2.toBytes32(address(this))) revert WrongRecipient(body.mintRecipient());

        uint256 before = usdc.balanceOf(address(this));
        messageTransmitter.receiveMessage(message, attestation);
        uint256 minted = usdc.balanceOf(address(this)) - before;
        if (minted == 0) revert NothingMinted();

        totalReturned += minted;
        usdc.forceApprove(address(vault), minted);
        vault.returnFromStrategy(minted);
        emit ReturnSettled(message.nonce(), minted, totalReturned);
    }
}
