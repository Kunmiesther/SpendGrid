// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title QIEDexPair
/// @notice Minimal constant-product pair with Uniswap V2-compatible reserve reads.
contract QIEDexPair is ERC20 {
    uint256 private constant MINIMUM_LIQUIDITY = 1000;

    address public immutable factory;
    address public token0;
    address public token1;

    uint112 private reserve0;
    uint112 private reserve1;
    uint32 private blockTimestampLast;

    bool private initialized;

    event Mint(address indexed sender, uint256 amount0, uint256 amount1);
    event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to);
    event Swap(
        address indexed sender,
        uint256 amount0In,
        uint256 amount1In,
        uint256 amount0Out,
        uint256 amount1Out,
        address indexed to
    );
    event Sync(uint112 reserve0, uint112 reserve1);

    modifier onlyFactory() {
        require(msg.sender == factory, "QIEDexPair: forbidden");
        _;
    }

    constructor() ERC20("QIEDex LP", "QIELP") {
        factory = msg.sender;
    }

    function initialize(address token0_, address token1_) external onlyFactory {
        require(!initialized, "QIEDexPair: already initialized");
        require(token0_ != address(0) && token1_ != address(0), "QIEDexPair: zero token");
        token0 = token0_;
        token1 = token1_;
        initialized = true;
    }

    function getReserves()
        external
        view
        returns (uint112 reserve0_, uint112 reserve1_, uint32 blockTimestampLast_)
    {
        reserve0_ = reserve0;
        reserve1_ = reserve1;
        blockTimestampLast_ = blockTimestampLast;
    }

    function mint(address to) external returns (uint256 liquidity) {
        (uint112 reserve0_, uint112 reserve1_,) = this.getReserves();
        uint256 balance0 = IERC20(token0).balanceOf(address(this));
        uint256 balance1 = IERC20(token1).balanceOf(address(this));
        uint256 amount0 = balance0 - reserve0_;
        uint256 amount1 = balance1 - reserve1_;
        uint256 supply = totalSupply();

        if (supply == 0) {
            liquidity = Math.sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY;
            _mint(address(0x000000000000000000000000000000000000dEaD), MINIMUM_LIQUIDITY);
        } else {
            liquidity = Math.min((amount0 * supply) / reserve0_, (amount1 * supply) / reserve1_);
        }

        require(liquidity > 0, "QIEDexPair: insufficient liquidity minted");
        _mint(to, liquidity);
        _update(balance0, balance1);
        emit Mint(msg.sender, amount0, amount1);
    }

    function burn(address to) external returns (uint256 amount0, uint256 amount1) {
        (uint112 reserve0_, uint112 reserve1_,) = this.getReserves();
        address token0_ = token0;
        address token1_ = token1;
        uint256 balance0 = IERC20(token0_).balanceOf(address(this));
        uint256 balance1 = IERC20(token1_).balanceOf(address(this));
        uint256 liquidity = balanceOf(address(this));
        uint256 supply = totalSupply();

        amount0 = (liquidity * balance0) / supply;
        amount1 = (liquidity * balance1) / supply;
        require(amount0 > 0 && amount1 > 0, "QIEDexPair: insufficient liquidity burned");

        _burn(address(this), liquidity);
        require(IERC20(token0_).transfer(to, amount0), "QIEDexPair: token0 transfer failed");
        require(IERC20(token1_).transfer(to, amount1), "QIEDexPair: token1 transfer failed");

        balance0 = IERC20(token0_).balanceOf(address(this));
        balance1 = IERC20(token1_).balanceOf(address(this));
        require(balance0 <= type(uint112).max && balance1 <= type(uint112).max, "QIEDexPair: reserve overflow");
        reserve0_;
        reserve1_;
        _update(balance0, balance1);
        emit Burn(msg.sender, amount0, amount1, to);
    }

    function swap(uint256 amount0Out, uint256 amount1Out, address to) external {
        require(amount0Out > 0 || amount1Out > 0, "QIEDexPair: insufficient output");
        (uint112 reserve0_, uint112 reserve1_,) = this.getReserves();
        require(amount0Out < reserve0_ && amount1Out < reserve1_, "QIEDexPair: insufficient liquidity");
        require(to != token0 && to != token1, "QIEDexPair: invalid recipient");

        if (amount0Out > 0) {
            require(IERC20(token0).transfer(to, amount0Out), "QIEDexPair: token0 transfer failed");
        }
        if (amount1Out > 0) {
            require(IERC20(token1).transfer(to, amount1Out), "QIEDexPair: token1 transfer failed");
        }

        uint256 balance0 = IERC20(token0).balanceOf(address(this));
        uint256 balance1 = IERC20(token1).balanceOf(address(this));
        uint256 amount0In = balance0 > reserve0_ - amount0Out ? balance0 - (reserve0_ - amount0Out) : 0;
        uint256 amount1In = balance1 > reserve1_ - amount1Out ? balance1 - (reserve1_ - amount1Out) : 0;
        require(amount0In > 0 || amount1In > 0, "QIEDexPair: insufficient input");

        require(
            ((balance0 * 1000) - (amount0In * 3)) * ((balance1 * 1000) - (amount1In * 3))
                >= uint256(reserve0_) * uint256(reserve1_) * 1_000_000,
            "QIEDexPair: invariant"
        );

        _update(balance0, balance1);
        emit Swap(msg.sender, amount0In, amount1In, amount0Out, amount1Out, to);
    }

    function sync() external {
        _update(IERC20(token0).balanceOf(address(this)), IERC20(token1).balanceOf(address(this)));
    }

    function _update(uint256 balance0, uint256 balance1) private {
        require(balance0 <= type(uint112).max && balance1 <= type(uint112).max, "QIEDexPair: reserve overflow");
        reserve0 = uint112(balance0);
        reserve1 = uint112(balance1);
        blockTimestampLast = uint32(block.timestamp % 2 ** 32);
        emit Sync(reserve0, reserve1);
    }
}
