const { ethers } = require("ethers");
const { makeContracts } = require("../backend/src/contracts");
const { LiquidityEngine } = require("../backend/services/liquidityEngine");

async function main() {
  const amount = ethers.parseUnits(process.env.SIMULATE_SWAP_QUSDC || "0.05", 18);
  const contracts = makeContracts();
  const owner = await contracts.signer.getAddress();
  const before = BigInt(await contracts.qusdc.balanceOf(owner));
  const engine = new LiquidityEngine({
    factory: contracts.qiedexFactory,
    router: contracts.qiedexRouter,
    wqie: contracts.addresses.wqie,
    qusdc: contracts.addresses.qusdc
  });

  const result = await engine.ensureQusdcBalance({
    tokenIn: contracts.addresses.wqie,
    tokenOut: contracts.addresses.qusdc,
    inputTokenContract: contracts.wqie,
    owner,
    requiredAmount: before + amount,
    amountIn: amount
  });
  const after = BigInt(await contracts.qusdc.balanceOf(owner));

  console.log(JSON.stringify({
    owner,
    requiredAdditionalQusdc: amount.toString(),
    beforeQusdc: before.toString(),
    afterQusdc: after.toString(),
    receivedQusdc: (after - before).toString(),
    result
  }, null, 2));

  if (!result.swapped || after < before + amount) {
    throw new Error(`Liquidity swap simulation failed: ${result.reason || "INSUFFICIENT_QUSDC_AFTER_SWAP"}`);
  }
}

main().catch((error) => {
  console.error(error.shortMessage || error.reason || error.message || String(error));
  console.error(error);
  process.exitCode = 1;
});
