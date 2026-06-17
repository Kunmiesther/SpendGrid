import {
  SpendGridError,
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
  const receiver = assertAddress(input.recipient || input.receiver, "recipient");
  const amountWei = input.amountWei !== undefined
    ? BigInt(input.amountWei)
    : parseTokenAmount(input.amount, sdk.tokenDecimals);

  if (!sdk.backendUrl) {
    throw new SpendGridError("backendUrl is required because sdk.pay submits a payment intent to SpendGrid backend validation", "BACKEND_URL_REQUIRED", {
      agentId: agentId.toString(),
      mode
    });
  }

  const result = await sdk.submitPaymentIntent({
    intentId: input.intentId,
    recipient: receiver,
    amountWei,
    agentId,
    streamId: mode === "stream" ? input.streamId : null,
    metadata
  });

  return stringifyBigInts({
    intentId: result.intentId,
    runId: result.runId,
    txHash: result.receipt?.txHash || result.transaction?.executePayment?.txHash || null,
    status: result.status,
    accepted: result.accepted,
    amount: result.receipt?.amountWei || result.transaction?.executePayment?.amountWei || amountWei,
    streamId: result.receipt?.streamId || result.transaction?.executePayment?.streamId || null,
    timestamp: result.receipt?.timestamp || result.transaction?.executePayment?.timestamp || new Date().toISOString(),
    metadata,
    validation: result.validation,
    decision: result.decision,
    transaction: result.transaction || null
  });
}
