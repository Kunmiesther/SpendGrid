import { createStream, executePayment } from "./vault.js";
import {
  assertAddress,
  assertPositiveAgentId,
  normalizeMode,
  parseTokenAmount,
  stringifyBigInts
} from "./utils.js";

/**
 * Execute a SpendGrid payment through StreamVault.
 *
 * @param {SpendGridSDK} sdk
 * @param {object} input
 * @param {number|string|bigint} [input.agentId]
 * @param {string} input.receiver
 * @param {string|number|bigint} input.amount
 * @param {"instant"|"stream"} [input.mode]
 * @param {object} [input.metadata]
 * @param {number|string|bigint} [input.streamId] Existing stream for stream mode.
 * @param {number|string|bigint} [input.units] Units to execute against an existing stream.
 */
export async function pay(sdk, input = {}) {
  const agentId = assertPositiveAgentId(input.agentId || sdk.agentId);
  const mode = normalizeMode(input.mode || "instant");
  const metadata = input.metadata || null;

  if (mode === "stream" && input.streamId) {
    const receipt = await executePayment(sdk, {
      agentId,
      streamId: input.streamId,
      units: input.units || 1
    });

    return stringifyBigInts({
      txHash: receipt.txHash,
      status: receipt.status,
      amount: receipt.amount,
      streamId: receipt.streamId,
      timestamp: receipt.timestamp,
      metadata
    });
  }

  const receiver = assertAddress(input.receiver, "receiver");
  const amountWei = input.amountWei !== undefined
    ? BigInt(input.amountWei)
    : parseTokenAmount(input.amount, sdk.tokenDecimals);

  const { signerAddress } = await sdk.assertAgentOperator(agentId);
  await sdk.assertSpendAllowed({ agentId, amountWei });
  await sdk.assertTokenAllowance({ owner: signerAddress, amountWei });

  const stream = await createStream(sdk, {
    agentId,
    receiver,
    ratePerUnitWei: amountWei
  });
  const payment = await executePayment(sdk, {
    agentId,
    streamId: stream.streamId,
    units: 1
  });

  return stringifyBigInts({
    txHash: payment.txHash,
    status: payment.status,
    amount: payment.amount,
    streamId: payment.streamId,
    timestamp: payment.timestamp,
    metadata
  });
}
