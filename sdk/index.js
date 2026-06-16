import { SpendGridSDK } from "./client.js";
import {
  createVault as createVaultCore,
  getVault as getVaultCore,
  executePayment as executePaymentCore,
  createStream as createStreamCore
} from "./vault.js";
import { pay as payCore } from "./pay.js";
import { attachSpendGridPay } from "./payButton.js";
import { createSpendGridAdapter } from "./adapter.js";
import { initSpendGrid } from "./quick.js";
import { SpendGridCache, createSpendGridCache } from "./cache.js";
import {
  emergencyPauseVault as emergencyPauseVaultCore,
  routeRemainingFundsToSafeVault as routeRemainingFundsToSafeVaultCore,
  detectAnomalyFlags as detectAnomalyFlagsCore,
  isSpendGridAnomaly
} from "./killSwitch.js";
import { SpendGridError } from "./utils.js";

function defaultSdk(options = {}) {
  if (options instanceof SpendGridSDK) {
    return options;
  }
  if (typeof options === "string" || typeof options === "number" || typeof options === "bigint") {
    return new SpendGridSDK({ agentId: options });
  }
  if (options.sdk instanceof SpendGridSDK) {
    return options.sdk;
  }
  if (options.client instanceof SpendGridSDK) {
    return options.client;
  }

  return new SpendGridSDK(options.sdkOptions || options);
}

export {
  SpendGridSDK,
  SpendGridError,
  attachSpendGridPay,
  createSpendGridAdapter,
  initSpendGrid,
  SpendGridCache,
  createSpendGridCache,
  isSpendGridAnomaly
};

export async function createVault(options = {}) {
  const sdk = defaultSdk(options);
  return createVaultCore(sdk, options);
}

export async function getVault(options = {}) {
  const sdk = defaultSdk(options);
  return getVaultCore(sdk, options);
}

export async function pay(options = {}) {
  const sdk = defaultSdk(options);
  return payCore(sdk, options);
}

export async function executePayment(options = {}) {
  const sdk = defaultSdk(options);
  return executePaymentCore(sdk, options);
}

export async function createStream(options = {}) {
  const sdk = defaultSdk(options);
  return createStreamCore(sdk, options);
}

export async function emergencyPauseVault(options = {}) {
  const sdk = defaultSdk(options);
  return emergencyPauseVaultCore(sdk, options);
}

export async function routeRemainingFundsToSafeVault(options = {}) {
  const sdk = defaultSdk(options);
  return routeRemainingFundsToSafeVaultCore(sdk, options);
}

export async function detectAnomalyFlags(options = {}) {
  const sdk = defaultSdk(options);
  return detectAnomalyFlagsCore(sdk, options);
}

export function subscribe(options = {}) {
  const sdk = defaultSdk(options);
  return sdk.subscribe(options);
}
