// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {AgentRegistry} from "./AgentRegistry.sol";

/// @title SpendController
/// @notice Enforces per-agent daily budgets, service whitelists, and pause controls.
contract SpendController is Ownable {
    struct Budget {
        uint256 dailyLimit;
        uint256 spentToday;
        uint256 lastResetTimestamp;
        bool paused;
        mapping(address => bool) whitelisted;
    }

    uint256 public constant DAILY_WINDOW = 1 days;

    bytes32 public constant REASON_AGENT_INACTIVE = "AGENT_INACTIVE";
    bytes32 public constant REASON_AGENT_PAUSED = "AGENT_PAUSED";
    bytes32 public constant REASON_SERVICE_NOT_WHITELISTED = "SERVICE_NOT_WHITELISTED";
    bytes32 public constant REASON_LIMIT_EXCEEDED = "LIMIT_EXCEEDED";

    AgentRegistry public immutable registry;

    mapping(uint256 => Budget) private _budgets;

    error InvalidRegistry();
    error InvalidService();
    error AgentInactive(uint256 agentId);
    error UnauthorizedAgentOperator(uint256 agentId, address caller);

    event BudgetUpdated(
        uint256 indexed agentId,
        uint256 dailyLimit,
        uint256 spentToday,
        uint256 lastResetTimestamp,
        address indexed updatedBy
    );

    event AgentPaused(uint256 indexed agentId, address indexed pausedBy);
    event AgentUnpaused(uint256 indexed agentId, address indexed unpausedBy);

    event ServiceWhitelistUpdated(
        uint256 indexed agentId,
        address indexed service,
        bool allowed,
        address indexed updatedBy
    );

    event SpendApproved(
        uint256 indexed agentId,
        address indexed service,
        uint256 amount,
        uint256 spentToday,
        uint256 dailyLimit,
        uint256 timestamp
    );

    event SpendBlocked(
        uint256 indexed agentId,
        address indexed service,
        uint256 amount,
        bytes32 reason,
        uint256 timestamp
    );

    constructor(address agentRegistry) Ownable(msg.sender) {
        if (agentRegistry == address(0)) revert InvalidRegistry();
        registry = AgentRegistry(agentRegistry);
    }

    modifier onlyAgentOwnerOrProtocol(uint256 agentId) {
        AgentRegistry.Agent memory agent = registry.getAgent(agentId);
        if (msg.sender != agent.owner && msg.sender != owner()) {
            revert UnauthorizedAgentOperator(agentId, msg.sender);
        }
        _;
    }

    function setBudget(uint256 agentId, uint256 limit) external onlyAgentOwnerOrProtocol(agentId) {
        if (!registry.isAgentActive(agentId)) revert AgentInactive(agentId);

        Budget storage budget = _budgets[agentId];
        _resetIfNeeded(budget);
        if (budget.lastResetTimestamp == 0) {
            budget.lastResetTimestamp = block.timestamp;
        }

        budget.dailyLimit = limit;

        emit BudgetUpdated(agentId, limit, budget.spentToday, budget.lastResetTimestamp, msg.sender);
    }

    function pauseAgent(uint256 agentId) external onlyAgentOwnerOrProtocol(agentId) {
        Budget storage budget = _budgets[agentId];
        budget.paused = true;
        emit AgentPaused(agentId, msg.sender);
    }

    function unpauseAgent(uint256 agentId) external onlyAgentOwnerOrProtocol(agentId) {
        if (!registry.isAgentActive(agentId)) revert AgentInactive(agentId);

        Budget storage budget = _budgets[agentId];
        budget.paused = false;
        emit AgentUnpaused(agentId, msg.sender);
    }

    function setServiceWhitelist(uint256 agentId, address service, bool allowed)
        external
        onlyAgentOwnerOrProtocol(agentId)
    {
        if (service == address(0)) revert InvalidService();
        if (!registry.isAgentActive(agentId)) revert AgentInactive(agentId);

        _budgets[agentId].whitelisted[service] = allowed;

        emit ServiceWhitelistUpdated(agentId, service, allowed, msg.sender);
    }

    function canSpend(uint256 agentId, uint256 amount) external view returns (bool) {
        return _canSpend(agentId, msg.sender, amount);
    }

    function canSpendFor(uint256 agentId, address service, uint256 amount) external view returns (bool) {
        if (service == address(0)) return false;
        return _canSpend(agentId, service, amount);
    }

    function recordSpend(uint256 agentId, uint256 amount) external returns (bool) {
        Budget storage budget = _budgets[agentId];
        (bool allowed, bytes32 reason) = _spendStatus(agentId, msg.sender, amount, budget);

        if (!allowed) {
            emit SpendBlocked(agentId, msg.sender, amount, reason, block.timestamp);
            return false;
        }

        _resetIfNeeded(budget);
        if (budget.lastResetTimestamp == 0) {
            budget.lastResetTimestamp = block.timestamp;
        }

        budget.spentToday += amount;

        emit SpendApproved(agentId, msg.sender, amount, budget.spentToday, budget.dailyLimit, block.timestamp);
        return true;
    }

    function getBudget(uint256 agentId)
        external
        view
        returns (
            uint256 dailyLimit,
            uint256 spentToday,
            uint256 lastResetTimestamp,
            uint256 nextResetTimestamp,
            bool paused
        )
    {
        Budget storage budget = _budgets[agentId];
        dailyLimit = budget.dailyLimit;
        spentToday = _effectiveSpentToday(budget);
        lastResetTimestamp = budget.lastResetTimestamp;
        nextResetTimestamp = budget.lastResetTimestamp == 0 ? 0 : budget.lastResetTimestamp + DAILY_WINDOW;
        paused = budget.paused;
    }

    function isServiceWhitelisted(uint256 agentId, address service) external view returns (bool) {
        return _budgets[agentId].whitelisted[service];
    }

    function _canSpend(uint256 agentId, address service, uint256 amount) internal view returns (bool) {
        Budget storage budget = _budgets[agentId];
        (bool allowed,) = _spendStatus(agentId, service, amount, budget);
        return allowed;
    }

    function _spendStatus(uint256 agentId, address service, uint256 amount, Budget storage budget)
        internal
        view
        returns (bool allowed, bytes32 reason)
    {
        if (!registry.isAgentActive(agentId)) return (false, REASON_AGENT_INACTIVE);
        if (budget.paused) return (false, REASON_AGENT_PAUSED);
        if (!budget.whitelisted[service]) return (false, REASON_SERVICE_NOT_WHITELISTED);

        uint256 spentToday = _effectiveSpentToday(budget);
        if (spentToday > budget.dailyLimit) return (false, REASON_LIMIT_EXCEEDED);

        uint256 remaining = budget.dailyLimit - spentToday;
        if (amount > remaining) return (false, REASON_LIMIT_EXCEEDED);

        return (true, bytes32(0));
    }

    function _effectiveSpentToday(Budget storage budget) internal view returns (uint256) {
        if (budget.lastResetTimestamp == 0) return 0;
        if (block.timestamp >= budget.lastResetTimestamp + DAILY_WINDOW) return 0;
        return budget.spentToday;
    }

    function _resetIfNeeded(Budget storage budget) internal {
        if (budget.lastResetTimestamp == 0) return;
        if (block.timestamp < budget.lastResetTimestamp + DAILY_WINDOW) return;

        budget.spentToday = 0;
        budget.lastResetTimestamp = block.timestamp;
    }
}
