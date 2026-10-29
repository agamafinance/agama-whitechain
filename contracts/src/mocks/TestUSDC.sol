// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title TestUSDC
/// @notice A six decimal test dollar with a faucet, deployed on both legs so the route can be driven end to end.
/// @dev Whitechain has no native USDC and no CCTP domain: the only USDC there is USDC.e through WhiteBIT's Portal.
///      Testnet users should not need a bridge round trip to try a vault, so this token stands in on both chains,
///      and the burn-and-mint messenger holds MINTER_ROLE on each, which is how CCTP itself treats USDC.
contract TestUSDC is ERC20, ERC20Permit, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    uint256 public constant FAUCET_AMOUNT = 10_000e6;
    uint256 public constant FAUCET_COOLDOWN = 1 hours;

    mapping(address => uint256) public lastDrip;

    error FaucetCoolingDown(uint256 availableAt);

    constructor(address admin) ERC20("USD Coin (Agama test)", "USDC") ERC20Permit("USD Coin (Agama test)") {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Ten thousand test dollars, once an hour per address.
    function faucet() external {
        uint256 next = lastDrip[msg.sender] + FAUCET_COOLDOWN;
        if (lastDrip[msg.sender] != 0 && block.timestamp < next) revert FaucetCoolingDown(next);
        lastDrip[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
    }

    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }

    /// @notice Burns from the caller's own balance, the shape of Circle's FiatToken `burn`.
    function burn(uint256 amount) external onlyRole(MINTER_ROLE) {
        _burn(msg.sender, amount);
    }
}
