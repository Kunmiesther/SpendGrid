const hre = require("hardhat");
const { loadDeployment } = require("../backend/src/deployment");
const { LiquidityEngine } = require("../backend/services/liquidityEngine");

const FACTORY_ABI = [
  "function getPair(address tokenA,address tokenB) external view returns (address pair)"
];

const ROUTER_ABI = [
  "function factory() external view returns (address)",
  "function WETH() external view returns (address)",
  "function getAmountOut(uint256 amountIn,address input,address output) external view returns (uint256 amountOut)",
  "function swapExactTokensForTokens(uint256 amountIn,uint256 amountOutMin,address[] calldata path,address to,uint256 deadline) external returns (uint256[] memory amounts)"
];

const ERC20_ABI = [
  "function approve(address spender,uint256 amount) external returns (bool)",
  "function allowance(address owner,address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)"
];

const WQIE_ABI = [
  ...ERC20_ABI,
  "function deposit() external payable"
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

  const diagnostic = await liquidityEngine.inspectLiquidity(wqie, qusdc);
  console.log(`Liquidity diagnostic: ${JSON.stringify(diagnostic, null, 2)}`);

  if (diagnostic.hasLiquidity) {
    const amountIn = hre.ethers.parseUnits(process.env.QIEDEX_INSPECT_SWAP_AMOUNT || "1", 18);
    try {
      console.log(`Router.getAmountOut(${amountIn.toString()}, WQIE, QUSDC): ${await router.getAmountOut(amountIn, wqie, qusdc)}`);
    } catch (error) {
      console.log(`Router.getAmountOut failed: ${error.shortMessage || error.message}`);
    }

    if (process.env.QIEDEX_INSPECT_SWAP === "true") {
      const [signer] = await hre.ethers.getSigners();
      if (!signer) throw new Error("No signer available for QIEDEX_INSPECT_SWAP=true");
      const signerAddress = await signer.getAddress();
      const wqieToken = new hre.ethers.Contract(wqie, ERC20_ABI, signer);
      const qusdcToken = new hre.ethers.Contract(qusdc, ERC20_ABI, signer);
      const before = await qusdcToken.balanceOf(signerAddress);
      const wqieBalance = BigInt(await wqieToken.balanceOf(signerAddress));
      if (wqieBalance < amountIn) {
        const nativeBalance = BigInt(await hre.ethers.provider.getBalance(signerAddress));
        const missing = amountIn - wqieBalance;
        if (nativeBalance <= missing) {
          throw new Error(`Insufficient native QIE to wrap ${missing.toString()} wei for inspect swap`);
        }
        const wrapper = new hre.ethers.Contract(wqie, WQIE_ABI, signer);
        const depositTx = await wrapper.deposit({ value: missing });
        await depositTx.wait();
        console.log(`Wrapped native QIE for inspect swap: ${missing.toString()}`);
      }
      const allowance = await wqieToken.allowance(signerAddress, qiedexRouter);
      if (BigInt(allowance) < amountIn) {
        const approveTx = await wqieToken.approve(qiedexRouter, amountIn);
        await approveTx.wait();
      }
      const deadline = Math.floor(Date.now() / 1000) + 300;
      const tx = await router.connect(signer).swapExactTokensForTokens(amountIn, 0, [wqie, qusdc], signerAddress, deadline);
      const receipt = await tx.wait();
      const after = await qusdcToken.balanceOf(signerAddress);
      console.log(`Inspect swap tx: ${tx.hash}`);
      console.log(`Inspect swap status: ${receipt.status === 1 ? "confirmed" : "failed"}`);
      console.log(`QUSDC received: ${(BigInt(after) - BigInt(before)).toString()}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
