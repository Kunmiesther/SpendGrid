const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const { loadEnv } = require("./env");
const { isMockQusdcMode } = require("./qusdcMode");

loadEnv();

const CHAIN_ID = 1990;
const NETWORK_NAME = "qie-mainnet";
const PROJECT_ROOT = path.join(__dirname, "..", "..");
const DEPLOYMENT_PUBLIC_PATH = "/deployments/qie-mainnet.json";
const DEPLOYMENT_FILE = path.join(PROJECT_ROOT, process.env.DEPLOYMENT_PATH || "deployments/qie-mainnet.json");

const ZERO_ADDRESS = ethers.ZeroAddress.toLowerCase();

function normalizeDeploymentAddress(label, value) {
  if (!value || !ethers.isAddress(value) || value.toLowerCase() === ZERO_ADDRESS) {
    throw new Error(`${label} is missing or invalid in ${DEPLOYMENT_PUBLIC_PATH}`);
  }

  return ethers.getAddress(value);
}

function resolveQusdcAddress(deployment) {
  if (isMockQusdcMode()) {
    return process.env.MOCK_QUSDC_ADDRESS
      || deployment.addresses?.mockQUSDC
      || deployment.addresses?.mockQusdc
      || deployment.mockQUSDC
      || deployment.mockQusdc
      || process.env.QUSDC_ADDRESS
      || deployment.addresses?.qusdc
      || deployment.qusdc;
  }

  const canonical = process.env.QUSDC_ADDRESS
    || deployment.addresses?.qusdc
    || deployment.qieStablecoin
    || deployment.stable
    || deployment.qusdc
    || deployment.addresses?.mockQIEStable;

  return canonical;
}

function loadDeployment() {
  if (!fs.existsSync(DEPLOYMENT_FILE)) {
    throw new Error(`Missing deployment artifact at ${DEPLOYMENT_PUBLIC_PATH}`);
  }

  const deployment = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf8"));
  if (Number(deployment.chainId) !== CHAIN_ID) {
    throw new Error(`Deployment artifact must target QIE Mainnet chain ID ${CHAIN_ID}`);
  }

  return {
    ...deployment,
    network: deployment.network || NETWORK_NAME,
    chainId: CHAIN_ID,
    path: DEPLOYMENT_FILE,
    publicPath: DEPLOYMENT_PUBLIC_PATH,
    addresses: {
      qiedexRouter: normalizeDeploymentAddress(
        "QIEDEX Router",
        process.env.QIEDEX_ROUTER_ADDRESS || deployment.addresses?.qiedexRouter || deployment.qiedexRouter
      ),
      qiedexFactory: normalizeDeploymentAddress(
        "QIEDEX Factory",
        process.env.QIEDEX_FACTORY_ADDRESS || deployment.addresses?.qiedexFactory || deployment.qiedexFactory
      ),
      wqie: normalizeDeploymentAddress(
        "WQIE",
        process.env.WQIE_ADDRESS || deployment.addresses?.wqie || deployment.wqie
      ),
      qusdc: normalizeDeploymentAddress(
        "QUSDC",
        resolveQusdcAddress(deployment)
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
