// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title AbfAssetIssuer
/// @notice The asset issuer on the L1, simulated: a closed asset-backed finance note. Allowlisted investors
///         subscribe USDC at NAV, the issuer off-ramps it to a custody account that funds receivables off chain,
///         marks the book periodically, and brings cash back on chain to pay redemptions and yield.
/// @dev A stand-in for Agama's ABF partner, which runs no testnet. Modelled on what an ABF issuer actually does
///      with a subscription rather than on any one partner's contracts, and built as an ERC-4626 so the receiver
///      talks to it through the one interface every vault on Ethereum already speaks.
///
///      The closed doors are the point. Shares move only between allowlisted holders, deposits and redemptions
///      only for allowlisted callers, and redemptions only against cash that is here: a NAV the issuer raised is
///      a claim on the book, and paying it out before the cash has come back would pay one holder with another's
///      principal.
contract AbfAssetIssuer is ERC4626, AccessControl {
    using SafeERC20 for IERC20;
    using Math for uint256;

    bytes32 public constant ISSUER_ROLE = keccak256("ISSUER_ROLE");
    bytes32 public constant COMPLIANCE_ROLE = keccak256("COMPLIANCE_ROLE");

    uint256 public constant BPS = 10_000;

    /// @notice The account the cash is wired to off chain, the SPV's bank account in production.
    address public custody;
    /// @notice The book value of what custody has funded, accrued interest included, as last reported.
    uint256 public offChainAssets;
    uint64 public navUpdatedAt;
    /// @notice The share of the issuer's assets the book may hold; the rest stays on chain for redemptions.
    uint16 public maxOffChainBps;

    mapping(address => bool) public allowlisted;

    event Allowlisted(address indexed account, bool allowed);
    event OffRamped(uint256 amount, address indexed custody, bytes32 indexed wireRef);
    event OnRamped(uint256 amount, uint256 principal, address indexed custody, bytes32 indexed wireRef);
    event NavReported(uint256 previous, uint256 current, bytes32 indexed reportHash, uint256 totalAssets);
    event CustodySet(address indexed custody);

    error NotAllowlisted(address account);
    error OffChainCap(uint256 offChainAfter, uint256 cap);
    error InsufficientCash(uint256 requested, uint256 cash);

    constructor(IERC20 usdc, address admin, address custody_, uint16 maxOffChainBps_)
        ERC20("ABF Senior Note (test)", "abfUSD-T")
        ERC4626(usdc)
    {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ISSUER_ROLE, admin);
        _grantRole(COMPLIANCE_ROLE, admin);
        custody = custody_;
        maxOffChainBps = maxOffChainBps_;
        emit CustodySet(custody_);
    }

    // ---- accounting ----

    function totalAssets() public view override returns (uint256) {
        return cash() + offChainAssets;
    }

    function cash() public view returns (uint256) {
        return IERC20(asset()).balanceOf(address(this));
    }

    // ---- the closed doors ----

    function maxDeposit(address receiver) public view override returns (uint256) {
        return allowlisted[receiver] ? type(uint256).max : 0;
    }

    function maxMint(address receiver) public view override returns (uint256) {
        return allowlisted[receiver] ? type(uint256).max : 0;
    }

    function maxWithdraw(address owner) public view override returns (uint256) {
        if (!allowlisted[owner]) return 0;
        return Math.min(_convertToAssets(balanceOf(owner), Math.Rounding.Floor), cash());
    }

    function maxRedeem(address owner) public view override returns (uint256) {
        if (!allowlisted[owner]) return 0;
        return Math.min(balanceOf(owner), _convertToShares(cash(), Math.Rounding.Floor));
    }

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override {
        if (!allowlisted[caller]) revert NotAllowlisted(caller);
        super._deposit(caller, receiver, assets, shares);
    }

    function _withdraw(address caller, address receiver, address owner, uint256 assets, uint256 shares)
        internal
        override
    {
        if (!allowlisted[caller]) revert NotAllowlisted(caller);
        if (!allowlisted[receiver]) revert NotAllowlisted(receiver);
        super._withdraw(caller, receiver, owner, assets, shares);
    }

    /// @dev A note is a claim on a diligenced book, so it only ever sits with somebody compliance has seen.
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && !allowlisted[from]) revert NotAllowlisted(from);
        if (to != address(0) && !allowlisted[to]) revert NotAllowlisted(to);
        super._update(from, to, value);
    }

    // ---- the issuer's side of the trade ----

    function setAllowlisted(address account, bool allowed) external onlyRole(COMPLIANCE_ROLE) {
        allowlisted[account] = allowed;
        emit Allowlisted(account, allowed);
    }

    function setCustody(address next) external onlyRole(DEFAULT_ADMIN_ROLE) {
        custody = next;
        emit CustodySet(next);
    }

    function setMaxOffChainBps(uint16 next) external onlyRole(DEFAULT_ADMIN_ROLE) {
        maxOffChainBps = next;
    }

    /// @notice Wires `amount` to custody to fund receivables. Booked at cost until the next report marks it.
    function offRamp(uint256 amount, bytes32 wireRef) external onlyRole(ISSUER_ROLE) {
        uint256 available = cash();
        if (amount > available) revert InsufficientCash(amount, available);
        uint256 cap = totalAssets().mulDiv(maxOffChainBps, BPS);
        if (offChainAssets + amount > cap) revert OffChainCap(offChainAssets + amount, cap);

        offChainAssets += amount;
        IERC20(asset()).safeTransfer(custody, amount);
        emit OffRamped(amount, custody, wireRef);
    }

    /// @notice Marks the book: principal outstanding plus interest accrued, net of any write down.
    /// @param reportHash The hash of the administrator's loan tape for the period, so the figure points at
    ///        something an auditor can ask for.
    function reportNav(uint256 current, bytes32 reportHash) external onlyRole(ISSUER_ROLE) {
        emit NavReported(offChainAssets, current, reportHash, cash() + current);
        offChainAssets = current;
        navUpdatedAt = uint64(block.timestamp);
    }

    /// @notice Brings `amount` home from custody: collections, repayments, interest. Custody approves first.
    function onRamp(uint256 amount, bytes32 wireRef) external onlyRole(ISSUER_ROLE) {
        IERC20(asset()).safeTransferFrom(custody, address(this), amount);
        uint256 principal = Math.min(amount, offChainAssets);
        offChainAssets -= principal;
        emit OnRamped(amount, principal, custody, wireRef);
    }
}
