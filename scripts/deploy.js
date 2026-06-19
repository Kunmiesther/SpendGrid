const fs = require("fs");
const os = require("os");
const path = require("path");
const { ethers, network } = require("hardhat");

const QIE_CHAIN_ID = 1990n;
const DEPLOYMENT_NETWORK = "qie-mainnet";
const DEPLOYMENT_FILE = `deployments/${DEPLOYMENT_NETWORK}.json`;
const MAINNET_QUSDC = "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5";
const MAINNET_QIEDEX_ROUTER = "0x08cd2e72e156D8563B4351eb4065C262A9f553Ef";
const MAINNET_QIEDEX_FACTORY = "0x8E23128a5511223bE6c0d64106e2D4508C08398C";
const MAINNET_WQIE = "0x0087904D95BEe9E5F24dc8852804b547981A9139";
const WRAPPED_ETH = "0x95322ccB3fb8dDefD210805EE18662762a0bc4A2";
const WRAPPED_BNB = "0x9e02ba5dE6d26D5Ca5688Ed3999C6bcF4F3e966E";
const WRAPPED_USDC = "0x0e93FAcc0a2cfD418403f3AD3EEfB5C8b2dfAec7";
const WRAPPED_USDT = "0xCB7bBC584475dce754a918ccD92FF6E0211f3CEE";

function isMockQusdcMode() {
  return String(process.env.QUSDC_MODE || "").trim().toLowerCase() === "mock";
}

function assertAddress(label, value) {
  if (!ethers.isAddress(value)) {
    throw new Error(`${label} is not a valid EVM address: ${value}`);
  }
}

function sameAddress(left, right) {
  return left.toLowerCase() === right.toLowerCase();
}

async function assertContract(label, address) {
  assertAddress(label, address);
  const code = await ethers.provider.getCode(address);
  if (!code || code === "0x") {
    throw new Error(`${label} has no contract code at ${address}`);
  }
}

async function deployContract(contractName, args = []) {
  const factory = await ethers.getContractFactory(contractName);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

function writeDeploymentFile(deployment) {
  const deploymentPath = path.join(__dirname, "..", DEPLOYMENT_FILE);
  const deploymentsDir = path.dirname(deploymentPath);

  fs.mkdirSync(deploymentsDir, { recursive: true });
  fs.writeFileSync(deploymentPath, `${JSON.stringify(deployment, null, 2)}${os.EOL}`);

  return deploymentPath;
}

function writeFrontendDeploymentFile(deployment) {
  const frontendPublicDir = path.join(__dirname, "..", "frontend", "public");
  if (!fs.existsSync(frontendPublicDir)) {
    return null;
  }

  const frontendDeploymentsDir = path.join(frontendPublicDir, "deployments");
  const frontendDeploymentPath = path.join(frontendDeploymentsDir, `${DEPLOYMENT_NETWORK}.json`);

  fs.mkdirSync(frontendDeploymentsDir, { recursive: true });
  fs.writeFileSync(frontendDeploymentPath, `${JSON.stringify(deployment, null, 2)}${os.EOL}`);

  return frontendDeploymentPath;
}

function upsertEnvFile(values) {
  if (process.env.SPENDGRID_UPDATE_ENV === "false") {
    return null;
  }

  const envPath = path.join(__dirname, "..", ".env");
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const lines = existing.length > 0 ? existing.split(/\r?\n/) : [];
  const seen = new Set();
  const nextLines = lines.map((line) => {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
    if (!match || !Object.prototype.hasOwnProperty.call(values, match[1])) {
      return line;
    }

    const key = match[1];
    seen.add(key);
    return `${key}=${values[key]}`;
  });

  for (const [key, value] of Object.entries(values)) {
    if (!seen.has(key)) {
      nextLines.push(`${key}=${value}`);
    }
  }

  while (nextLines.length > 0 && nextLines[nextLines.length - 1] === "") {
    nextLines.pop();
  }

  fs.writeFileSync(envPath, `${nextLines.join(os.EOL)}${os.EOL}`);
  return envPath;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const chain = await ethers.provider.getNetwork();

  if (!deployer) {
    throw new Error("No deployer signer available. Set DEPLOYER_PRIVATE_KEY in .env before deploying to QIE Mainnet.");
  }

  if (chain.chainId !== QIE_CHAIN_ID) {
    throw new Error(`Expected QIE chain ID ${QIE_CHAIN_ID.toString()}, received ${chain.chainId.toString()}`);
  }

  const deployerAddress = await deployer.getAddress();

  console.log(`Deploying SpendGrid Protocol to ${DEPLOYMENT_NETWORK} via Hardhat network ${network.name}`);
  console.log(`Chain ID: ${chain.chainId.toString()}`);
  console.log(`Deployer: ${deployerAddress}`);

  const useMockQusdc = isMockQusdcMode();
  let stableAddress = process.env.QUSDC_ADDRESS || process.env.QIE_STABLECOIN_ADDRESS || MAINNET_QUSDC;
  if (useMockQusdc) {
    const stable = await deployContract("MockQUSDC");
    stableAddress = await stable.getAddress();
    assertAddress("MockQUSDC", stableAddress);
    console.log(`MockQUSDC deployed at: ${stableAddress}`);
  } else {
    stableAddress = ethers.getAddress(stableAddress);
    await assertContract("QUSDC", stableAddress);
    console.log(`Using QUSDC at: ${stableAddress}`);
  }

  const registry = await deployContract("AgentRegistry");
  const registryAddress = await registry.getAddress();
  assertAddress("AgentRegistry", registryAddress);
  console.log(`AgentRegistry deployed at: ${registryAddress}`);

  const controller = await deployContract("SpendController", [registryAddress]);
  const controllerAddress = await controller.getAddress();
  assertAddress("SpendController", controllerAddress);
  console.log(`SpendController deployed at: ${controllerAddress}`);

  const vault = await deployContract("StreamVault", [stableAddress, controllerAddress, registryAddress]);
  const vaultAddress = await vault.getAddress();
  assertAddress("StreamVault", vaultAddress);
  console.log(`StreamVault deployed at: ${vaultAddress}`);

  const wiredRegistry = await controller.registry();
  const wiredToken = await vault.qieStablecoin();
  const wiredController = await vault.spendController();
  const wiredVaultRegistry = await vault.registry();

  if (!sameAddress(wiredRegistry, registryAddress)) {
    throw new Error(`SpendController registry mismatch: expected ${registryAddress}, got ${wiredRegistry}`);
  }
  if (!sameAddress(wiredToken, stableAddress)) {
    throw new Error(`StreamVault token mismatch: expected ${stableAddress}, got ${wiredToken}`);
  }
  if (!sameAddress(wiredController, controllerAddress)) {
    throw new Error(`StreamVault controller mismatch: expected ${controllerAddress}, got ${wiredController}`);
  }
  if (!sameAddress(wiredVaultRegistry, registryAddress)) {
    throw new Error(`StreamVault registry mismatch: expected ${registryAddress}, got ${wiredVaultRegistry}`);
  }

  const deployment = {
    stable: stableAddress,
    qusdc: stableAddress,
    mockQUSDC: useMockQusdc ? stableAddress : undefined,
    registry: registryAddress,
    controller: controllerAddress,
    vault: vaultAddress,
    addresses: {
      mockQUSDC: useMockQusdc ? stableAddress : undefined,
      qusdc: stableAddress,
      agentRegistry: registryAddress,
      spendController: controllerAddress,
      streamVault: vaultAddress,
      qiedexFactory: MAINNET_QIEDEX_FACTORY,
      qiedexRouter: MAINNET_QIEDEX_ROUTER,
      wqie: MAINNET_WQIE,
      wrappedETH: WRAPPED_ETH,
      wrappedBNB: WRAPPED_BNB,
      wrappedUSDC: WRAPPED_USDC,
      wrappedUSDT: WRAPPED_USDT
    },
    network: DEPLOYMENT_NETWORK,
    chainId: Number(chain.chainId),
    hardhatNetwork: network.name,
    deployer: deployerAddress,
    deployedAt: new Date().toISOString(),
    qieStablecoin: stableAddress,
    agentRegistry: registryAddress,
    spendController: controllerAddress,
    streamVault: vaultAddress,
    qiedexFactory: MAINNET_QIEDEX_FACTORY,
    qiedexRouter: MAINNET_QIEDEX_ROUTER,
    wqie: MAINNET_WQIE,
    wrappedETH: WRAPPED_ETH,
    wrappedBNB: WRAPPED_BNB,
    wrappedUSDC: WRAPPED_USDC,
    wrappedUSDT: WRAPPED_USDT
  };

  const deploymentPath = writeDeploymentFile(deployment);
  const frontendDeploymentPath = writeFrontendDeploymentFile(deployment);
  const envValues = {
    QIE_STABLECOIN_ADDRESS: stableAddress,
    QUSDC_ADDRESS: stableAddress,
    AGENT_REGISTRY_ADDRESS: registryAddress,
    SPEND_CONTROLLER_ADDRESS: controllerAddress,
    STREAM_VAULT_ADDRESS: vaultAddress,
    QIEDEX_FACTORY_ADDRESS: MAINNET_QIEDEX_FACTORY,
    QIEDEX_ROUTER_ADDRESS: MAINNET_QIEDEX_ROUTER,
    WQIE_ADDRESS: MAINNET_WQIE,
    WRAPPED_ETH_ADDRESS: WRAPPED_ETH,
    WRAPPED_BNB_ADDRESS: WRAPPED_BNB,
    WRAPPED_USDC_ADDRESS: WRAPPED_USDC,
    WRAPPED_USDT_ADDRESS: WRAPPED_USDT,
    DEPLOYMENT_PATH: DEPLOYMENT_FILE
  };
  if (useMockQusdc) {
    envValues.QUSDC_MODE = "mock";
    envValues.MOCK_QUSDC_ADDRESS = stableAddress;
  }
  const envPath = upsertEnvFile(envValues);

  console.log(`Deployment file written to: ${deploymentPath}`);
  if (frontendDeploymentPath) {
    console.log(`Frontend deployment file written to: ${frontendDeploymentPath}`);
  }
  if (envPath) {
    console.log(`Environment file updated at: ${envPath}`);
  }
  console.log("Deployment summary:");
  console.log(JSON.stringify(deployment, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
