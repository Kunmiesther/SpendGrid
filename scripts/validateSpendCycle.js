const hre = require("hardhat");
const { AgentLedger } = require("../backend/src/ledger");
const { makeContracts } = require("../backend/src/contracts");
const { LiquidityEngine } = require("../backend/services/liquidityEngine");
const { AutonomousAgentEngine } = require("../backend/src/engine");

const MIN_QUSDC_BALANCE = hre.ethers.parseUnits("0.1", 18);
const TEST_MODE_LIMIT = 50_000_000_000_000_000n;

async function waitForSuccess(tx, label) {
  console.log(`${label} tx submitted: ${tx.hash}`);
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) {
    throw new Error(`${label} failed: transaction ${tx.hash} was not successful`);
  }

  console.log(`${label} confirmed in block ${receipt.blockNumber}`);
  return receipt;
}

async function ensureAllowance(contracts, owner, amount) {
  const allowance = BigInt(await contracts.qusdc.allowance(owner, contracts.addresses.vault));
  if (allowance >= amount) {
    return { approved: false, allowance: allowance.toString(), txHash: null };
  }

  const tx = await contracts.qusdc.approve(contracts.addresses.vault, amount);
  await waitForSuccess(tx, "StreamVault QUSDC approval");
  const nextAllowance = BigInt(await contracts.qusdc.allowance(owner, contracts.addresses.vault));
  return { approved: true, allowance: nextAllowance.toString(), txHash: tx.hash };
}

async function main() {
  const contracts = makeContracts();
  const owner = await contracts.signer.getAddress();
  const balance = BigInt(await contracts.qusdc.balanceOf(owner));

  console.log(`Backend signer: ${owner}`);
  console.log(`QUSDC balance: ${hre.ethers.formatUnits(balance, 18)} QUSDC`);
  if (balance < MIN_QUSDC_BALANCE) {
    throw new Error(`Backend signer must have at least 0.1 QUSDC; current balance is ${hre.ethers.formatUnits(balance, 18)} QUSDC`);
  }

  const approval = await ensureAllowance(contracts, owner, balance);
  console.log(`StreamVault allowance: ${hre.ethers.formatUnits(approval.allowance, 18)} QUSDC`);

  const ledger = new AgentLedger({
    logPath: process.env.VALIDATION_AGENT_LOG_PATH || "backend/logs/agent-validation.ndjson"
  });
  const liquidityEngine = new LiquidityEngine({
    factory: contracts.qiedexFactory,
    router: contracts.qiedexRouter,
    wqie: contracts.addresses.wqie,
    qusdc: contracts.addresses.qusdc,
    ledger
  });
  const engine = new AutonomousAgentEngine(contracts, ledger, { liquidityEngine });
  await engine.start();

  const result = await engine.runTask({
    action: "createStream",
    agentId: process.env.AGENT_ID || "1",
    prompt: "Validate SpendGrid testnet execution with 0.05 QUSDC limit.",
    receiver: process.env.AGENT_RECEIVER || owner,
    ratePerUnit: TEST_MODE_LIMIT.toString(),
    units: "1",
    closeAfterRun: true
  });

  const executePayment = result.interactions.find((interaction) => interaction.interactionType === "executePayment");
  if (!executePayment?.txHash) {
    throw new Error("Spend cycle did not produce an executePayment tx hash");
  }

  console.log(JSON.stringify({
    status: result.status,
    runId: result.runId,
    executePaymentTxHash: executePayment.txHash,
    amount: executePayment.amount,
    approval
  }, null, 2));
}

main().catch((error) => {
  console.error(error.shortMessage || error.reason || error.message || String(error));
  console.error(error);
  process.exitCode = 1;
});
