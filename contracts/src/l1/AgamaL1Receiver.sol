// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {ITokenMessengerV2} from "../interfaces/cctp/ITokenMessengerV2.sol";
import {IMessageTransmitterV2} from "../interfaces/cctp/IMessageTransmitterV2.sol";
import {CctpMessageV2} from "../libraries/CctpMessageV2.sol";

/// @title AgamaL1Receiver
/// @notice agUSD's position on the L1. Receives USDC over CCTP V2 from the Whitechain allocator, subscribes it to
///         the asset issuer, and burns redemptions back to the allocator.
/// @dev CCTP V2 does not execute hooks: MessageTransmitterV2 mints to the recipient and stops. The pattern Circle
///      documents is a wrapper that calls `receiveMessage` itself and then acts on the hook, which is what `relay`
///      is. Because every burn from the allocator names this contract as `destinationCaller`, `relay` is the only
///      way the USDC can arrive, so a subscription can never be skipped by somebody executing the message first.
contract AgamaL1Receiver is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using CctpMessageV2 for bytes;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    uint8 public constant ACTION_SUBSCRIBE = 1;

    IERC20 public immutable usdc;
    IMessageTransmitterV2 public immutable messageTransmitter;
    ITokenMessengerV2 public immutable tokenMessenger;
    IERC4626 public immutable issuer;
    uint32 public immutable remoteDomain;
    bytes32 public immutable remoteAllocator;

    uint256 public totalReceived;
    uint256 public totalSentHome;

    event Received(bytes32 indexed nonce, uint256 amount, uint256 totalReceived);
    event Subscribed(uint256 assets, uint256 shares);
    event Redeemed(uint256 shares, uint256 assets);
    event SentHome(uint256 amount, uint256 totalSentHome);

    error WrongSourceDomain(uint32 domain);
    error WrongSender(bytes32 sender);
    error WrongRecipient(bytes32 recipient);
    error NothingMinted();
    error ZeroAmount();

    constructor(
        IERC20 usdc_,
        IMessageTransmitterV2 messageTransmitter_,
        ITokenMessengerV2 tokenMessenger_,
        IERC4626 issuer_,
        uint32 remoteDomain_,
        bytes32 remoteAllocator_,
        address admin
    ) {
        usdc = usdc_;
        messageTransmitter = messageTransmitter_;
        tokenMessenger = tokenMessenger_;
        issuer = issuer_;
        remoteDomain = remoteDomain_;
        remoteAllocator = remoteAllocator_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
    }

    // ---- in ----

    /// @notice Executes an allocation burned on Whitechain and, if its hook asks, subscribes it. Permissionless.
    function relay(bytes calldata message, bytes calldata attestation) external nonReentrant returns (uint256 minted) {
        if (message.sourceDomain() != remoteDomain) revert WrongSourceDomain(message.sourceDomain());
        bytes calldata body = message.body();
        if (body.messageSender() != remoteAllocator) revert WrongSender(body.messageSender());
        if (body.mintRecipient() != CctpMessageV2.toBytes32(address(this))) revert WrongRecipient(body.mintRecipient());

        uint256 before = usdc.balanceOf(address(this));
        messageTransmitter.receiveMessage(message, attestation);
        minted = usdc.balanceOf(address(this)) - before;
        if (minted == 0) revert NothingMinted();

        totalReceived += minted;
        emit Received(message.nonce(), minted, totalReceived);

        bytes calldata hook = body.hookData();
        if (hook.length >= 32 && abi.decode(hook, (uint8)) == ACTION_SUBSCRIBE) _subscribe(minted);
    }

    /// @notice Subscribes USDC that is sitting here, for an arrival whose subscription the issuer refused.
    function subscribe(uint256 assets) external onlyRole(OPERATOR_ROLE) nonReentrant {
        _subscribe(assets);
    }

    // ---- out ----

    function redeem(uint256 shares) external onlyRole(OPERATOR_ROLE) nonReentrant returns (uint256 assets) {
        return _redeem(shares);
    }

    function sendHome(uint256 amount) external onlyRole(OPERATOR_ROLE) nonReentrant {
        _sendHome(amount);
    }

    /// @notice The round trip back in one call: redeem notes for cash, burn the cash to the allocator.
    function redeemAndSendHome(uint256 shares) external onlyRole(OPERATOR_ROLE) nonReentrant returns (uint256 assets) {
        assets = _redeem(shares);
        _sendHome(assets);
    }

    // ---- views ----

    /// @notice What the position is worth here: notes at the issuer's NAV, plus any cash not yet subscribed.
    /// @dev The NAV reporter on Whitechain adds the legs in flight, `totalSent - totalReceived` outbound and
    ///      `totalSentHome - totalReturned` inbound, so a crossing never reads as a loss.
    function positionValue() public view returns (uint256) {
        return issuer.convertToAssets(issuer.balanceOf(address(this))) + usdc.balanceOf(address(this));
    }

    function noteBalance() external view returns (uint256) {
        return issuer.balanceOf(address(this));
    }

    // ---- internals ----

    function _subscribe(uint256 assets) private {
        if (assets == 0) revert ZeroAmount();
        usdc.forceApprove(address(issuer), assets);
        uint256 s = issuer.deposit(assets, address(this));
        emit Subscribed(assets, s);
    }

    function _redeem(uint256 s) private returns (uint256 assets) {
        if (s == 0) revert ZeroAmount();
        assets = issuer.redeem(s, address(this), address(this));
        emit Redeemed(s, assets);
    }

    function _sendHome(uint256 amount) private {
        if (amount == 0) revert ZeroAmount();
        usdc.forceApprove(address(tokenMessenger), amount);
        tokenMessenger.depositForBurn(
            amount, remoteDomain, remoteAllocator, address(usdc), remoteAllocator, 0, CctpMessageV2.FINALITY_FINALIZED
        );
        usdc.forceApprove(address(tokenMessenger), 0);
        totalSentHome += amount;
        emit SentHome(amount, totalSentHome);
    }
}
