// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AgentRegistry} from "./AgentRegistry.sol";
import {SpendController} from "./SpendController.sol";

/// @title StreamVault
/// @notice Settles real QIE stablecoin payments against per-agent budget controls.
contract StreamVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Stream {
        uint256 agentId;
        address payer;
        address receiver;
        uint256 ratePerUnit;
        bool active;
        uint256 createdAt;
        uint256 totalUnits;
        uint256 totalPaid;
    }

    IERC20 public immutable qieStablecoin;
    SpendController public immutable spendController;
    AgentRegistry public immutable registry;

    uint256 private _nextStreamId = 1;
    mapping(uint256 => Stream) private _streams;

    error InvalidToken();
    error InvalidSpendController();
    error InvalidRegistry();
    error InvalidReceiver();
    error InvalidRate();
    error InvalidUnits();
    error StreamNotFound(uint256 streamId);
    error StreamInactive(uint256 streamId);
    error AgentInactive(uint256 agentId);
    error UnauthorizedStreamOperator(uint256 streamId, address caller);
    error ServiceNotWhitelisted(uint256 agentId, address service);
    error BudgetExceeded(uint256 agentId, uint256 amount);

    event StreamCreated(
        uint256 indexed streamId,
        uint256 indexed agentId,
        address indexed payer,
        address receiver,
        uint256 ratePerUnit,
        uint256 createdAt
    );

    event PaymentExecuted(
        uint256 indexed streamId,
        uint256 indexed agentId,
        address indexed payer,
        address receiver,
        address token,
        uint256 units,
        uint256 amount,
        uint256 ratePerUnit,
        uint256 totalUnits,
        uint256 totalPaid,
        uint256 timestamp
    );

    event StreamClosed(
        uint256 indexed streamId,
        uint256 indexed agentId,
        address indexed payer,
        address receiver,
        uint256 totalUnits,
        uint256 totalPaid,
        uint256 closedAt
    );

    constructor(address qieStablecoin_, address spendController_, address agentRegistry_) Ownable(msg.sender) {
        if (qieStablecoin_ == address(0)) revert InvalidToken();
        if (spendController_ == address(0)) revert InvalidSpendController();
        if (agentRegistry_ == address(0)) revert InvalidRegistry();

        qieStablecoin = IERC20(qieStablecoin_);
        spendController = SpendController(spendController_);
        registry = AgentRegistry(agentRegistry_);
    }

    function createStream(uint256 agentId, address receiver, uint256 ratePerUnit)
        external
        returns (uint256 streamId)
    {
        if (receiver == address(0)) revert InvalidReceiver();
        if (ratePerUnit == 0) revert InvalidRate();

        AgentRegistry.Agent memory agent = registry.getAgent(agentId);
        if (!agent.active) revert AgentInactive(agentId);
        if (msg.sender != agent.owner && msg.sender != agent.agentWallet) {
            revert UnauthorizedStreamOperator(0, msg.sender);
        }
        if (!spendController.isServiceWhitelisted(agentId, address(this))) {
            revert ServiceNotWhitelisted(agentId, address(this));
        }

        streamId = _nextStreamId++;
        _streams[streamId] = Stream({
            agentId: agentId,
            payer: msg.sender,
            receiver: receiver,
            ratePerUnit: ratePerUnit,
            active: true,
            createdAt: block.timestamp,
            totalUnits: 0,
            totalPaid: 0
        });

        emit StreamCreated(streamId, agentId, msg.sender, receiver, ratePerUnit, block.timestamp);
    }

    function executePayment(uint256 streamId, uint256 units) external nonReentrant {
        if (units == 0) revert InvalidUnits();

        Stream storage stream = _streams[streamId];
        if (stream.payer == address(0)) revert StreamNotFound(streamId);
        if (!stream.active) revert StreamInactive(streamId);

        AgentRegistry.Agent memory agent = registry.getAgent(stream.agentId);
        if (!agent.active) revert AgentInactive(stream.agentId);
        if (msg.sender != stream.payer && msg.sender != agent.owner && msg.sender != agent.agentWallet) {
            revert UnauthorizedStreamOperator(streamId, msg.sender);
        }

        uint256 amount = stream.ratePerUnit * units;

        if (!spendController.canSpend(stream.agentId, amount)) {
            revert BudgetExceeded(stream.agentId, amount);
        }

        bool recorded = spendController.recordSpend(stream.agentId, amount);
        if (!recorded) {
            revert BudgetExceeded(stream.agentId, amount);
        }

        stream.totalUnits += units;
        stream.totalPaid += amount;

        qieStablecoin.safeTransferFrom(stream.payer, stream.receiver, amount);

        emit PaymentExecuted(
            streamId,
            stream.agentId,
            stream.payer,
            stream.receiver,
            address(qieStablecoin),
            units,
            amount,
            stream.ratePerUnit,
            stream.totalUnits,
            stream.totalPaid,
            block.timestamp
        );
    }

    function closeStream(uint256 streamId) external {
        Stream storage stream = _streams[streamId];
        if (stream.payer == address(0)) revert StreamNotFound(streamId);
        if (!stream.active) revert StreamInactive(streamId);

        AgentRegistry.Agent memory agent = registry.getAgent(stream.agentId);
        if (msg.sender != stream.payer && msg.sender != agent.owner && msg.sender != agent.agentWallet && msg.sender != owner()) {
            revert UnauthorizedStreamOperator(streamId, msg.sender);
        }

        stream.active = false;

        emit StreamClosed(
            streamId,
            stream.agentId,
            stream.payer,
            stream.receiver,
            stream.totalUnits,
            stream.totalPaid,
            block.timestamp
        );
    }

    function getStream(uint256 streamId) external view returns (Stream memory stream) {
        stream = _streams[streamId];
        if (stream.payer == address(0)) revert StreamNotFound(streamId);
    }

    function nextStreamId() external view returns (uint256) {
        return _nextStreamId;
    }
}
