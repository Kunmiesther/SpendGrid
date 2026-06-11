// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title MockQIEStable
/// @notice Testnet payment asset for SpendGrid protocol deployments.
contract MockQIEStable is ERC20, Ownable {
    uint256 public constant INITIAL_SUPPLY = 1_000_000_000 ether;

    constructor() ERC20("Mock QIE Stable", "mQIE") Ownable(msg.sender) {
        _mint(msg.sender, INITIAL_SUPPLY);
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
