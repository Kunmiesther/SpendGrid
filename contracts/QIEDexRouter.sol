// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {QIEDexFactory} from "./QIEDexFactory.sol";
import {QIEDexPair} from "./QIEDexPair.sol";

/// @title QIEDexRouter
/// @notice Minimal QIEDex router compatible with the backend liquidity engine.
contract QIEDexRouter {
    address public immutable factory;
    address public immutable WETH;

    error Expired();
    error InvalidPath();
    error PairMissing(address tokenA, address tokenB);
    error InsufficientOutputAmount();
    error TransferFailed();

    constructor(address factory_, address wqie_) {
        require(factory_ != address(0), "QIEDexRouter: zero factory");
        require(wqie_ != address(0), "QIEDexRouter: zero WQIE");
        factory = factory_;
        WETH = wqie_;
    }

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external returns (uint256 amountA, uint256 amountB, uint256 liquidity) {
        if (block.timestamp > deadline) revert Expired();
        require(amountADesired >= amountAMin && amountBDesired >= amountBMin, "QIEDexRouter: slippage");

        address pair = QIEDexFactory(factory).getPair(tokenA, tokenB);
        if (pair == address(0)) {
            pair = QIEDexFactory(factory).createPair(tokenA, tokenB);
        }

        amountA = amountADesired;
        amountB = amountBDesired;
        _safeTransferFrom(tokenA, msg.sender, pair, amountA);
        _safeTransferFrom(tokenB, msg.sender, pair, amountB);
        liquidity = QIEDexPair(pair).mint(to);
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts) {
        if (block.timestamp > deadline) revert Expired();
        if (path.length != 2) revert InvalidPath();

        address input = path[0];
        address output = path[1];
        address pair = QIEDexFactory(factory).getPair(input, output);
        if (pair == address(0)) revert PairMissing(input, output);

        amounts = new uint256[](2);
        amounts[0] = amountIn;
        amounts[1] = getAmountOut(amountIn, input, output);
        if (amounts[1] < amountOutMin) revert InsufficientOutputAmount();

        _safeTransferFrom(input, msg.sender, pair, amountIn);
        (address token0,) = QIEDexFactory(factory).sortTokens(input, output);
        (uint256 amount0Out, uint256 amount1Out) = input == token0
            ? (uint256(0), amounts[1])
            : (amounts[1], uint256(0));
        QIEDexPair(pair).swap(amount0Out, amount1Out, to);
    }

    function getAmountOut(uint256 amountIn, address input, address output) public view returns (uint256 amountOut) {
        require(amountIn > 0, "QIEDexRouter: insufficient input");
        address pair = QIEDexFactory(factory).getPair(input, output);
        if (pair == address(0)) revert PairMissing(input, output);

        (uint112 reserve0, uint112 reserve1,) = QIEDexPair(pair).getReserves();
        (address token0,) = QIEDexFactory(factory).sortTokens(input, output);
        (uint256 reserveIn, uint256 reserveOut) = input == token0
            ? (uint256(reserve0), uint256(reserve1))
            : (uint256(reserve1), uint256(reserve0));
        require(reserveIn > 0 && reserveOut > 0, "QIEDexRouter: no liquidity");

        uint256 amountInWithFee = amountIn * 997;
        amountOut = (amountInWithFee * reserveOut) / ((reserveIn * 1000) + amountInWithFee);
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) private {
        (bool ok, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, amount)
        );
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }
}
