import { ethers } from "ethers";
import { DEFAULT_TOKEN_DECIMALS } from "./contracts.js";

export class SpendGridError extends Error {
  constructor(message, code = "SPENDGRID_ERROR", details = {}) {
    super(message);
    this.name = "SpendGridError";
    this.code = code;
    this.details = details;
  }
}

export function assertPositiveAgentId(value, label = "agentId") {
  if (value === undefined || value === null || value === "") {
    throw new SpendGridError(`${label} is required`, "INVALID_AGENT_ID", { [label]: value });
  }

  let parsed;
  try {
    parsed = BigInt(value);
  } catch (_error) {
    throw new SpendGridError(`${label} must be a positive integer`, "INVALID_AGENT_ID", { [label]: value });
  }

  if (parsed <= 0n) {
    throw new SpendGridError(`${label} must be greater than zero`, "INVALID_AGENT_ID", { [label]: value });
  }

  return parsed;
}

export function assertPositiveBigInt(value, label) {
  if (value === undefined || value === null || value === "") {
    throw new SpendGridError(`${label} is required`, "INVALID_AMOUNT", { [label]: value });
  }

  let parsed;
  try {
    parsed = BigInt(value);
  } catch (_error) {
    throw new SpendGridError(`${label} must be a positive integer`, "INVALID_AMOUNT", { [label]: value });
  }

  if (parsed <= 0n) {
    throw new SpendGridError(`${label} must be greater than zero`, "INVALID_AMOUNT", { [label]: value });
  }

  return parsed;
}

export function assertAddress(value, label = "address") {
  if (!value || !ethers.isAddress(value) || value.toLowerCase() === ethers.ZeroAddress.toLowerCase()) {
    throw new SpendGridError(`${label} must be a valid non-zero address`, "INVALID_ADDRESS", { [label]: value });
  }

  return ethers.getAddress(value);
}

export function parseTokenAmount(value, decimals = DEFAULT_TOKEN_DECIMALS) {
  if (typeof value === "bigint") {
    if (value <= 0n) {
      throw new SpendGridError("amount must be greater than zero", "INVALID_AMOUNT", { amount: value.toString() });
    }
    return value;
  }

  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new SpendGridError("amount must be finite", "INVALID_AMOUNT", { amount: value });
  }

  if (value === undefined || value === null || value === "") {
    throw new SpendGridError("amount is required", "INVALID_AMOUNT", { amount: value });
  }

  const parsed = ethers.parseUnits(String(value), decimals);
  if (parsed <= 0n) {
    throw new SpendGridError("amount must be greater than zero", "INVALID_AMOUNT", { amount: value });
  }

  return parsed;
}

export function stringifyBigInts(value) {
  return JSON.parse(
    JSON.stringify(value, (_key, innerValue) => (typeof innerValue === "bigint" ? innerValue.toString() : innerValue))
  );
}

export function normalizeMode(mode = "instant") {
  if (mode !== "instant" && mode !== "stream") {
    throw new SpendGridError('mode must be "instant" or "stream"', "INVALID_PAY_MODE", { mode });
  }

  return mode;
}

export function findEvent(receipt, contractInterface, eventName) {
  for (const log of receipt?.logs || []) {
    try {
      const parsed = contractInterface.parseLog(log);
      if (parsed?.name === eventName) {
        return parsed;
      }
    } catch (_error) {
      // Receipts can include ERC20 Transfer logs and other contract events.
    }
  }

  return null;
}

export function receiptStatus(receipt) {
  return receipt?.status === 1 ? "confirmed" : "failed";
}

export function toIsoTimestampFromBlock(block) {
  if (block?.timestamp) {
    return new Date(Number(block.timestamp) * 1000).toISOString();
  }

  return new Date().toISOString();
}

export function resolveElement(element) {
  if (!element) {
    throw new SpendGridError("element is required", "INVALID_ELEMENT");
  }

  if (typeof element === "string") {
    if (typeof document === "undefined") {
      throw new SpendGridError("selector elements require a browser document", "INVALID_ELEMENT", { element });
    }

    const selected = document.querySelector(element);
    if (!selected) {
      throw new SpendGridError(`No element found for selector ${element}`, "INVALID_ELEMENT", { element });
    }

    return selected;
  }

  if (typeof element.addEventListener !== "function") {
    throw new SpendGridError("element must be a selector or EventTarget", "INVALID_ELEMENT");
  }

  return element;
}

export async function fetchJson(baseUrl, path, options = {}) {
  if (!baseUrl) {
    return null;
  }
  if (typeof fetch !== "function") {
    throw new SpendGridError("fetch is unavailable in this runtime", "FETCH_UNAVAILABLE");
  }

  const url = new URL(path, baseUrl);
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal
  });
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new SpendGridError(
      body?.error || body?.message || `SpendGrid backend request failed: ${response.status}`,
      "BACKEND_REQUEST_FAILED",
      { status: response.status, body }
    );
  }

  return body;
}
