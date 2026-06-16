const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const CONTROLLER_ADDRESS = "0xDDe02252aebDdF65F4Ec373881F544107Bd62796";
const AGENT_ID = 1;
const DEFAULT_QIE_PASS_ID = "spendgrid-bootstrap-agent-1";

function sameAddress(left, right) {
  return left.toLowerCase() === right.toLowerCase();
}

function formatError(error) {
  return error.shortMessage || error.reason || error.message || String(error);
}

function normalizeBytes32(value) {
  if (!value) {
    throw new Error("qiePassId is required");
  }

  if (hre.ethers.isHexString(value, 32)) {
    return value;
  }

  return hre.ethers.id(String(value));
}

function requireAddress(label, value) {
  if (!hre.ethers.isAddress(value)) {
    throw new Error(`${label} is not a valid address: ${value}`);
  }

  return hre.ethers.getAddress(value);
}

function deploymentPath() {
  return path.join(__dirname, "..", process.env.DEPLOYMENT_PATH || "deployments/qie-testnet.json");
}

function loadDeployment() {
  const filePath = deploymentPath();
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function deploymentAddress(deployment, ...keys) {
  for (const key of keys) {
    const value = deployment?.addresses?.[key] || deployment?.[key];
    if (value) {
      return value;
    }
  }

  return "";
}

function resolveControllerAddress(options = {}) {
  const deployment = loadDeployment();
  return options.controllerAddress
    || process.env.SPEND_CONTROLLER_ADDRESS
    || deploymentAddress(deployment, "spendController", "controller")
    || CONTROLLER_ADDRESS;
}

function resolveAgentWallet(signerAddress) {
  if (process.env.AGENT_WALLET_ADDRESS) {
    return requireAddress("AGENT_WALLET_ADDRESS", process.env.AGENT_WALLET_ADDRESS);
  }

  if (process.env.BACKEND_PRIVATE_KEY) {
    const wallet = new hre.ethers.Wallet(process.env.BACKEND_PRIVATE_KEY);
    return wallet.address;
  }

  return signerAddress;
}

async function waitForSuccess(tx, label) {
  console.log(`${label} tx submitted: ${tx.hash}`);
  const receipt = await tx.wait();

  if (!receipt || receipt.status !== 1) {
    throw new Error(`${label} failed: transaction ${tx.hash} was not successful`);
  }

  console.log(`${label} confirmed in block ${receipt.blockNumber}`);
  return receipt;
}

function findEvent(receipt, contractInterface, eventName) {
  for (const log of receipt.logs) {
    try {
      const parsed = contractInterface.parseLog(log);
      if (parsed && parsed.name === eventName) {
        return parsed;
      }
    } catch (_error) {
      // Logs from other contracts can be present in the same receipt.
    }
  }

  throw new Error(`Event ${eventName} not found in transaction ${receipt.hash}`);
}

async function getAgentIfExists(registry, agentId) {
  try {
    return await registry.getAgent(agentId);
  } catch (_error) {
    return null;
  }
}

async function ensureAgent(options = {}) {
  const controllerAddress = requireAddress("SpendController", resolveControllerAddress(options));
  const agentId = Number(options.agentId || AGENT_ID);
  const qiePassId = normalizeBytes32(options.qiePassId || process.env.BOOTSTRAP_QIE_PASS_ID || DEFAULT_QIE_PASS_ID);
  const [signer] = await hre.ethers.getSigners();

  if (!signer) {
    throw new Error("No Hardhat signer available. Check DEPLOYER_PRIVATE_KEY and network configuration.");
  }

  const signerAddress = await signer.getAddress();
  const controllerCode = await hre.ethers.provider.getCode(controllerAddress);
  if (controllerCode === "0x") {
    throw new Error(`No contract code found at SpendController address ${controllerAddress}`);
  }

  const controller = await hre.ethers.getContractAt("SpendController", controllerAddress);
  const registryAddress = await controller.registry();
  const registryCode = await hre.ethers.provider.getCode(registryAddress);
  if (registryCode === "0x") {
    throw new Error(`No contract code found at AgentRegistry address ${registryAddress}`);
  }

  const registry = await hre.ethers.getContractAt("AgentRegistry", registryAddress);
  const nextAgentId = await registry.nextAgentId();

  console.log(`AgentRegistry: ${registryAddress}`);
  console.log(`Signer owner: ${signerAddress}`);
  console.log(`Target agentId: ${agentId}`);
  console.log(`Registry nextAgentId: ${nextAgentId.toString()}`);

  let agent = await getAgentIfExists(registry, agentId);
  if (agent) {
    console.log(`Agent exists: ${agentId}`);
    if (!sameAddress(agent.owner, signerAddress)) {
      throw new Error(`Agent ${agentId} owner mismatch: expected signer ${signerAddress}, got ${agent.owner}`);
    }

    const active = await registry.isAgentActive(agentId);
    if (!active) {
      throw new Error(`Agent ${agentId} exists but is not active`);
    }

    console.log("Agent active");
    return { agentId, agent, registry, registryAddress, controller, controllerAddress, signerAddress };
  }

  if (nextAgentId !== BigInt(agentId)) {
    throw new Error(`Cannot create agentId ${agentId}; registry nextAgentId is ${nextAgentId.toString()}`);
  }

  const agentWallet = resolveAgentWallet(signerAddress);
  const existingOwnerAgentId = await registry.ownerAgentId(signerAddress);
  const existingWalletAgentId = await registry.executionWalletAgentId(agentWallet);
  const existingQiePassAgentId = await registry.qiePassAgentId(qiePassId);

  if (existingOwnerAgentId !== 0n) {
    throw new Error(`Signer ${signerAddress} already owns agentId ${existingOwnerAgentId.toString()}`);
  }
  if (existingWalletAgentId !== 0n) {
    throw new Error(`Agent wallet ${agentWallet} is already assigned to agentId ${existingWalletAgentId.toString()}`);
  }
  if (existingQiePassAgentId !== 0n) {
    throw new Error(`QIE Pass ${qiePassId} is already assigned to agentId ${existingQiePassAgentId.toString()}`);
  }

  console.log(`Agent wallet: ${agentWallet}`);
  console.log(`QIE Pass ID: ${qiePassId}`);

  const tx = await registry.registerAgent(agentWallet, qiePassId);
  const receipt = await waitForSuccess(tx, "registerAgent");
  const registered = findEvent(receipt, registry.interface, "AgentRegistered");
  const createdAgentId = Number(registered.args.agentId);

  if (createdAgentId !== agentId) {
    throw new Error(`Created unexpected agentId ${createdAgentId}; expected ${agentId}`);
  }

  agent = await registry.getAgent(agentId);
  if (!sameAddress(agent.owner, signerAddress)) {
    throw new Error(`Created agent owner mismatch: expected signer ${signerAddress}, got ${agent.owner}`);
  }

  const active = await registry.isAgentActive(agentId);
  if (!active) {
    throw new Error(`Created agent ${agentId} is not active`);
  }

  console.log("Agent created");
  console.log("Agent active");

  return { agentId, agent, registry, registryAddress, controller, controllerAddress, signerAddress };
}

async function main() {
  await ensureAgent();
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Agent creation failed");
    console.error(formatError(error));
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  AGENT_ID,
  CONTROLLER_ADDRESS,
  ensureAgent,
  formatError,
  getAgentIfExists,
  normalizeBytes32,
  sameAddress,
  waitForSuccess
};
