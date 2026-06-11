const { ethers } = require("ethers");
const { CHAIN_ID, loadArtifact, loadDeployment } = require("./deployment");

const ERC20_ABI = [
  "function approve(address spender,uint256 amount) external returns (bool)",
  "function allowance(address owner,address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
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

  return {
    deployment,
    provider,
    signer,
    addresses: {
      registry: deployment.addresses.agentRegistry,
      controller: deployment.addresses.spendController,
      vault: deployment.addresses.streamVault,
      stablecoin: deployment.addresses.mockQIEStable
    },
    registry,
    controller,
    vault,
    stablecoin: new ethers.Contract(deployment.addresses.mockQIEStable, ERC20_ABI, signer)
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
