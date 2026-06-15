const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const { loadEnv } = require("./env");

loadEnv();

const CHAIN_ID = 1983;
const NETWORK_NAME = "qie-testnet";
const PROJECT_ROOT = path.join(__dirname, "..", "..");
const DEPLOYMENT_PUBLIC_PATH = "/deployments/qie-testnet.json";
const DEPLOYMENT_FILE = path.join(PROJECT_ROOT, "deployments", "qie-testnet.json");

const ZERO_ADDRESS = ethers.ZeroAddress.toLowerCase();

const QIEDEX_ROUTER_ADDRESS = "0x08cd2e72e156D8563B4351eb4065C262A9f553Ef";
const QIEDEX_FACTORY_ADDRESS = "0x8E23128a5511223bE6c0d64106e2D4508C08398C";
const WQIE_ADDRESS = "0x0087904D95BEe9E5F24dc8852804b547981A9139";

function normalizeDeploymentAddress(label, value) {
  if (!value || !ethers.isAddress(value) || value.toLowerCase() === ZERO_ADDRESS) {
    throw new Error(`${label} is missing or invalid in ${DEPLOYMENT_PUBLIC_PATH}`);
  }

  return ethers.getAddress(value);
}

function resolveQusdcAddress(deployment) {
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
    throw new Error(`Deployment artifact must target QIE Testnet chain ID ${CHAIN_ID}`);
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
        process.env.QIEDEX_ROUTER_ADDRESS || deployment.addresses?.qiedexRouter || deployment.qiedexRouter || QIEDEX_ROUTER_ADDRESS
      ),
      qiedexFactory: normalizeDeploymentAddress(
        "QIEDEX Factory",
        process.env.QIEDEX_FACTORY_ADDRESS || deployment.addresses?.qiedexFactory || deployment.qiedexFactory || QIEDEX_FACTORY_ADDRESS
      ),
      wqie: normalizeDeploymentAddress(
        "WQIE",
        process.env.WQIE_ADDRESS || deployment.addresses?.wqie || deployment.wqie || WQIE_ADDRESS
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
