const { ethers } = require("ethers");
const { createId, hashPrompt, toPositiveUint } = require("./utils");

const MAX_MODEL_UNITS = BigInt(process.env.AGENT_MAX_MODEL_UNITS || "25");

function parseRequestedAction(value) {
  if (!value) {
    return "auto";
  }

  const action = String(value).trim();
  if (!["auto", "createStream", "executePayment", "stopStream"].includes(action)) {
    throw new Error("action must be auto, createStream, executePayment, or stopStream");
  }

  return action;
}

async function runModel(prompt, context = {}) {
  const safePrompt = String(prompt || "").trim();
  if (!safePrompt) {
    throw new Error("prompt is required");
  }

  const requestedUnits = context.units ? toPositiveUint(context.units, "units") : null;
  const usageUnits = requestedUnits || BigInt(Math.max(1, Math.ceil(safePrompt.length / 512)));
  const boundedUnits = usageUnits > MAX_MODEL_UNITS ? MAX_MODEL_UNITS : usageUnits;

  return {
    provider: process.env.AI_PROVIDER || "mock-policy-model",
    model: process.env.AI_MODEL || "spendgrid-local-policy-v1",
    promptHash: hashPrompt(safePrompt),
    output: `Autonomous execution plan generated for ${safePrompt.length} prompt characters.`,
    usageUnits: boundedUnits,
    confidence: 0.82
  };
}

function decideAction(input, aiResult) {
  const action = parseRequestedAction(input.action);
  const hasStream = input.streamId !== undefined && input.streamId !== null && input.streamId !== "";
  const closeAfterRun = input.closeAfterRun === true || input.stopAfterRun === true;

  if (action === "stopStream") {
    if (!hasStream) {
      throw new Error("streamId is required for stopStream");
    }

    return {
      decisionId: createId("decision"),
      action: "stopStream",
      reason: "Model selected stream termination for the requested agent task.",
      streamId: toPositiveUint(input.streamId, "streamId"),
      units: 0n,
      closeAfterRun: false
    };
  }

  if (action === "executePayment" || (action === "auto" && hasStream)) {
    return {
      decisionId: createId("decision"),
      action: "executePayment",
      reason: "Model selected a bounded payment execution against an existing stream.",
      streamId: toPositiveUint(input.streamId, "streamId"),
      units: aiResult.usageUnits,
      closeAfterRun
    };
  }

  if (action === "createStream" || action === "auto") {
    if (!input.receiver || !ethers.isAddress(input.receiver)) {
      throw new Error("receiver must be a valid address when creating a stream");
    }

    return {
      decisionId: createId("decision"),
      action: "createStream",
      reason: "Model selected a new stream and first bounded payment execution.",
      receiver: ethers.getAddress(input.receiver),
      ratePerUnit: toPositiveUint(input.ratePerUnit, "ratePerUnit"),
      units: aiResult.usageUnits,
      closeAfterRun
    };
  }

  throw new Error(`Unsupported action: ${action}`);
}

module.exports = {
  decideAction,
  runModel
};
