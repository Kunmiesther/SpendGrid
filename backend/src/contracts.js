const { ethers } = require("ethers");
const { CHAIN_ID, loadArtifact, loadDeployment } = require("./deployment");
const { FACTORY_ABI, ROUTER_ABI } = require("../services/liquidityEngine");

const ERC20_ABI = [
  "function approve(address spender,uint256 amount) external returns (bool)",
  "function allowance(address owner,address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
  "function transfer(address to,uint256 amount) external returns (bool)",
  "function decimals() external view returns (uint8)"
];

async function assertQieTestnet(provider) {
  const network = await provider.getNetwork();
  if (network.chainId !== BigInt(CHAIN_ID)) {
    throw new Error(`Expected QIE Testnet chain ID ${CHAIN_ID}, received ${network.chainId.toString()}`);
  }
}

function makeContracts() {
  const deployment = loadDeployment();
  const rpcUrl = process.env.QIE_RPC_URL;
  const privateKey = process.env.BACKEND_PRIVATE_KEY;

  if (!rpcUrl) {
    throw new Error("QIE_RPC_URL is required");
  }
  if (!privateKey) {
    throw new Error("BACKEND_PRIVATE_KEY is required for autonomous agent execution");
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl, CHAIN_ID);
  const signer = new ethers.Wallet(privateKey, provider);
  const registryArtifact = loadArtifact("AgentRegistry");
  const controllerArtifact = loadArtifact("SpendController");
  const vaultArtifact = loadArtifact("StreamVault");

  const registry = new ethers.Contract(deployment.addresses.agentRegistry, registryArtifact.abi, signer);
  const controller = new ethers.Contract(deployment.addresses.spendController, controllerArtifact.abi, signer);
  const vault = new ethers.Contract(deployment.addresses.streamVault, vaultArtifact.abi, signer);
  const qusdc = new ethers.Contract(deployment.addresses.qusdc, ERC20_ABI, signer);
  const wqie = new ethers.Contract(deployment.addresses.wqie, ERC20_ABI, signer);
  const qiedexRouter = new ethers.Contract(deployment.addresses.qiedexRouter, ROUTER_ABI, signer);
  const qiedexFactory = new ethers.Contract(deployment.addresses.qiedexFactory, FACTORY_ABI, signer);

  return {
    deployment,
    provider,
    signer,
    addresses: {
      registry: deployment.addresses.agentRegistry,
      controller: deployment.addresses.spendController,
      vault: deployment.addresses.streamVault,
      qiedexRouter: deployment.addresses.qiedexRouter,
      qiedexFactory: deployment.addresses.qiedexFactory,
      wqie: deployment.addresses.wqie,
      qusdc: deployment.addresses.qusdc
    },
    registry,
    controller,
    vault,
    qiedexRouter,
    qiedexFactory,
    qusdc,
    wqie
  };
}

function makeStreamVaultAdapter(vault) {
  return {
    contract: vault,
    createStream: (...args) => vault.createStream(...args),
    executePayment: (...args) => vault.executePayment(...args),
    stopStream: (...args) => vault.closeStream(...args),
    getStream: (...args) => vault.getStream(...args),
    interface: vault.interface
  };
}

module.exports = {
  ERC20_ABI,
  assertQieTestnet,
  makeContracts,
  makeStreamVaultAdapter
};
