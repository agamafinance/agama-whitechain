// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title agUSD
/// @notice A synthetic dollar that earns. Deposit USDC, hold agUSD, and the private credit yield lands in the price
///         of the share: nothing to stake, nothing to claim, nothing to come back for.
/// @dev An OpenZeppelin ERC-4626 vault whose share is the product. One token, where the Stellar deployment needs two
///      (agUSD plus a staked sagUSD), because on an EVM chain the share price already is the yield.
///
///      Where the assets are:
///        idle      USDC sitting in this contract
///        deployed  USDC that left through the allocator for the credit book, valued at the last NAV report
///      and what is owed against them:
///        pending   USDC promised to the redemption queue, fixed when the request was made
///        unvested  profit reported but still unlocking, so a report cannot be sandwiched
///      totalAssets = idle + deployed - pending - unvested.
///
///      Capital in the book is not callable on demand, so exits are two speeds. `withdraw` and `redeem` are the
///      standard ERC-4626 paths and are bounded by the liquid buffer, which `maxWithdraw` and `maxRedeem` report
///      honestly. Above it, `requestRedeem` burns the shares at today's price and joins a FIFO queue that any caller
///      can settle as cash comes home.
contract AgUSD is ERC4626, ERC20Permit, AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Math for uint256;

    bytes32 public constant ALLOCATOR_ROLE = keccak256("ALLOCATOR_ROLE");
    bytes32 public constant REPORTER_ROLE = keccak256("REPORTER_ROLE");
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");

    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_PERFORMANCE_FEE_BPS = 3_000;
    uint256 public constant MAX_VESTING_PERIOD = 30 days;
    /// @dev Bounds the work one call to the queue can do, so settling is never a gas limit away from impossible.
    uint256 public constant AUTO_SETTLE = 8;

    struct Config {
        uint256 depositCap;
        uint16 reserveBps;
        uint16 performanceFeeBps;
        uint16 maxNavChangeBps;
        uint32 minReportInterval;
        uint32 profitVestingPeriod;
        address feeRecipient;
    }

    struct Redemption {
        address receiver;
        uint64 requestedAt;
        uint128 assets;
    }

    /// @notice Everything the app reads, in one call.
    struct Snapshot {
        uint256 totalAssets;
        uint256 totalSupply;
        uint256 sharePrice;
        uint256 idle;
        uint256 deployed;
        uint256 pending;
        uint256 unvested;
        uint256 liquid;
        uint256 depositCap;
        uint16 reserveBps;
        uint16 performanceFeeBps;
        uint64 lastReport;
        uint256 queueLength;
        bool paused;
    }

    Config public config;

    uint256 public deployedAssets;
    uint256 public pendingRedemptions;

    uint256 public lockedProfit;
    uint64 public lockedAt;
    uint64 public lastReport;

    mapping(uint256 id => Redemption) public redemptions;
    uint256 public nextRedemptionId;
    uint256 public nextToSettle;

    event Allocated(address indexed allocator, uint256 assets, uint256 deployedAssets);
    event Returned(address indexed allocator, uint256 assets, uint256 deployedAssets);
    event NavReported(uint256 previous, uint256 current, uint256 feeShares, uint256 totalAssets, uint256 sharePrice);
    event RedeemRequested(
        uint256 indexed id, address indexed owner, address indexed receiver, uint256 shares, uint256 assets
    );
    event RedemptionSettled(uint256 indexed id, address indexed receiver, uint256 assets);
    event ConfigUpdated(Config config);

    error ReportTooSoon(uint256 availableAt);
    error NavChangeTooLarge(uint256 previous, uint256 current);
    error NothingDeployed();
    error ReserveFloor(uint256 liquidAfter, uint256 floor);
    error InsufficientLiquidity(uint256 requested, uint256 liquid);
    error ZeroAmount();
    error InvalidConfig();

    constructor(IERC20 usdc, address admin, Config memory initial)
        ERC20("Agama USD", "agUSD")
        ERC4626(usdc)
        ERC20Permit("Agama USD")
    {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MANAGER_ROLE, admin);
        _grantRole(GUARDIAN_ROLE, admin);
        _setConfig(initial);
    }

    // ------------------------------------------------------------------
    // Accounting
    // ------------------------------------------------------------------

    function totalAssets() public view override returns (uint256) {
        uint256 gross = _idle() + deployedAssets;
        uint256 owed = pendingRedemptions + unvestedProfit();
        return gross > owed ? gross - owed : 0;
    }

    /// @notice Profit already reported but still unlocking, linearly over the vesting period.
    function unvestedProfit() public view returns (uint256) {
        uint256 period = config.profitVestingPeriod;
        if (period == 0 || lockedProfit == 0) return 0;
        uint256 end = uint256(lockedAt) + period;
        if (block.timestamp >= end) return 0;
        return lockedProfit.mulDiv(end - block.timestamp, period);
    }

    /// @notice Cash an instant exit can take: what is here, less what the queue is already owed.
    function liquidAssets() public view returns (uint256) {
        uint256 idle = _idle();
        return idle > pendingRedemptions ? idle - pendingRedemptions : 0;
    }

    /// @notice USDC per one whole agUSD, in USDC base units.
    function sharePrice() public view returns (uint256) {
        return convertToAssets(10 ** decimals());
    }

    function snapshot() external view returns (Snapshot memory s) {
        s.totalAssets = totalAssets();
        s.totalSupply = totalSupply();
        s.sharePrice = sharePrice();
        s.idle = _idle();
        s.deployed = deployedAssets;
        s.pending = pendingRedemptions;
        s.unvested = unvestedProfit();
        s.liquid = liquidAssets();
        s.depositCap = config.depositCap;
        s.reserveBps = config.reserveBps;
        s.performanceFeeBps = config.performanceFeeBps;
        s.lastReport = lastReport;
        s.queueLength = nextRedemptionId - nextToSettle;
        s.paused = paused();
    }

    function decimals() public view override(ERC20, ERC4626) returns (uint8) {
        return super.decimals();
    }

    // ------------------------------------------------------------------
    // ERC-4626 limits: honest about the cap, the buffer and the pause
    // ------------------------------------------------------------------

    function maxDeposit(address) public view override returns (uint256) {
        if (paused()) return 0;
        uint256 cap = config.depositCap;
        if (cap == type(uint256).max) return cap;
        uint256 assets = totalAssets();
        return assets >= cap ? 0 : cap - assets;
    }

    function maxMint(address receiver) public view override returns (uint256) {
        uint256 assets = maxDeposit(receiver);
        return assets == type(uint256).max ? assets : _convertToShares(assets, Math.Rounding.Floor);
    }

    function maxWithdraw(address owner) public view override returns (uint256) {
        if (paused()) return 0;
        return Math.min(_convertToAssets(balanceOf(owner), Math.Rounding.Floor), liquidAssets());
    }

    function maxRedeem(address owner) public view override returns (uint256) {
        if (paused()) return 0;
        return Math.min(balanceOf(owner), _convertToShares(liquidAssets(), Math.Rounding.Floor));
    }

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares)
        internal
        override
        nonReentrant
        whenNotPaused
    {
        super._deposit(caller, receiver, assets, shares);
    }

    function _withdraw(address caller, address receiver, address owner, uint256 assets, uint256 shares)
        internal
        override
        nonReentrant
        whenNotPaused
    {
        super._withdraw(caller, receiver, owner, assets, shares);
    }

    // ------------------------------------------------------------------
    // The queue, for exits larger than the buffer
    // ------------------------------------------------------------------

    /// @notice Burns `shares` now at today's price and queues their USDC for payment as cash comes home.
    /// @dev The price is fixed at request time: a holder who has asked to leave neither earns nor loses on the
    ///      book after that, which is what makes the queue fair to the holders who stay.
    function requestRedeem(uint256 shares, address receiver, address owner)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 id)
    {
        if (shares == 0) revert ZeroAmount();
        if (msg.sender != owner) _spendAllowance(owner, msg.sender, shares);
        uint256 assets = previewRedeem(shares);
        if (assets == 0) revert ZeroAmount();

        _burn(owner, shares);
        pendingRedemptions += assets;
        id = nextRedemptionId++;
        redemptions[id] = Redemption(receiver, uint64(block.timestamp), uint128(assets));
        emit RedeemRequested(id, owner, receiver, shares, assets);

        _settle(AUTO_SETTLE);
    }

    /// @notice Pays queued redemptions in order while the cash lasts. Anyone can call it.
    function settleRedemptions(uint256 max) external nonReentrant returns (uint256 settled) {
        return _settle(max);
    }

    function _settle(uint256 max) private returns (uint256 settled) {
        uint256 id = nextToSettle;
        uint256 end = nextRedemptionId;
        IERC20 usdc = IERC20(asset());
        while (id < end && settled < max) {
            Redemption memory r = redemptions[id];
            if (_idle() < r.assets) break;
            delete redemptions[id];
            pendingRedemptions -= r.assets;
            usdc.safeTransfer(r.receiver, r.assets);
            emit RedemptionSettled(id, r.receiver, r.assets);
            unchecked {
                ++id;
                ++settled;
            }
        }
        nextToSettle = id;
    }

    // ------------------------------------------------------------------
    // Allocator: capital out to the book and back
    // ------------------------------------------------------------------

    /// @notice Hands `assets` to the allocator for the credit book, never through the reserve floor.
    function pushToStrategy(uint256 assets) external onlyRole(ALLOCATOR_ROLE) nonReentrant whenNotPaused {
        if (assets == 0) revert ZeroAmount();
        uint256 liquid = liquidAssets();
        if (assets > liquid) revert InsufficientLiquidity(assets, liquid);
        uint256 floor = totalAssets().mulDiv(config.reserveBps, BPS, Math.Rounding.Ceil);
        if (liquid - assets < floor) revert ReserveFloor(liquid - assets, floor);

        deployedAssets += assets;
        IERC20(asset()).safeTransfer(msg.sender, assets);
        emit Allocated(msg.sender, assets, deployedAssets);
    }

    /// @notice Takes cash back from the allocator. Anything above the booked value is profit nobody reported yet,
    ///         and it is recognized the same way a report would be, fee and vesting included, rather than
    ///         landing in the price in one block.
    function returnFromStrategy(uint256 assets) external onlyRole(ALLOCATOR_ROLE) nonReentrant {
        if (assets == 0) revert ZeroAmount();
        IERC20(asset()).safeTransferFrom(msg.sender, address(this), assets);

        uint256 principal = Math.min(assets, deployedAssets);
        deployedAssets -= principal;
        if (assets > principal) _recognizeGain(assets - principal);

        emit Returned(msg.sender, assets, deployedAssets);
        _settle(AUTO_SETTLE);
    }

    // ------------------------------------------------------------------
    // NAV
    // ------------------------------------------------------------------

    /// @notice Marks the deployed capital to `current`, the value of the position the allocator holds on the
    ///         credit book's chain, in flight legs included.
    /// @dev Two guards on a key that can move the price: a minimum interval between reports and a maximum relative
    ///      move per report. A value cannot be conjured from nothing: with nothing deployed the only valid report
    ///      is zero.
    function reportNav(uint256 current) external onlyRole(REPORTER_ROLE) {
        Config memory c = config;
        uint256 next = uint256(lastReport) + c.minReportInterval;
        if (lastReport != 0 && block.timestamp < next) revert ReportTooSoon(next);

        uint256 previous = deployedAssets;
        if (previous == 0) {
            if (current != 0) revert NothingDeployed();
        } else {
            uint256 delta = current > previous ? current - previous : previous - current;
            if (delta.mulDiv(BPS, previous) > c.maxNavChangeBps) revert NavChangeTooLarge(previous, current);
        }

        deployedAssets = current;
        lastReport = uint64(block.timestamp);

        uint256 feeShares;
        if (current > previous) feeShares = _recognizeGain(current - previous);
        else if (previous > current) _recognizeLoss(previous - current);

        emit NavReported(previous, current, feeShares, totalAssets(), sharePrice());
    }

    /// @dev The gain is already inside idle or deployed when this runs. Two things have to hold at once, and the
    ///      lock and the fee shares are solved for together so that both do:
    ///
    ///        1. the price does not move in the report's block, so nobody can buy just before it and sell just after
    ///        2. once everything locked has unlocked, the treasury's shares are worth exactly the fee
    ///
    ///      With V the vault fully vested, P its value before the gain, S the supply and F the fee:
    ///        feeShares = S * F / (V - F)          (2)
    ///        locked    = V - P * V / (V - F)      (1), given (2)
    ///      Without a fee this is just locked += gain.
    function _recognizeGain(uint256 gain) private returns (uint256 feeShares) {
        uint256 fee = gain.mulDiv(config.performanceFeeBps, BPS);
        address recipient = config.feeRecipient;
        uint256 unvested = unvestedProfit();
        lockedAt = uint64(block.timestamp);

        if (fee == 0 || recipient == address(0)) {
            lockedProfit = unvested + gain;
            return 0;
        }

        uint256 gross = _idle() + deployedAssets;
        uint256 vested = gross > pendingRedemptions ? gross - pendingRedemptions : 0;
        uint256 before = vested > gain + unvested ? vested - gain - unvested : 0;

        feeShares = fee.mulDiv(totalSupply() + 10 ** _decimalsOffset(), vested - fee, Math.Rounding.Floor);
        lockedProfit = vested - before.mulDiv(vested, vested - fee, Math.Rounding.Ceil);
        if (feeShares > 0) _mint(recipient, feeShares);
    }

    /// @dev A loss eats profit that has not unlocked yet before it reaches the price.
    function _recognizeLoss(uint256 loss) private {
        uint256 unvested = unvestedProfit();
        lockedProfit = unvested > loss ? unvested - loss : 0;
        lockedAt = uint64(block.timestamp);
    }

    // ------------------------------------------------------------------
    // Governance
    // ------------------------------------------------------------------

    function setConfig(Config calldata next) external onlyRole(MANAGER_ROLE) {
        // Crystallize the vesting schedule before its period can change underneath it.
        lockedProfit = unvestedProfit();
        lockedAt = uint64(block.timestamp);
        _setConfig(next);
    }

    function pause() external onlyRole(GUARDIAN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function _setConfig(Config memory next) private {
        if (
            next.reserveBps > BPS || next.performanceFeeBps > MAX_PERFORMANCE_FEE_BPS || next.maxNavChangeBps == 0
                || next.profitVestingPeriod > MAX_VESTING_PERIOD
                || (next.performanceFeeBps > 0 && next.feeRecipient == address(0))
        ) revert InvalidConfig();
        config = next;
        emit ConfigUpdated(next);
    }

    function _idle() private view returns (uint256) {
        return IERC20(asset()).balanceOf(address(this));
    }
}
