const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const CHAIN_ID = 1983;
const NETWORK_NAME = "qie-testnet";
const PROJECT_ROOT = path.join(__dirname, "..", "..");
const DEPLOYMENT_PUBLIC_PATH = "/deployments/qie-testnet.json";
const DEPLOYMENT_FILE = path.join(PROJECT_ROOT, "deployments", "qie-testnet.json");

const ZERO_ADDRESS = ethers.ZeroAddress.toLowerCase();

function normalizeDeploymentAddress(label, value) {
  if (!value || !ethers.isAddress(value) || value.toLowerCase() === ZERO_ADDRESS) {
    throw new Error(`${label} is missing or invalid in ${DEPLOYMENT_PUBLIC_PATH}`);
  }

  return ethers.getAddress(value);
}

function loadDeployment() {
  if (!fs.existsSync(DEPLOYMENT_FILE)) {
    throw new Error(`Missing deployment artifact at ${DEPLOYMENT_PUBLIC_PATH}`);
  }

  const deployment = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf8"));
  if (Number(deployment.chainId) !== CHAIN_ID) {
    throw new Error(`Deployment artifact must target QIE Testnet chain ID ${CHAIN_ID}`);
  }

  return {
    ...deployment,
    network: deployment.network || NETWORK_NAME,
    chainId: CHAIN_ID,
    path: DEPLOYMENT_FILE,
    publicPath: DEPLOYMENT_PUBLIC_PATH,
    addresses: {
      mockQIEStable: normalizeDeploymentAddress(
        "MockQIEStable",
        deployment.addresses?.mockQIEStable || deployment.qieStablecoin || deployment.stable
      ),
      agentRegistry: normalizeDeploymentAddress(
        "AgentRegistry",
        deployment.addresses?.agentRegistry || deployment.agentRegistry || deployment.registry
      ),
      spendController: normalizeDeploymentAddress(
        "SpendController",
        deployment.addresses?.spendController || deployment.spendController || deployment.controller
      ),
      streamVault: normalizeDeploymentAddress(
        "StreamVault",
        deployment.addresses?.streamVault || deployment.streamVault || deployment.vault
      )
    }
  };
}

function loadArtifact(contractName) {
  const artifactPath = path.join(
    PROJECT_ROOT,
    "artifacts",
    "contracts",
    `${contractName}.sol`,
    `${contractName}.json`
  );

  if (!fs.existsSync(artifactPath)) {
    throw new Error(`Missing ${contractName} artifact. Run npm run compile first.`);
  }

  return JSON.parse(fs.readFileSync(artifactPath, "utf8"));
}

module.exports = {
  CHAIN_ID,
  DEPLOYMENT_FILE,
  DEPLOYMENT_PUBLIC_PATH,
  NETWORK_NAME,
  PROJECT_ROOT,
  loadArtifact,
  loadDeployment
};
