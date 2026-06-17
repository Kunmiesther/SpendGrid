// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title Wrapped QIE
/// @notice Minimal ERC20 wrapper for native QIE used by the QIEDex pool.
contract WQIE is ERC20 {
    event Deposit(address indexed account, uint256 amount);
    event Withdrawal(address indexed account, uint256 amount);

    constructor() ERC20("Wrapped QIE", "WQIE") {}

    receive() external payable {
        deposit();
    }

    function deposit() public payable {
        require(msg.value > 0, "WQIE: zero deposit");
        _mint(msg.sender, msg.value);
        emit Deposit(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        require(amount > 0, "WQIE: zero withdrawal");
        _burn(msg.sender, amount);
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "WQIE: native transfer failed");
        emit Withdrawal(msg.sender, amount);
    }
}
