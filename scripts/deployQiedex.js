const fs = require("fs");
const os = require("os");
const path = require("path");
const hre = require("hardhat");

const QIE_CHAIN_ID = 1990n;
const DEPLOYMENT_NETWORK = "qie-mainnet";
const DEPLOYMENT_FILE = `deployments/${DEPLOYMENT_NETWORK}.json`;
const FRONTEND_DEPLOYMENT_FILE = path.join("frontend", "public", "deployments", `${DEPLOYMENT_NETWORK}.json`);

const MAINNET_QUSDC = "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5";
const MAINNET_QIEDEX_ROUTER = "0x08cd2e72e156D8563B4351eb4065C262A9f553Ef";
const MAINNET_QIEDEX_FACTORY = "0x8E23128a5511223bE6c0d64106e2D4508C08398C";
const MAINNET_WQIE = "0x0087904D95BEe9E5F24dc8852804b547981A9139";
const WRAPPED_ETH = "0x95322ccB3fb8dDefD210805EE18662762a0bc4A2";
const WRAPPED_BNB = "0x9e02ba5dE6d26D5Ca5688Ed3999C6bcF4F3e966E";
const WRAPPED_USDC = "0x0e93FAcc0a2cfD418403f3AD3EEfB5C8b2dfAec7";
const WRAPPED_USDT = "0xCB7bBC584475dce754a918ccD92FF6E0211f3CEE";

const ROUTER_ABI = [
  "function factory() external view returns (address)",
  "function WETH() external view returns (address)"
];

const FACTORY_ABI = [
  "function getPair(address tokenA,address tokenB) external view returns (address)"
];

function deploymentPath() {
  return path.join(__dirname, "..", process.env.DEPLOYMENT_PATH || DEPLOYMENT_FILE);
}

function frontendDeploymentPath() {
  return path.join(__dirname, "..", FRONTEND_DEPLOYMENT_FILE);
}

function loadDeployment() {
  const filePath = deploymentPath();
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing deployment artifact at ${filePath}. Deploy SpendGrid first with npm run deploy:qie.`);
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}${os.EOL}`);
  return filePath;
}

function upsertEnv(values) {
  if (process.env.SPENDGRID_UPDATE_ENV === "false") {
    return null;
  }

  const envPath = path.join(__dirname, "..", ".env");
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const lines = existing ? existing.split(/\r?\n/) : [];
  const seen = new Set();
  const next = lines.map((line) => {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
    if (!match || !Object.prototype.hasOwnProperty.call(values, match[1])) return line;
    seen.add(match[1]);
    return `${match[1]}=${values[match[1]]}`;
  });

  for (const [key, value] of Object.entries(values)) {
    if (!seen.has(key)) next.push(`${key}=${value}`);
  }
  while (next.length && next[next.length - 1] === "") next.pop();

  fs.writeFileSync(envPath, `${next.join(os.EOL)}${os.EOL}`);
  return envPath;
}

function requireAddress(label, value) {
  if (!hre.ethers.isAddress(value)) {
    throw new Error(`${label} is not a valid address: ${value}`);
  }

  return hre.ethers.getAddress(value);
}

async function assertContract(label, value) {
  const address = requireAddress(label, value);
  const code = await hre.ethers.provider.getCode(address);
  if (!code || code === "0x") {
    throw new Error(`${label} has no contract code at ${address}`);
  }

  return address;
}

function sameAddress(left, right) {
  return hre.ethers.getAddress(left) === hre.ethers.getAddress(right);
}

async function main() {
  const network = await hre.ethers.provider.getNetwork();
  if (network.chainId !== QIE_CHAIN_ID) {
    throw new Error(`Expected QIE Mainnet chain ID ${QIE_CHAIN_ID.toString()}, got ${network.chainId.toString()}`);
  }

  const deployment = loadDeployment();
  const qusdcAddress = await assertContract(
    "QUSDC",
    process.env.QUSDC_ADDRESS || deployment.addresses?.qusdc || deployment.qusdc || MAINNET_QUSDC
  );
  const wqieAddress = await assertContract(
    "WQIE",
    process.env.WQIE_ADDRESS || deployment.addresses?.wqie || deployment.wqie || MAINNET_WQIE
  );
  const factoryAddress = await assertContract(
    "QIEDex Factory",
    process.env.QIEDEX_FACTORY_ADDRESS || deployment.addresses?.qiedexFactory || deployment.qiedexFactory || MAINNET_QIEDEX_FACTORY
  );
  const routerAddress = await assertContract(
    "QIEDex Router",
    process.env.QIEDEX_ROUTER_ADDRESS || deployment.addresses?.qiedexRouter || deployment.qiedexRouter || MAINNET_QIEDEX_ROUTER
  );

  const router = new hre.ethers.Contract(routerAddress, ROUTER_ABI, hre.ethers.provider);
  const factory = new hre.ethers.Contract(factoryAddress, FACTORY_ABI, hre.ethers.provider);
  const routerFactory = await router.factory();
  const routerWqie = await router.WETH();
  if (!sameAddress(routerFactory, factoryAddress)) {
    throw new Error(`Router factory mismatch: expected ${factoryAddress}, got ${routerFactory}`);
  }
  if (!sameAddress(routerWqie, wqieAddress)) {
    throw new Error(`Router WQIE mismatch: expected ${wqieAddress}, got ${routerWqie}`);
  }

  const pairAddress = await factory.getPair(wqieAddress, qusdcAddress).catch(() => hre.ethers.ZeroAddress);
  const hasPair = hre.ethers.isAddress(pairAddress) && !sameAddress(pairAddress, hre.ethers.ZeroAddress)
    && await hre.ethers.provider.getCode(pairAddress) !== "0x";

  const nextDeployment = {
    ...deployment,
    stable: qusdcAddress,
    qusdc: qusdcAddress,
    qieStablecoin: qusdcAddress,
    addresses: {
      ...(deployment.addresses || {}),
      qiedexFactory: factoryAddress,
      qiedexRouter: routerAddress,
      qiedexPair: hasPair ? hre.ethers.getAddress(pairAddress) : undefined,
      wqie: wqieAddress,
      qusdc: qusdcAddress,
      wrappedETH: WRAPPED_ETH,
      wrappedBNB: WRAPPED_BNB,
      wrappedUSDC: WRAPPED_USDC,
      wrappedUSDT: WRAPPED_USDT
    },
    qiedexFactory: factoryAddress,
    qiedexRouter: routerAddress,
    qiedexPair: hasPair ? hre.ethers.getAddress(pairAddress) : undefined,
    wqie: wqieAddress,
    wrappedETH: WRAPPED_ETH,
    wrappedBNB: WRAPPED_BNB,
    wrappedUSDC: WRAPPED_USDC,
    wrappedUSDT: WRAPPED_USDT,
    qiedexConfiguredAt: new Date().toISOString()
  };

  const deploymentFile = writeJson(deploymentPath(), nextDeployment);
  const frontendFile = writeJson(frontendDeploymentPath(), nextDeployment);
  const envFile = upsertEnv({
    QIEDEX_FACTORY_ADDRESS: factoryAddress,
    QIEDEX_ROUTER_ADDRESS: routerAddress,
    WQIE_ADDRESS: wqieAddress,
    QUSDC_ADDRESS: qusdcAddress,
    WRAPPED_ETH_ADDRESS: WRAPPED_ETH,
    WRAPPED_BNB_ADDRESS: WRAPPED_BNB,
    WRAPPED_USDC_ADDRESS: WRAPPED_USDC,
    WRAPPED_USDT_ADDRESS: WRAPPED_USDT
  });

  console.log("QIEDex mainnet configuration verified");
  console.log(JSON.stringify({
    qiedexFactory: factoryAddress,
    qiedexRouter: routerAddress,
    qiedexPair: hasPair ? hre.ethers.getAddress(pairAddress) : null,
    wqie: wqieAddress,
    qusdc: qusdcAddress,
    deploymentFile,
    frontendFile,
    envFile
  }, null, 2));
}

main().catch((error) => {
  console.error("QIEDex mainnet configuration failed");
  console.error(error.shortMessage || error.reason || error.message || String(error));
  console.error(error);
  process.exitCode = 1;
});
