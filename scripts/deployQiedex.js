const fs = require("fs");
const os = require("os");
const path = require("path");
const hre = require("hardhat");

const DEPLOYMENT_NETWORK = "qie-testnet";
const DEPLOYMENT_FILE = `deployments/${DEPLOYMENT_NETWORK}.json`;
const DEFAULT_WQIE_LIQUIDITY = "1";
const DEFAULT_QUSDC_LIQUIDITY = "1000";
const GAS_HEADROOM_WEI = hre.ethers.parseEther("0.05");

function deploymentPath() {
  return path.join(__dirname, "..", process.env.DEPLOYMENT_PATH || DEPLOYMENT_FILE);
}

function loadDeployment() {
  const filePath = deploymentPath();
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing deployment artifact at ${filePath}. Deploy SpendGrid first with npm run deploy:qie.`);
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeDeployment(deployment) {
  const filePath = deploymentPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(deployment, null, 2)}${os.EOL}`);
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

async function deployContract(name, args = []) {
  const factory = await hre.ethers.getContractFactory(name);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

async function assertContract(label, address) {
  if (!hre.ethers.isAddress(address)) {
    throw new Error(`${label} is not a valid address: ${address}`);
  }
  const code = await hre.ethers.provider.getCode(address);
  if (!code || code === "0x") {
    throw new Error(`${label} has no contract code at ${address}`);
  }
}

async function ensureTokenBalance(token, owner, amount, label) {
  const balance = BigInt(await token.balanceOf(owner));
  if (balance >= amount) return;

  const missing = amount - balance;
  if (typeof token.mint === "function") {
    const tx = await token.mint(owner, missing);
    await tx.wait();
    return;
  }
  if (typeof token.faucet === "function") {
    const tx = await token.faucet(owner, missing);
    await tx.wait();
    return;
  }

  throw new Error(`${label} balance ${balance.toString()} is below required ${amount.toString()} and token has no mint/faucet`);
}

async function approveIfNeeded(token, owner, spender, amount, label) {
  const allowance = BigInt(await token.allowance(owner, spender));
  if (allowance >= amount) return;

  const tx = await token.approve(spender, amount);
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) {
    throw new Error(`${label} approval failed for spender ${spender}`);
  }
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) {
    throw new Error("No deployer signer available. Set DEPLOYER_PRIVATE_KEY before deploying QIEDex.");
  }

  const network = await hre.ethers.provider.getNetwork();
  if (network.chainId !== 1983n) {
    throw new Error(`Expected QIE testnet chain ID 1983, got ${network.chainId.toString()}`);
  }

  const deployment = loadDeployment();
  const deployerAddress = await deployer.getAddress();
  const qusdcAddress = deployment.addresses?.qusdc || deployment.qusdc || deployment.qieStablecoin || deployment.stable;
  if (!hre.ethers.isAddress(qusdcAddress)) {
    throw new Error("Deployment does not contain a valid QUSDC address");
  }

  const existingWqie = process.env.WQIE_ADDRESS || deployment.addresses?.wqie || deployment.wqie;
  let wqie;
  if (existingWqie && hre.ethers.isAddress(existingWqie) && await hre.ethers.provider.getCode(existingWqie) !== "0x") {
    wqie = await hre.ethers.getContractAt("WQIE", existingWqie);
  } else {
    wqie = await deployContract("WQIE");
  }
  const wqieAddress = await wqie.getAddress();

  const factory = await deployContract("QIEDexFactory", [deployerAddress]);
  const factoryAddress = await factory.getAddress();
  const router = await deployContract("QIEDexRouter", [factoryAddress, wqieAddress]);
  const routerAddress = await router.getAddress();

  await assertContract("QUSDC", qusdcAddress);
  await assertContract("WQIE", wqieAddress);
  await assertContract("QIEDexFactory", factoryAddress);
  await assertContract("QIEDexRouter", routerAddress);

  const qusdc = await hre.ethers.getContractAt("MockQIEStable", qusdcAddress);
  const wqieAmount = hre.ethers.parseUnits(process.env.QIEDEX_WQIE_LIQUIDITY || DEFAULT_WQIE_LIQUIDITY, 18);
  const qusdcAmount = hre.ethers.parseUnits(process.env.QIEDEX_QUSDC_LIQUIDITY || DEFAULT_QUSDC_LIQUIDITY, 18);
  const nativeBalance = BigInt(await hre.ethers.provider.getBalance(deployerAddress));

  const wqieBalance = BigInt(await wqie.balanceOf(deployerAddress));
  if (wqieBalance < wqieAmount) {
    const wrapAmount = wqieAmount - wqieBalance;
    if (nativeBalance <= wrapAmount + GAS_HEADROOM_WEI) {
      throw new Error(
        `Insufficient native QIE for WQIE seed. Need ${hre.ethers.formatEther(wrapAmount + GAS_HEADROOM_WEI)} QIE including gas headroom, have ${hre.ethers.formatEther(nativeBalance)} QIE. Set QIEDEX_WQIE_LIQUIDITY lower or fund deployer.`
      );
    }
    const tx = await wqie.deposit({ value: wrapAmount });
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) {
      throw new Error("WQIE deposit failed");
    }
  }
  await ensureTokenBalance(qusdc, deployerAddress, qusdcAmount, "QUSDC");

  await approveIfNeeded(wqie, deployerAddress, routerAddress, wqieAmount, "WQIE");
  await approveIfNeeded(qusdc, deployerAddress, routerAddress, qusdcAmount, "QUSDC");

  const deadline = Math.floor(Date.now() / 1000) + 600;
  const addLiquidityTx = await router.addLiquidity(
    wqieAddress,
    qusdcAddress,
    wqieAmount,
    qusdcAmount,
    1,
    1,
    deployerAddress,
    deadline
  );
  const addLiquidityReceipt = await addLiquidityTx.wait();
  if (!addLiquidityReceipt || addLiquidityReceipt.status !== 1) {
    throw new Error(`addLiquidity failed: ${addLiquidityTx.hash}`);
  }

  const pairAddress = await factory.getPair(wqieAddress, qusdcAddress);
  await assertContract("QIEDexPair", pairAddress);
  const pair = await hre.ethers.getContractAt("QIEDexPair", pairAddress);
  const reserves = await pair.getReserves();
  const reserve0 = BigInt(reserves[0]);
  const reserve1 = BigInt(reserves[1]);
  if (reserve0 === 0n || reserve1 === 0n) {
    throw new Error(`QIEDex pair has zero reserves: ${reserve0.toString()} / ${reserve1.toString()}`);
  }

  const nextDeployment = {
    ...deployment,
    addresses: {
      ...(deployment.addresses || {}),
      qiedexFactory: factoryAddress,
      qiedexRouter: routerAddress,
      qiedexPair: pairAddress,
      wqie: wqieAddress,
      qusdc: qusdcAddress
    },
    qiedexFactory: factoryAddress,
    qiedexRouter: routerAddress,
    qiedexPair: pairAddress,
    wqie: wqieAddress,
    qusdc: qusdcAddress,
    qiedexDeployedAt: new Date().toISOString()
  };

  const deploymentFile = writeDeployment(nextDeployment);
  const envFile = upsertEnv({
    QIEDEX_FACTORY_ADDRESS: factoryAddress,
    QIEDEX_ROUTER_ADDRESS: routerAddress,
    WQIE_ADDRESS: wqieAddress,
    QUSDC_ADDRESS: qusdcAddress
  });

  console.log("QIEDex deployment complete");
  console.log(JSON.stringify({
    deployer: deployerAddress,
    wqie: wqieAddress,
    qusdc: qusdcAddress,
    qiedexFactory: factoryAddress,
    qiedexRouter: routerAddress,
    qiedexPair: pairAddress,
    reserve0: reserve0.toString(),
    reserve1: reserve1.toString(),
    addLiquidityTx: addLiquidityTx.hash,
    deploymentFile,
    envFile
  }, null, 2));
}

main().catch((error) => {
  console.error("QIEDex deployment failed");
  console.error(error.shortMessage || error.reason || error.message || String(error));
  console.error(error);
  process.exitCode = 1;
});
