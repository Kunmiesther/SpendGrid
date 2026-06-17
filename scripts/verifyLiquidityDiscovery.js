const { ethers } = require("ethers");
const { loadDeployment } = require("../backend/src/deployment");
const { FACTORY_ABI, inspectPair, inspectLiquidity } = require("../backend/services/liquidityEngine");

async function main() {
  const deployment = loadDeployment();
  const rpcUrl = process.env.QIE_RPC_URL;
  if (!rpcUrl) {
    throw new Error("QIE_RPC_URL is required");
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl, deployment.chainId);
  const { qiedexFactory, streamVault, wqie, qusdc } = deployment.addresses;
  const factory = new ethers.Contract(qiedexFactory, FACTORY_ABI, provider);
  const wrongFactory = new ethers.Contract(streamVault, FACTORY_ABI, provider);

  const realPair = await inspectPair(factory, wqie, qusdc);
  const realLiquidity = await inspectLiquidity(factory, wqie, qusdc);
  const wrongPair = await inspectPair(wrongFactory, wqie, qusdc);

  console.log(JSON.stringify({
    configured: {
      qiedexFactory,
      wrongFactory: streamVault,
      wqie,
      qusdc
    },
    realPair,
    realLiquidity,
    wrongPair
  }, null, 2));

  if (!realPair.pair) {
    throw new Error(`Expected real factory pair, got ${realPair.reason}`);
  }
  if (!realLiquidity.hasLiquidity) {
    throw new Error(`Expected real liquidity, got ${realLiquidity.reason}`);
  }
  if (wrongPair.reason !== "QIEDEX_FACTORY_ABI_MISMATCH") {
    throw new Error(`Expected QIEDEX_FACTORY_ABI_MISMATCH for wrong factory, got ${wrongPair.reason}`);
  }
}

main().catch((error) => {
  console.error(error.shortMessage || error.reason || error.message || String(error));
  console.error(error);
  process.exitCode = 1;
});
