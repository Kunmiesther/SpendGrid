const hre = require("hardhat");
const { loadDeployment } = require("../backend/src/deployment");
const { LiquidityEngine } = require("../backend/services/liquidityEngine");

const FACTORY_ABI = [
  "function getPair(address tokenA,address tokenB) external view returns (address pair)"
];

const ROUTER_ABI = [
  "function factory() external view returns (address)",
  "function WETH() external view returns (address)"
];

async function codeStatus(label, address) {
  const code = await hre.ethers.provider.getCode(address);
  console.log(`${label}: ${address}`);
  console.log(`${label} code: ${code && code !== "0x" ? "present" : "missing"}`);
}

async function main() {
  const deployment = loadDeployment();
  const { qiedexRouter, qiedexFactory, wqie, qusdc } = deployment.addresses;

  await codeStatus("Router", qiedexRouter);
  await codeStatus("Factory", qiedexFactory);
  await codeStatus("WQIE", wqie);
  await codeStatus("QUSDC", qusdc);

  const router = new hre.ethers.Contract(qiedexRouter, ROUTER_ABI, hre.ethers.provider);
  const factory = new hre.ethers.Contract(qiedexFactory, FACTORY_ABI, hre.ethers.provider);
  const liquidityEngine = new LiquidityEngine({
    router,
    factory,
    wqie,
    qusdc
  });

  try {
    console.log(`Router.factory(): ${await router.factory()}`);
  } catch (error) {
    console.log(`Router.factory() failed: ${error.shortMessage || error.message}`);
  }

  try {
    console.log(`Router.WETH(): ${await router.WETH()}`);
  } catch (error) {
    console.log(`Router.WETH() failed: ${error.shortMessage || error.message}`);
  }

  try {
    console.log(`Factory.getPair(WQIE,QUSDC): ${await factory.getPair(wqie, qusdc)}`);
  } catch (error) {
    console.log(`Factory.getPair(WQIE,QUSDC) failed: ${error.shortMessage || error.message}`);
  }

  try {
    console.log(`Factory.getPair(QUSDC,WQIE): ${await factory.getPair(qusdc, wqie)}`);
  } catch (error) {
    console.log(`Factory.getPair(QUSDC,WQIE) failed: ${error.shortMessage || error.message}`);
  }

  console.log(`Liquidity diagnostic: ${JSON.stringify(await liquidityEngine.inspectLiquidity(wqie, qusdc), null, 2)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
