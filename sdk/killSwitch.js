import {
  SpendGridError,
  assertAddress,
  assertPositiveAgentId,
  receiptStatus,
  stringifyBigInts
} from "./utils.js";

const DEFAULT_ANOMALY_RULES = Object.freeze({
  pauseOnBackendNotReady: true,
  highRiskLevels: ["HIGH", "CRITICAL"],
  minTreasuryHealth: 50,
  blockedStatuses: ["blocked", "failed", "rejected"]
});

/**
 * Pauses SpendController spending for an agent.
 */
export async function emergencyPauseVault(sdk, options = {}) {
  const agentId = assertPositiveAgentId(options.agentId || sdk.agentId);
  await sdk.assertNetwork();
  await sdk.assertAgentActive(agentId);

  const signer = await sdk.requireSigner();
  const controller = sdk.contracts.controller.connect(signer);
  const tx = await controller.pauseAgent(agentId);
  const receipt = await tx.wait();

  return stringifyBigInts({
    agentId,
    paused: receipt.status === 1,
    txHash: tx.hash,
    status: receiptStatus(receipt),
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed
  });
}

/**
 * Transfers the caller wallet's SpendGrid payment token balance to a safe wallet.
 * The current StreamVault is not escrow-custodial, so this routes signer-held QUSDC.
 */
export async function routeRemainingFundsToSafeVault(sdk, options = {}) {
  const safeVault = assertAddress(
    options.safeVault || options.safeVaultAddress || options.receiver || sdk.safeVault,
    "safeVault"
  );
  const signer = await sdk.requireSigner();
  const owner = await signer.getAddress();
  const token = sdk.contracts.qusdc.connect(signer);
  const balance = BigInt(options.amountWei || await token.balanceOf(owner));
  if (balance <= 0n) {
    throw new SpendGridError("no payment token balance available to route", "NO_FUNDS_TO_ROUTE", {
      owner,
      token: sdk.addresses.qusdc
    });
  }

  await sdk.assertNetwork();
  const tx = await token.transfer(safeVault, balance);
  const receipt = await tx.wait();

  return stringifyBigInts({
    owner,
    safeVault,
    token: sdk.addresses.qusdc,
    amount: balance,
    txHash: tx.hash,
    status: receiptStatus(receipt),
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed
  });
}

/**
 * Reads backend status and returns anomaly flags without executing transactions.
 */
export async function detectAnomalyFlags(sdk, options = {}) {
  const agentId = assertPositiveAgentId(options.agentId || sdk.agentId);
  const rules = {
    ...DEFAULT_ANOMALY_RULES,
    ...(options.rules || {})
  };
  const status = options.status || await sdk.loadBackendStatus(agentId);
  const flags = [];

  if (!status) {
    return {
      agentId: agentId.toString(),
      flags,
      status: null,
      actionable: false
    };
  }

  if (rules.pauseOnBackendNotReady && status.ready === false) {
    flags.push({
      code: "BACKEND_NOT_READY",
      severity: "HIGH",
      message: "SpendGrid backend reports not ready"
    });
  }

  const riskLevel = String(status.riskLevel || status.aiSentry?.riskLevel || "").toUpperCase();
  if (riskLevel && rules.highRiskLevels.includes(riskLevel)) {
    flags.push({
      code: "HIGH_RISK_LEVEL",
      severity: riskLevel,
      message: `Backend risk level is ${riskLevel}`
    });
  }

  const treasuryHealth = Number(status.treasuryHealth ?? status.aiSentry?.treasuryHealth);
  if (Number.isFinite(treasuryHealth) && treasuryHealth < rules.minTreasuryHealth) {
    flags.push({
      code: "LOW_TREASURY_HEALTH",
      severity: treasuryHealth < 25 ? "CRITICAL" : "HIGH",
      message: `Treasury health is ${treasuryHealth}`
    });
  }

  if (status.budget?.paused || status.agent?.active === false) {
    flags.push({
      code: status.budget?.paused ? "AGENT_PAUSED" : "AGENT_INACTIVE",
      severity: "HIGH",
      message: status.budget?.paused ? "Agent spending is paused" : "Agent is inactive"
    });
  }

  const records = status.records || status.history || status.agent?.history || [];
  const blockedStatuses = new Set(rules.blockedStatuses.map((value) => String(value).toLowerCase()));
  for (const record of Array.isArray(records) ? records : []) {
    const recordStatus = String(record.status || "").toLowerCase();
    if (blockedStatuses.has(recordStatus)) {
      flags.push({
        code: "RECENT_BLOCKED_RECORD",
        severity: "MEDIUM",
        message: "Backend returned a recent blocked or failed spend record",
        record
      });
      break;
    }
  }

  return stringifyBigInts({
    agentId,
    flags,
    status,
    actionable: flags.some((flag) => ["HIGH", "CRITICAL"].includes(flag.severity))
  });
}

export function isSpendGridAnomaly(result) {
  return Boolean(result?.flags?.length);
}
