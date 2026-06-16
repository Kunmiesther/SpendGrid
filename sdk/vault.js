import { ethers } from "ethers";
import {
  SpendGridError,
  assertAddress,
  assertPositiveAgentId,
  assertPositiveBigInt,
  findEvent,
  parseTokenAmount,
  receiptStatus,
  stringifyBigInts,
  toIsoTimestampFromBlock
} from "./utils.js";

/**
 * Creates a SpendGrid stream vault entry for an agent.
 */
export async function createVault(sdk, options = {}) {
  const normalized = normalizeVaultOptions(options);
  if (!normalized.receiver && !normalized.ratePerUnit && !normalized.ratePerUnitWei && !normalized.amount) {
    return getVault(sdk, normalized);
  }

  return createStream(sdk, normalized);
}

/**
 * Returns a stream by ID or an agent-level vault summary.
 */
export async function getVault(sdk, options = {}) {
  options = normalizeVaultOptions(options);
  const agentId = assertPositiveAgentId(options.agentId || sdk.agentId);

  if (options.streamId !== undefined && options.streamId !== null && options.streamId !== "") {
    const streamId = assertPositiveBigInt(options.streamId, "streamId");
    const stream = await sdk.contracts.vault.getStream(streamId);
    if (BigInt(stream.agentId) !== agentId) {
      throw new SpendGridError("stream does not belong to agent", "STREAM_AGENT_MISMATCH", {
        agentId: agentId.toString(),
        streamId: streamId.toString()
      });
    }

    return normalizeStream(streamId, stream);
  }

  const [agent, budget, safeSpend] = await Promise.all([
    sdk.assertAgentActive(agentId),
    sdk.getBudget(agentId),
    sdk.getSafeSpendLimit(agentId)
  ]);

  return stringifyBigInts({
    agentId,
    agent,
    budget,
    safeSpend,
    vaultAddress: sdk.addresses.streamVault,
    paymentToken: sdk.addresses.qusdc
  });
}

/**
 * Creates a SpendGrid payment stream without executing it.
 */
export async function createStream(sdk, options = {}) {
  options = normalizeVaultOptions(options);
  const agentId = assertPositiveAgentId(options.agentId || sdk.agentId);
  const receiver = assertAddress(options.receiver, "receiver");
  const ratePerUnit = options.ratePerUnitWei !== undefined
    ? assertPositiveBigInt(options.ratePerUnitWei, "ratePerUnitWei")
    : parseTokenAmount(options.ratePerUnit || options.amount, sdk.tokenDecimals);

  await sdk.assertNetwork();
  const { signer } = await sdk.assertAgentOperator(agentId);
  await sdk.assertSpendAllowed({ agentId, amountWei: ratePerUnit });

  const vault = sdk.contracts.vault.connect(signer);
  const tx = await vault.createStream(agentId, receiver, ratePerUnit);
  const receipt = await tx.wait();
  const event = findEvent(receipt, vault.interface, "StreamCreated");
  const streamId = event?.args?.streamId;

  if (streamId === undefined || streamId === null) {
    throw new SpendGridError("StreamCreated event was not emitted", "STREAM_EVENT_MISSING", { txHash: tx.hash });
  }

  return stringifyBigInts({
    txHash: tx.hash,
    status: receiptStatus(receipt),
    streamId,
    agentId,
    receiver,
    ratePerUnit,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed
  });
}

/**
 * Executes an existing SpendGrid stream payment.
 */
export async function executePayment(sdk, options = {}) {
  options = normalizeVaultOptions(options);
  const agentId = assertPositiveAgentId(options.agentId || sdk.agentId);
  const streamId = assertPositiveBigInt(options.streamId, "streamId");
  const units = assertPositiveBigInt(options.units || 1, "units");
  const stream = await sdk.contracts.vault.getStream(streamId);

  if (BigInt(stream.agentId) !== agentId) {
    throw new SpendGridError("stream does not belong to agent", "STREAM_AGENT_MISMATCH", {
      agentId: agentId.toString(),
      streamId: streamId.toString()
    });
  }
  if (!stream.active) {
    throw new SpendGridError("stream is inactive", "STREAM_INACTIVE", { streamId: streamId.toString() });
  }

  const amountWei = BigInt(stream.ratePerUnit) * units;
  await sdk.assertNetwork();
  const { signer } = await sdk.assertAgentOperator(agentId, [stream.payer]);
  await sdk.assertSpendAllowed({ agentId, amountWei });
  await sdk.assertTokenAllowance({ owner: stream.payer, amountWei });

  const vault = sdk.contracts.vault.connect(signer);
  const tx = await vault.executePayment(streamId, units);
  const receipt = await tx.wait();
  const payment = findEvent(receipt, vault.interface, "PaymentExecuted");
  const block = await sdk.provider.getBlock(receipt.blockNumber).catch(() => null);

  return stringifyBigInts({
    txHash: tx.hash,
    status: receiptStatus(receipt),
    amount: payment?.args?.amount || amountWei,
    streamId,
    agentId,
    units,
    receiver: payment?.args?.receiver || stream.receiver,
    timestamp: toIsoTimestampFromBlock(block),
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed
  });
}

function normalizeVaultOptions(options) {
  if (options === undefined || options === null) {
    return {};
  }
  if (typeof options === "string" || typeof options === "number" || typeof options === "bigint") {
    return { agentId: options };
  }

  return options;
}

export function normalizeStream(streamId, stream) {
  return stringifyBigInts({
    streamId,
    agentId: stream.agentId,
    payer: ethers.getAddress(stream.payer),
    receiver: ethers.getAddress(stream.receiver),
    ratePerUnit: stream.ratePerUnit,
    active: stream.active,
    createdAt: stream.createdAt,
    totalUnits: stream.totalUnits,
    totalPaid: stream.totalPaid
  });
}
