const crypto = require("crypto");
const { ethers } = require("ethers");

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function hashPrompt(prompt) {
  return crypto.createHash("sha256").update(String(prompt || "")).digest("hex");
}

function bigintJson(value) {
  return JSON.parse(
    JSON.stringify(value, (_key, innerValue) => (typeof innerValue === "bigint" ? innerValue.toString() : innerValue))
  );
}

function toUint(value, fieldName) {
  if (value === undefined || value === null || value === "") {
    throw new Error(`${fieldName} is required`);
  }

  const parsed = BigInt(value);
  if (parsed < 0n) {
    throw new Error(`${fieldName} cannot be negative`);
  }

  return parsed;
}

function toPositiveUint(value, fieldName) {
  const parsed = toUint(value, fieldName);
  if (parsed === 0n) {
    throw new Error(`${fieldName} must be greater than zero`);
  }

  return parsed;
}

function normalizeBytes32(value) {
  if (!value) {
    throw new Error("qiePassId is required");
  }
  if (ethers.isHexString(value, 32)) {
    return value;
  }
  return ethers.id(String(value));
}

function findEvent(receipt, contractInterface, eventName) {
  for (const log of receipt.logs) {
    try {
      const parsed = contractInterface.parseLog(log);
      if (parsed && parsed.name === eventName) {
        return parsed;
      }
    } catch (_error) {
      // Logs from other contracts are expected in the same transaction.
    }
  }

  throw new Error(`Event ${eventName} not found in transaction ${receipt.hash}`);
}

function startOfUtcDay(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

module.exports = {
  bigintJson,
  createId,
  findEvent,
  hashPrompt,
  normalizeBytes32,
  nowIso,
  startOfUtcDay,
  toPositiveUint,
  toUint
};
