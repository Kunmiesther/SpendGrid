import { ethers } from "ethers";

export const QIE_MAINNET_CHAIN_ID = 1990;
export const QIE_MAINNET_NETWORK = "qie-mainnet";
export const DEFAULT_TOKEN_DECIMALS = 18;

export const DEFAULT_ADDRESSES = Object.freeze({
  qusdc: "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5"
});

export const NETWORKS = Object.freeze({
  qieMainnet: Object.freeze({
    name: QIE_MAINNET_NETWORK,
    chainId: QIE_MAINNET_CHAIN_ID,
    addresses: DEFAULT_ADDRESSES
  })
});

export const AGENT_REGISTRY_ABI = Object.freeze([
  "function registerAgent(address agentWallet,bytes32 qiePassId) returns (uint256 agentId)",
  "function getAgent(uint256 agentId) view returns (tuple(address owner,address agentWallet,bytes32 qiePassId,bool active,uint256 createdAt) agent)",
  "function isAgentActive(uint256 agentId) view returns (bool)",
  "function ownerAgentId(address owner) view returns (uint256)",
  "function executionWalletAgentId(address agentWallet) view returns (uint256)"
]);

export const SPEND_CONTROLLER_ABI = Object.freeze([
  "function setBudget(uint256 agentId,uint256 limit)",
  "function setServiceWhitelist(uint256 agentId,address service,bool allowed)",
  "function getBudget(uint256 agentId) view returns (uint256 dailyLimit,uint256 spentToday,uint256 lastResetTimestamp,uint256 nextResetTimestamp,bool paused)",
  "function canSpendFor(uint256 agentId,address service,uint256 amount) view returns (bool)",
  "function isServiceWhitelisted(uint256 agentId,address service) view returns (bool)",
  "function pauseAgent(uint256 agentId) returns ()"
]);

export const STREAM_VAULT_ABI = Object.freeze([
  "function createStream(uint256 agentId,address receiver,uint256 ratePerUnit) returns (uint256 streamId)",
  "function executePayment(uint256 streamId,uint256 units)",
  "function closeStream(uint256 streamId)",
  "function getStream(uint256 streamId) view returns (tuple(uint256 agentId,address payer,address receiver,uint256 ratePerUnit,bool active,uint256 createdAt,uint256 totalUnits,uint256 totalPaid) stream)",
  "event StreamCreated(uint256 indexed streamId,uint256 indexed agentId,address indexed payer,address receiver,uint256 ratePerUnit,uint256 createdAt)",
  "event PaymentExecuted(uint256 indexed streamId,uint256 indexed agentId,address indexed payer,address receiver,address token,uint256 units,uint256 amount,uint256 ratePerUnit,uint256 totalUnits,uint256 totalPaid,uint256 timestamp)"
]);

export const ERC20_ABI = Object.freeze([
  "function allowance(address owner,address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function transfer(address to,uint256 amount) returns (bool)"
]);

export function resolveNetworkConfig(network = "qieMainnet") {
  if (typeof network === "string") {
    const configured = NETWORKS[network];
    if (!configured) {
      throw new Error(`Unsupported SpendGrid network: ${network}`);
    }
    return configured;
  }

  if (!network || typeof network !== "object") {
    throw new Error("network must be a configured SpendGrid network name or object");
  }

  return {
    name: network.name || QIE_MAINNET_NETWORK,
    chainId: Number(network.chainId || QIE_MAINNET_CHAIN_ID),
    addresses: {
      ...DEFAULT_ADDRESSES,
      ...(network.addresses || {})
    }
  };
}

export function normalizeDeployment(deployment = {}) {
  const addresses = deployment.addresses || {};
  const normalized = {
    network: deployment.network || QIE_MAINNET_NETWORK,
    chainId: Number(deployment.chainId || QIE_MAINNET_CHAIN_ID),
    addresses: {
      qusdc: normalizeAddress(
        "QUSDC",
        addresses.qusdc || addresses.mockQUSDC || addresses.mockQusdc || addresses.mockQIEStable || deployment.qieStablecoin || deployment.stable || deployment.qusdc
      )
    }
  };

  const agentRegistry = addresses.agentRegistry || deployment.agentRegistry || deployment.registry;
  const spendController = addresses.spendController || deployment.spendController || deployment.controller;
  const streamVault = addresses.streamVault || deployment.streamVault || deployment.vault;

  if (agentRegistry) {
    normalized.addresses.agentRegistry = normalizeAddress("AgentRegistry", agentRegistry);
  }
  if (spendController) {
    normalized.addresses.spendController = normalizeAddress("SpendController", spendController);
  }
  if (streamVault) {
    normalized.addresses.streamVault = normalizeAddress("StreamVault", streamVault);
  }

  return normalized;
}

export function normalizeAddress(label, value) {
  if (!value || !ethers.isAddress(value) || value.toLowerCase() === ethers.ZeroAddress.toLowerCase()) {
    throw new Error(`${label} must be a valid non-zero address`);
  }

  return ethers.getAddress(value);
}
