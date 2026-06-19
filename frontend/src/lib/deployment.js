import { ethers } from "ethers";

export const QIE_MAINNET_CHAIN_ID = 1990;
export const DEPLOYMENT_URL = process.env.REACT_APP_DEPLOYMENT_URL || "/deployments/qie-mainnet.json";

const ZERO_ADDRESS = ethers.ZeroAddress.toLowerCase();

function normalizeAddress(label, value) {
  if (!value || !ethers.isAddress(value) || value.toLowerCase() === ZERO_ADDRESS) {
    throw new Error(`${label} is missing from the SpendGrid deployment artifact`);
  }

  return ethers.getAddress(value);
}

export function normalizeDeployment(deployment) {
  if (!deployment || Number(deployment.chainId) !== QIE_MAINNET_CHAIN_ID) {
    throw new Error(`SpendGrid deployment artifact must target chain ID ${QIE_MAINNET_CHAIN_ID}`);
  }

  return {
    ...deployment,
    chainId: Number(deployment.chainId),
    addresses: {
      qusdc: normalizeAddress(
        "QUSDC",
        deployment.addresses?.qusdc || deployment.qieStablecoin || deployment.stable || deployment.qusdc
      ),
      agentRegistry: normalizeAddress(
        "AgentRegistry",
        deployment.addresses?.agentRegistry || deployment.agentRegistry || deployment.registry
      ),
      spendController: normalizeAddress(
        "SpendController",
        deployment.addresses?.spendController || deployment.spendController || deployment.controller
      ),
      streamVault: normalizeAddress(
        "StreamVault",
        deployment.addresses?.streamVault || deployment.streamVault || deployment.vault
      ),
      qiedexFactory: normalizeAddress(
        "QIEDex Factory",
        deployment.addresses?.qiedexFactory || deployment.qiedexFactory
      ),
      qiedexRouter: normalizeAddress(
        "QIEDex Router",
        deployment.addresses?.qiedexRouter || deployment.qiedexRouter
      ),
      wqie: normalizeAddress(
        "WQIE",
        deployment.addresses?.wqie || deployment.wqie
      )
    }
  };
}

export async function loadDeployment(url = DEPLOYMENT_URL) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Unable to load SpendGrid deployment artifact from ${url}`);
  }

  return normalizeDeployment(await response.json());
}
