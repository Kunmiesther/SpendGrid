const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { ensureAgent, getAgentIfExists } = require("./createAgent");

const AGENT_ID = Number(process.env.AGENT_ID || "1");
const DAILY_LIMIT = process.env.DEFAULT_DAILY_LIMIT || "100000000000000000000";

function sameAddress(left, right) {
  return left.toLowerCase() === right.toLowerCase();
}

function deploymentPath() {
  return path.join(__dirname, "..", process.env.DEPLOYMENT_PATH || "deployments/qie-testnet.json");
}

function loadDeployment() {
  const filePath = deploymentPath();
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing deployment artifact at ${filePath}`);
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

function resolveWriteMethod(contract, operationName, fallbackName) {
  if (typeof contract[operationName] === "function") {
    return contract[operationName].bind(contract);
  }

  if (typeof contract[fallbackName] === "function") {
    console.log(`${operationName}: using deployed ABI method ${fallbackName}`);
    return contract[fallbackName].bind(contract);
  }

  throw new Error(`SpendController ABI is missing ${operationName} and fallback ${fallbackName}`);
}

async function setServiceWhitelisted(controller, agentId, service, allowed) {
  const method = resolveWriteMethod(controller, "setServiceWhitelisted", "setServiceWhitelist");
  return method(agentId, service, allowed);
}

async function setDailyLimit(controller, agentId, dailyLimit) {
  const method = resolveWriteMethod(controller, "setDailyLimit", "setBudget");
  return method(agentId, dailyLimit);
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

function requireAddress(label, value) {
  if (!hre.ethers.isAddress(value)) {
    throw new Error(`${label} is not a valid address: ${value}`);
  }

  return hre.ethers.getAddress(value);
}

async function main() {
  const deployment = loadDeployment();
  const controllerAddress = requireAddress(
    "SpendController",
    process.env.SPEND_CONTROLLER_ADDRESS || deploymentAddress(deployment, "spendController", "controller")
  );
  const vaultAddress = requireAddress(
    "StreamVault",
    process.env.STREAM_VAULT_ADDRESS || deploymentAddress(deployment, "streamVault", "vault")
  );
  const controller = await hre.ethers.getContractAt("SpendController", controllerAddress);
  const [signer] = await hre.ethers.getSigners();

  if (!signer) {
    throw new Error("No Hardhat signer available. Check DEPLOYER_PRIVATE_KEY and network configuration.");
  }

  const signerAddress = await signer.getAddress();
  const controllerCode = await hre.ethers.provider.getCode(controllerAddress);
  if (controllerCode === "0x") {
    throw new Error(`No contract code found at SpendController address ${controllerAddress}`);
  }

  const vaultCode = await hre.ethers.provider.getCode(vaultAddress);
  if (vaultCode === "0x") {
    throw new Error(`No contract code found at StreamVault address ${vaultAddress}`);
  }

  const registryAddress = await controller.registry();
  const registry = await hre.ethers.getContractAt("AgentRegistry", registryAddress);
  const controllerOwner = await controller.owner();
  const nextAgentId = await registry.nextAgentId();

  console.log(`Network: ${hre.network.name}`);
  console.log(`Signer: ${signerAddress}`);
  console.log(`SpendController: ${controllerAddress}`);
  console.log(`AgentRegistry: ${registryAddress}`);
  console.log(`SpendController owner: ${controllerOwner}`);
  console.log(`Registry nextAgentId: ${nextAgentId.toString()}`);
  console.log(`agentId: ${AGENT_ID}`);
  console.log(`vault: ${vaultAddress}`);
  console.log(`dailyLimit: ${DAILY_LIMIT}`);

  let agent = await getAgentIfExists(registry, AGENT_ID);
  if (!agent) {
    console.log(`Agent ${AGENT_ID} does not exist; creating agent before SpendController bootstrap`);
    const created = await ensureAgent({ controllerAddress, agentId: AGENT_ID });
    agent = created.agent;
    console.log("Bootstrap continuing");
  }

  console.log(`Agent owner: ${agent.owner}`);
  console.log(`Agent wallet: ${agent.agentWallet}`);

  const agentActive = await registry.isAgentActive(AGENT_ID);
  const authorized = sameAddress(signerAddress, controllerOwner) || sameAddress(signerAddress, agent.owner);
  console.log(`Agent active: ${agentActive}`);

  if (!authorized) {
    throw new Error(
      `Signer ${signerAddress} is not authorized for agentId ${AGENT_ID}. Expected controller owner ${controllerOwner} or agent owner ${agent.owner}.`
    );
  }

  if (!agentActive) {
    throw new Error(`Agent ${AGENT_ID} is not active in AgentRegistry ${registryAddress}`);
  }

  const whitelistTx = await setServiceWhitelisted(controller, AGENT_ID, vaultAddress, true);
  await waitForSuccess(whitelistTx, "setServiceWhitelisted");

  const whitelisted = await controller.isServiceWhitelisted(AGENT_ID, vaultAddress);
  if (!whitelisted) {
    throw new Error(`Vault ${vaultAddress} is still not whitelisted for agentId ${AGENT_ID}`);
  }
  console.log(`setServiceWhitelisted succeeded: vault ${vaultAddress} is whitelisted for agentId ${AGENT_ID}`);

  const limitTx = await setDailyLimit(controller, AGENT_ID, DAILY_LIMIT);
  await waitForSuccess(limitTx, "setDailyLimit");

  const budget = await controller.getBudget(AGENT_ID);
  const currentDailyLimit = budget.dailyLimit.toString();
  if (currentDailyLimit !== DAILY_LIMIT) {
    throw new Error(`Daily limit mismatch for agentId ${AGENT_ID}: expected ${DAILY_LIMIT}, got ${currentDailyLimit}`);
  }
  console.log(`setDailyLimit succeeded: dailyLimit for agentId ${AGENT_ID} is ${currentDailyLimit}`);

  console.log("SpendGrid bootstrap complete");
}

main().catch((error) => {
  console.error("SpendGrid bootstrap failed");
  console.error(error.shortMessage || error.reason || error.message || String(error));
  console.error(error);
  process.exitCode = 1;
});
