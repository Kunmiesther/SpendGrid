// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title AgentRegistry
/// @notice Registers AI agents and binds each one to an owner, execution wallet, and QIE Pass identity.
contract AgentRegistry is Ownable {
    struct Agent {
        address owner;
        address agentWallet;
        bytes32 qiePassId;
        bool active;
        uint256 createdAt;
    }

    error InvalidAgentWallet();
    error InvalidQiePassId();
    error OwnerAlreadyRegistered(address owner);
    error AgentWalletAlreadyRegistered(address agentWallet);
    error QiePassAlreadyRegistered(bytes32 qiePassId);
    error AgentNotFound(uint256 agentId);
    error AgentAlreadyInactive(uint256 agentId);
    error UnauthorizedAgentOperator(uint256 agentId, address caller);

    uint256 private _nextAgentId = 1;

    mapping(uint256 => Agent) private _agents;
    mapping(address => uint256) public ownerAgentId;
    mapping(address => uint256) public executionWalletAgentId;
    mapping(bytes32 => uint256) public qiePassAgentId;

    event AgentRegistered(
        uint256 indexed agentId,
        address indexed owner,
        address indexed agentWallet,
        bytes32 qiePassId,
        uint256 createdAt
    );

    event AgentDeactivated(
        uint256 indexed agentId,
        address indexed owner,
        address indexed agentWallet,
        bytes32 qiePassId,
        uint256 deactivatedAt
    );

    constructor() Ownable(msg.sender) {}

    function registerAgent(address agentWallet, bytes32 qiePassId) external returns (uint256 agentId) {
        if (agentWallet == address(0)) revert InvalidAgentWallet();
        if (qiePassId == bytes32(0)) revert InvalidQiePassId();
        if (ownerAgentId[msg.sender] != 0) revert OwnerAlreadyRegistered(msg.sender);
        if (executionWalletAgentId[agentWallet] != 0) revert AgentWalletAlreadyRegistered(agentWallet);
        if (qiePassAgentId[qiePassId] != 0) revert QiePassAlreadyRegistered(qiePassId);

        agentId = _nextAgentId++;

        _agents[agentId] = Agent({
            owner: msg.sender,
            agentWallet: agentWallet,
            qiePassId: qiePassId,
            active: true,
            createdAt: block.timestamp
        });

        ownerAgentId[msg.sender] = agentId;
        executionWalletAgentId[agentWallet] = agentId;
        qiePassAgentId[qiePassId] = agentId;

        emit AgentRegistered(agentId, msg.sender, agentWallet, qiePassId, block.timestamp);
    }

    function deactivateAgent(uint256 agentId) external {
        Agent storage agent = _agents[agentId];
        if (agent.owner == address(0)) revert AgentNotFound(agentId);
        if (msg.sender != agent.owner && msg.sender != owner()) {
            revert UnauthorizedAgentOperator(agentId, msg.sender);
        }
        if (!agent.active) revert AgentAlreadyInactive(agentId);

        agent.active = false;

        emit AgentDeactivated(agentId, agent.owner, agent.agentWallet, agent.qiePassId, block.timestamp);
    }

    function getAgent(uint256 agentId) external view returns (Agent memory agent) {
        agent = _agents[agentId];
        if (agent.owner == address(0)) revert AgentNotFound(agentId);
    }

    function isAgentActive(uint256 agentId) external view returns (bool) {
        return _agents[agentId].active;
    }

    function nextAgentId() external view returns (uint256) {
        return _nextAgentId;
    }
}
