// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {QIEDexPair} from "./QIEDexPair.sol";

/// @title QIEDexFactory
/// @notice Minimal factory for deterministic WQIE/QUSDC pair creation and lookup.
contract QIEDexFactory {
    address public feeToSetter;
    address[] public allPairs;

    mapping(address => mapping(address => address)) public getPair;

    event PairCreated(address indexed token0, address indexed token1, address pair, uint256 pairCount);

    constructor(address feeToSetter_) {
        require(feeToSetter_ != address(0), "QIEDexFactory: zero fee setter");
        feeToSetter = feeToSetter_;
    }

    function allPairsLength() external view returns (uint256) {
        return allPairs.length;
    }

    function createPair(address tokenA, address tokenB) external returns (address pair) {
        require(tokenA != tokenB, "QIEDexFactory: identical tokens");
        (address token0, address token1) = sortTokens(tokenA, tokenB);
        require(token0 != address(0), "QIEDexFactory: zero token");
        require(getPair[token0][token1] == address(0), "QIEDexFactory: pair exists");

        pair = address(new QIEDexPair());
        QIEDexPair(pair).initialize(token0, token1);
        getPair[token0][token1] = pair;
        getPair[token1][token0] = pair;
        allPairs.push(pair);

        emit PairCreated(token0, token1, pair, allPairs.length);
    }

    function sortTokens(address tokenA, address tokenB) public pure returns (address token0, address token1) {
        require(tokenA != tokenB, "QIEDexFactory: identical tokens");
        (token0, token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        require(token0 != address(0), "QIEDexFactory: zero token");
    }
}
