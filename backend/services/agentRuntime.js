const crypto = require("crypto");
const { ethers } = require("ethers");
const { ERC20_ABI } = require("../src/contracts");
const { CHAIN_ID } = require("../src/deployment");
const { isMockQusdcMode } = require("../src/qusdcMode");
const { AllowanceManager } = require("./allowanceManager");
const { LLMProvider } = require("./llmProvider");

const WEI_PER_QIE = 10n ** 18n;
const ZERO_ADDRESS = ethers.ZeroAddress.toLowerCase();
const ZERO_BYTES32 = /^0x0{64}$/i;
const DEFAULT_TEST_MODE_LIMIT_QIE = "0.05";
const DEFAULT_PAYMENT_INTENT_AMOUNT_QUSDC = "0.05";

function nowIso() {
  return new Date().toISOString();
}

function startOfUtcDay(date = new Date()) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function toPositiveBigInt(value, label) {
  if (value === undefined || value === null || value === "") {
    throw new Error(`${label} is required`);
  }

  const parsed = BigInt(value);
  if (parsed <= 0n) {
    throw new Error(`${label} must be greater than zero`);
  }

  return parsed;
}

function bigintJson(value) {
  return JSON.parse(
    JSON.stringify(value, (_key, innerValue) => (typeof innerValue === "bigint" ? innerValue.toString() : innerValue))
  );
}

function readPositiveBigInt(value, label) {
  if (value === undefined || value === null || value === "") {
    throw new Error(`${label} is required and must be greater than zero`);
  }

  const parsed = BigInt(value);
  if (parsed <= 0n) {
    throw new Error(`${label} is required and must be greater than zero`);
  }

  return parsed;
}

function parseQieToWei(value, label) {
  if (value === undefined || value === null || value === "") {
    throw new Error(`${label} is required and must be greater than zero`);
  }

  const parsed = ethers.parseUnits(String(value), 18);
  if (parsed <= 0n) {
    throw new Error(`${label} must be greater than zero`);
  }

  return parsed;
}

function readTestModeLimitWei(options = {}) {
  if (options.testModeLimitWei || process.env.TEST_MODE_LIMIT_WEI) {
    return readPositiveBigInt(options.testModeLimitWei || process.env.TEST_MODE_LIMIT_WEI, "TEST_MODE_LIMIT_WEI");
  }

  return parseQieToWei(
    options.testModeLimit || process.env.TEST_MODE_LIMIT || process.env.TEST_MODE_LIMIT_QIE || DEFAULT_TEST_MODE_LIMIT_QIE,
    "TEST_MODE_LIMIT"
  );
}

function weiToQieNumber(amountWei) {
  return Number(ethers.formatUnits(amountWei, 18));
}

function normalizeAddress(value) {
  if (!value || !ethers.isAddress(value)) {
    return null;
  }

  return ethers.getAddress(value);
}

function normalizeMetadata(value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw makeValidationError("INVALID_METADATA", "metadata must be an object when provided", {
      metadataType: Array.isArray(value) ? "array" : typeof value
    }, 400);
  }

  return value;
}

function normalizeAddressList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeAddress(item))
    .filter(Boolean);
}

function normalizePolicy(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const parseMaybeBigInt = (value, label) => {
    if (value === undefined || value === null || value === "") return null;
    try {
      const parsed = BigInt(value);
      if (parsed < 0n) {
        throw new Error(`${label} must be greater than or equal to zero`);
      }
      return parsed;
    } catch (error) {
      throw makeValidationError("INVALID_POLICY", error.message, { field: label, value }, 400);
    }
  };

  return {
    manualApprovalEnabled: Boolean(source.manualApprovalEnabled),
    manualApprovalThresholdWei: parseMaybeBigInt(source.manualApprovalThresholdWei, "manualApprovalThresholdWei"),
    maxPaymentAmountWei: parseMaybeBigInt(source.maxPaymentAmountWei, "maxPaymentAmountWei"),
    maxPaymentsPerDay: source.maxPaymentsPerDay === undefined || source.maxPaymentsPerDay === null || source.maxPaymentsPerDay === ""
      ? null
      : Number(source.maxPaymentsPerDay),
    whitelistRecipients: normalizeAddressList(source.whitelistRecipients),
    riskOverride: typeof source.riskOverride === "string" ? source.riskOverride.toUpperCase() : null
  };
}

function summarizeReason(value) {
  if (!value) return "unavailable";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.join(", ");
  return JSON.stringify(value);
}

function intentCountOnUtcDay(records, agentId, statuses = null, date = new Date()) {
  const dayStart = startOfUtcDay(date);
  const targetAgentId = String(agentId);
  const statusSet = Array.isArray(statuses) ? new Set(statuses) : null;

  return records.reduce((total, record) => {
    if (String(record.agentId) !== targetAgentId) return total;
    if (statusSet && !statusSet.has(record.status)) return total;
    const timestamp = new Date(record.completedAt || record.timestamp || record.startedAt || 0).getTime();
    if (timestamp < dayStart) return total;
    return total + 1;
  }, 0);
}

function buildIntentTimeline(record) {
  const validation = record.validation || {};
  const approval = record.approval || {};
  const execution = record.execution || {};
  const timeline = [];
  const baseTime = record.receivedAt || record.timestamp || record.startedAt || record.completedAt || nowIso();

  timeline.push({
    stage: "Intent Created",
    status: record.status === "rejected" && record.validation ? "rejected" : "done",
    timestamp: record.startedAt || record.timestamp || baseTime,
    detail: `Recipient ${record.intent?.recipient || record.recipient || "unavailable"} for ${record.intent?.amount || record.amount || "0"} QUSDC`
  });

  timeline.push({
    stage: "Policy Validation",
    status: validation.status || (record.status === "rejected" ? "rejected" : "done"),
    timestamp: validation.timestamp || record.validationAt || record.completedAt || record.timestamp || baseTime,
    detail: validation.reason || validation.reasons?.join(", ") || "Policy checks completed"
  });

  timeline.push({
    stage: "Budget Check",
    status: validation.status === "rejected" && validation.reasons?.includes("DAILY_LIMIT_EXCEEDED") ? "blocked" : "done",
    timestamp: validation.timestamp || record.validationAt || record.completedAt || record.timestamp || baseTime,
    detail: validation.budget?.limitingConstraint ? `Limiting constraint: ${validation.budget.limitingConstraint}` : "Budget checks completed"
  });

  timeline.push({
    stage: "QIE Pass Verification",
    status: validation.status === "rejected" && validation.reasons?.includes("QIE_PASS_INVALID") ? "blocked" : "done",
    timestamp: validation.timestamp || record.validationAt || record.completedAt || record.timestamp || baseTime,
    detail: validation.qiePass ? `Pass status: ${validation.qiePass.verified ? "verified" : validation.qiePass.status || "unknown"}` : "QIE Pass checks completed"
  });

  timeline.push({
    stage: "Liquidity Check",
    status: validation.status === "rejected" && validation.reasons?.includes("LIQUIDITY_UNAVAILABLE") ? "blocked" : "done",
    timestamp: validation.timestamp || record.validationAt || record.completedAt || record.timestamp || baseTime,
    detail: validation.liquidity?.reason || "Liquidity checks completed"
  });

  timeline.push({
    stage: approval?.required ? "Pending Approval" : "Approved",
    status: approval?.status || (record.status === "pending_approval" ? "pending" : record.status === "rejected" ? "rejected" : "done"),
    timestamp: approval?.requestedAt || record.approvalRequestedAt || record.completedAt || record.timestamp || baseTime,
    detail: approval?.reason || (approval?.required ? "Waiting for manual approval" : "Auto-approved")
  });

  if (execution?.status || record.transaction) {
    timeline.push({
      stage: "Executed",
      status: execution?.status || (record.status === "executed" ? "done" : record.status === "failed" ? "failed" : "unknown"),
      timestamp: execution?.completedAt || record.completedAt || record.timestamp || baseTime,
      detail: execution?.reason || record.transaction?.executePayment?.txHash || record.transaction?.txHash || "Execution complete"
    });
  }

  if (record.status === "executed" || record.status === "failed" || record.status === "rejected" || record.status === "pending_approval") {
    timeline.push({
      stage: "Completed",
      status: record.status,
      timestamp: record.completedAt || record.approvalCompletedAt || record.timestamp || baseTime,
      detail: record.error || execution?.message || approval?.status || `Intent ${record.status}`
    });
  }

  return timeline;
}

function sameAddress(left, right) {
  const normalizedLeft = normalizeAddress(left);
  const normalizedRight = normalizeAddress(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function minimumConstraint(constraints) {
  return constraints.reduce((current, next) => (next.value < current.value ? next : current));
}

function spendLimitFromConstraints(constraints, zeroGateNames = []) {
  const zeroGateSet = new Set(zeroGateNames);
  const zeroGateConstraints = constraints.filter((constraint) => zeroGateSet.has(constraint.name));
  const allZeroGateConstraints = zeroGateConstraints.every((constraint) => constraint.value === 0n);

  if (allZeroGateConstraints) {
    return {
      safeSpendLimitWei: 0n,
      limitingConstraint: zeroGateConstraints
        .filter((constraint) => constraint.value === 0n)
        .map((constraint) => constraint.name)
        .join("+"),
      ignoredZeroConstraints: []
    };
  }

  const positiveConstraints = constraints.filter((constraint) => constraint.value > 0n);
  if (positiveConstraints.length === 0) {
    return {
      safeSpendLimitWei: 0n,
      limitingConstraint: constraints
        .filter((constraint) => constraint.value === 0n)
        .map((constraint) => constraint.name)
        .join("+") || "none",
      ignoredZeroConstraints: constraints
        .filter((constraint) => constraint.value === 0n)
        .map((constraint) => constraint.name)
    };
  }

  const limitingConstraint = minimumConstraint(positiveConstraints);

  return {
    safeSpendLimitWei: limitingConstraint.value,
    limitingConstraint: limitingConstraint.name,
    ignoredZeroConstraints: constraints
      .filter((constraint) => constraint.value === 0n)
      .map((constraint) => constraint.name)
  };
}

function extractJsonObject(content) {
  const text = String(content || "").trim();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (_error) {
    // Continue with block extraction below.
  }

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch (_error) {
      // Continue with balanced object extraction below.
    }
  }

  const start = text.indexOf("{");
  if (start === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, index + 1));
        } catch (_error) {
          return null;
        }
      }
    }
  }

  return null;
}

function makeValidationError(reason, message, details = {}, statusCode = 422) {
  const error = new Error(message || reason);
  error.code = reason;
  error.statusCode = statusCode;
  error.details = {
    reason,
    message: message || reason,
    ...details
  };
  return error;
}

class AgentRuntime {
  constructor(options = {}) {
    this.llmProvider = options.llmProvider || new LLMProvider(options.llm);
    this.getBlockchainRuntime = options.getBlockchainRuntime;
    this.defaultDailyLimit = readPositiveBigInt(
      options.defaultDailyLimit || process.env.DEFAULT_DAILY_LIMIT,
      "DEFAULT_DAILY_LIMIT"
    );
    this.testModeLimit = readTestModeLimitWei(options);
    this.defaultPaymentIntentAmount = options.defaultPaymentIntentAmount
      || process.env.PAYMENT_INTENT_AMOUNT
      || process.env.DEFAULT_PAYMENT_INTENT_AMOUNT
      || DEFAULT_PAYMENT_INTENT_AMOUNT_QUSDC;
    this.defaultAgentId = options.defaultAgentId || process.env.AGENT_ID || "1";
    this.defaultReceiver = options.defaultReceiver || process.env.AGENT_RECEIVER;
    this.defaultStreamId = options.defaultStreamId || process.env.AGENT_STREAM_ID;
    this.status = "idle";
    this.currentRun = null;
    this.history = [];
    this.intentHistory = [];
    this.pendingApprovals = new Map();
    this.intentDedupWindowMs = Number(options.intentDedupWindowMs || process.env.PAYMENT_INTENT_DEDUP_WINDOW_MS || 15000);
    this.policy = normalizePolicy(options.policy || {});
    this.allowanceCache = options.allowanceCache || new Map();
    this.allowanceManager = options.allowanceManager || new AllowanceManager({
      cache: this.allowanceCache,
      approvalPolicy: options.approvalPolicy,
      approvalAmountWei: options.approvalAmountWei
    });
    this.queue = Promise.resolve();

    if (!this.getBlockchainRuntime) {
      throw new Error("AgentRuntime requires getBlockchainRuntime");
    }
  }

  run(input) {
    return this._enqueue(() => this._run(input));
  }

  submitPaymentIntent(input) {
    return this._enqueue(() => this._submitPaymentIntent(input));
  }

  getHistory(limit = 50) {
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 500);
    return this.history.slice(0, safeLimit);
  }

  getIntentHistory(limit = 50) {
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 500);
    return this.intentHistory.slice(0, safeLimit);
  }

  getPendingApprovals(limit = 50) {
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 500);
    return Array.from(this.pendingApprovals.values())
      .sort((left, right) => new Date(right.updatedAt || right.createdAt || 0) - new Date(left.updatedAt || left.createdAt || 0))
      .slice(0, safeLimit)
      .map((record) => bigintJson(record));
  }

  getStatus() {
    return {
      status: this.status,
      totalRuns: this.history.length,
      totalIntents: this.intentHistory.length,
      pendingApprovals: this.pendingApprovals.size,
      lastRun: this.history[0] || null,
      policy: this.getPolicy()
    };
  }

  getPolicy() {
    return bigintJson({
      ...this.policy,
      whitelistRecipients: [...(this.policy.whitelistRecipients || [])]
    });
  }

  setPolicy(policy = {}) {
    this.policy = normalizePolicy({
      ...this.policy,
      ...policy
    });
    return this.getPolicy();
  }

  async _submitPaymentIntent(input) {
    const runId = crypto.randomUUID();
    const startedAt = nowIso();
    let intent;

    try {
      intent = this._normalizePaymentIntent(input);
    } catch (error) {
      const rejection = this._normalizeIntentError(error);
      const record = {
        runId,
        intentId: input?.intentId || input?.id || runId,
        eventType: "payment_intent",
        source: "payment_intent",
        task: input?.metadata?.task || input?.metadata?.source || "payment intent",
        agentId: input?.agentId === undefined ? null : String(input.agentId),
        startedAt,
        timestamp: startedAt,
        status: "rejected",
        intent: {
          intentId: input?.intentId || input?.id || runId,
          recipient: input?.recipient || input?.receiver || null,
          amountWei: input?.amountWei || null,
          amount: input?.amount || null,
          agentId: input?.agentId || null,
          streamId: input?.streamId || null,
          metadata: input?.metadata || null,
          receivedAt: startedAt
        },
        validation: rejection,
        decision: {
          source: "agent_policy_engine",
          action: "reject",
          reasoning: rejection.message
        },
        budget: null,
        transaction: null,
        error: rejection.message,
        completedAt: nowIso()
      };
      this._storeIntent(record);
      return bigintJson({
        ok: false,
        accepted: false,
        status: "rejected",
        intentId: record.intentId,
        runId,
        agentId: record.agentId,
        validation: rejection,
        decision: record.decision,
        error: rejection.message
      });
    }

    const fingerprint = this._buildPaymentIntentFingerprint(intent);
    const duplicate = fingerprint ? this._findRecentPaymentIntentByFingerprint(fingerprint) : null;
    if (duplicate) {
      return bigintJson({
        ok: true,
        accepted: true,
        duplicate: true,
        status: "duplicate",
        originalStatus: duplicate.status || null,
        intentId: duplicate.intentId || null,
        runId: duplicate.runId || null,
        agentId: duplicate.agentId || null,
        validation: duplicate.validation || null,
        decision: duplicate.decision || null,
        approval: duplicate.approval || null,
        transaction: duplicate.transaction || null,
        message: duplicate.status === "executed"
          ? "Duplicate payment intent ignored; the same payment already executed."
          : duplicate.status === "pending_approval"
            ? "Duplicate payment intent ignored; the same payment is already pending approval."
            : "Duplicate payment intent ignored; an identical payment intent already exists."
      });
    }

    this.status = "validating_intent";
    const policy = intent.policy || this.getPolicy();
    this.currentRun = {
      runId,
      intentId: intent.intentId,
      agentId: intent.agentId.toString(),
      startedAt,
      type: "payment_intent"
    };

    const record = {
      runId,
      intentId: intent.intentId,
      eventType: "payment_intent",
      source: "payment_intent",
      task: intent.metadata?.task || intent.metadata?.source || "payment intent",
      agentId: intent.agentId.toString(),
      startedAt,
      timestamp: startedAt,
      status: "received",
      fingerprint,
      intent: this._publicIntent(intent),
      validation: null,
      decision: null,
      budget: null,
      approval: null,
      timeline: [],
      transaction: null,
      error: null
    };

    this._storeIntent(record);

    let validationPassed = false;
    try {
      const runtime = await this.getBlockchainRuntime();
      const evaluation = await this._evaluatePaymentIntent(runtime, intent);
      record.validation = evaluation.validation;
      record.budget = evaluation.context.budget;
      record.decision = evaluation.decision;
      record.approval = {
        required: Boolean(evaluation.requiresApproval),
        status: evaluation.requiresApproval ? "pending" : "approved",
        thresholdWei: evaluation.validation?.policy?.manualApprovalThresholdWei || policy.manualApprovalThresholdWei || null,
        mode: evaluation.validation?.policy?.manualApprovalEnabled ?? Boolean(policy.manualApprovalEnabled),
        reason: evaluation.requiresApproval
          ? "Manual approval required before execution."
          : "Intent approved for execution."
      };
      record.timeline = buildIntentTimeline({
        ...record,
        validation: evaluation.validation,
        approval: record.approval
      });

      if (!evaluation.accepted) {
        record.status = "rejected";
        record.completedAt = nowIso();
        record.timeline = buildIntentTimeline({
          ...record,
          status: "rejected",
          completedAt: record.completedAt,
          approval: record.approval
        });
        this._replaceIntent(record);
        runtime.ledger?.append?.({
          eventType: "payment_intent",
          status: "rejected",
          runId,
          intentId: intent.intentId,
          agentId: intent.agentId,
          intent: this._publicIntent(intent),
          validation: evaluation.validation,
          decision: evaluation.decision
        });

        return bigintJson({
          ok: false,
          accepted: false,
          status: "rejected",
          intentId: intent.intentId,
          runId,
          agentId: intent.agentId,
          validation: evaluation.validation,
          decision: evaluation.decision
        });
      }

      if (evaluation.requiresApproval) {
        record.status = "pending_approval";
        record.approval = {
          ...record.approval,
          status: "pending",
          requestedAt: nowIso(),
          reason: record.approval.reason
        };
        record.timeline = buildIntentTimeline({
          ...record,
          status: "pending_approval",
          approval: record.approval
        });
        this._pendingApprovalsUpsert(record);
        this._replaceIntent(record);
        runtime.ledger?.append?.({
          eventType: "payment_intent",
          status: "pending_approval",
          runId,
          intentId: intent.intentId,
          agentId: intent.agentId,
          intent: this._publicIntent(intent),
          validation: evaluation.validation,
          decision: evaluation.decision,
          approval: record.approval
        });

        return bigintJson({
          ok: true,
          accepted: true,
          status: "pending_approval",
          intentId: intent.intentId,
          runId,
          agentId: intent.agentId,
          validation: evaluation.validation,
          decision: evaluation.decision,
          approval: record.approval,
          pendingApproval: true
        });
      }

      this.status = "executing_intent";
      validationPassed = true;
      const spendPlan = await this._planSpend(runtime, intent.agentId, intent.amountWei, {
        receiver: intent.recipient,
        streamId: intent.streamId,
        task: record.task
      });
      await this._assertBackendLimit(evaluation.context, spendPlan.amountWei);
      await this._assertOnChainLimit(runtime, intent.agentId, spendPlan.amountWei);

      const txRecord = await this._executeSpend(runtime, intent.agentId, spendPlan, {
        receiver: intent.recipient,
        streamId: intent.streamId,
        task: record.task,
        intentId: intent.intentId
      });
      record.transaction = txRecord;
      record.status = "executed";
      record.completedAt = nowIso();
      record.timeline = buildIntentTimeline({
        ...record,
        completedAt: record.completedAt,
        execution: {
          status: "confirmed",
          completedAt: record.completedAt,
          reason: "Payment intent executed successfully."
        }
      });
      this._replaceIntent(record);
      this._pendingApprovalsDelete(intent.intentId);

      runtime.ledger?.append?.({
        eventType: "payment_intent",
        status: "executed",
        runId,
        intentId: intent.intentId,
        agentId: intent.agentId,
        intent: this._publicIntent(intent),
        validation: evaluation.validation,
        decision: evaluation.decision,
        transaction: txRecord
      });

      return bigintJson({
        ok: true,
        accepted: true,
        status: "executed",
        intentId: intent.intentId,
        runId,
        agentId: intent.agentId,
        validation: evaluation.validation,
        decision: evaluation.decision,
        transaction: txRecord,
        receipt: txRecord.executePayment || null
      });
    } catch (error) {
      const rejection = this._normalizeIntentError(error);
      record.status = validationPassed ? "failed" : "rejected";
      record.validation = record.validation || rejection;
      record.error = rejection.message;
      record.execution = validationPassed
        ? {
            status: "failed",
            reason: rejection.reason,
            message: rejection.message,
            details: rejection.details || null
          }
        : null;
      record.completedAt = nowIso();
      record.timeline = buildIntentTimeline({
        ...record,
        completedAt: record.completedAt,
        execution: record.execution
      });
      this._replaceIntent(record);
      if (record.status !== "pending_approval") {
        this._pendingApprovalsDelete(intent.intentId);
      }

      try {
        const runtime = await this.getBlockchainRuntime();
        runtime.ledger?.append?.({
          eventType: "payment_intent",
          status: validationPassed ? "failed" : "rejected",
          runId,
          intentId: intent.intentId,
          agentId: intent.agentId,
          intent: this._publicIntent(intent),
          validation: record.validation,
          execution: record.execution
        });
      } catch (_ledgerError) {
        // Validation errors can occur before blockchain runtime is available.
      }

      return bigintJson({
        ok: false,
        accepted: validationPassed,
        status: record.status,
        intentId: intent.intentId,
        runId,
        agentId: intent.agentId,
        validation: record.validation,
        execution: record.execution,
        error: rejection.message
      });
    } finally {
      this.status = "idle";
      this.currentRun = null;
    }
  }

  async previewPaymentIntent(input) {
    const intent = this._normalizePaymentIntent(input);
    const runtime = await this.getBlockchainRuntime();
    const evaluation = await this._evaluatePaymentIntent(runtime, intent, { recordLedger: false, previewOnly: true });
    return bigintJson(this._buildIntentPreview(intent, evaluation));
  }

  async approvePaymentIntent(intentId, input = {}) {
    const key = String(intentId || "");
    const pending = this.pendingApprovals.get(key);
    if (!pending) {
      throw makeValidationError("INTENT_NOT_PENDING", `intent ${key || "unknown"} is not pending approval`, { intentId: key }, 404);
    }

    const runtime = await this.getBlockchainRuntime();
    const evaluation = await this._evaluatePaymentIntent(runtime, pending.intent, { recordLedger: false, previewOnly: false });
    pending.record.validation = evaluation.validation;
    pending.record.decision = evaluation.decision;
    pending.record.budget = evaluation.context.budget;

    if (!evaluation.accepted) {
      pending.record.status = "rejected";
      pending.record.error = evaluation.validation?.reason || "INTENT_REJECTED";
      pending.record.completedAt = nowIso();
      pending.record.execution = {
        status: "failed",
        reason: pending.record.error,
        message: "Validation failed during approval."
      };
      pending.record.approval = {
        ...pending.record.approval,
        status: "rejected",
        completedAt: pending.record.completedAt,
        reason: pending.record.error
      };
      pending.record.timeline = buildIntentTimeline(pending.record);
      this._replaceIntent(pending.record);
      this._pendingApprovalsDelete(key);
      return bigintJson({
        ok: false,
        accepted: false,
        status: "rejected",
        intentId: pending.record.intentId,
        validation: evaluation.validation,
        decision: evaluation.decision,
        error: pending.record.error
      });
    }

    this.status = "executing_intent";
    this.currentRun = {
      runId: pending.record.runId,
      intentId: pending.record.intentId,
      agentId: pending.intent.agentId.toString(),
      startedAt: pending.record.startedAt,
      type: "payment_intent_approval"
    };

    try {
      const spendPlan = await this._planSpend(runtime, pending.intent.agentId, pending.intent.amountWei, {
        receiver: pending.intent.recipient,
        streamId: pending.intent.streamId,
        task: pending.record.task
      });
      await this._assertBackendLimit(evaluation.context, spendPlan.amountWei);
      await this._assertOnChainLimit(runtime, pending.intent.agentId, spendPlan.amountWei);

      const txRecord = await this._executeSpend(runtime, pending.intent.agentId, spendPlan, {
        receiver: pending.intent.recipient,
        streamId: pending.intent.streamId,
        task: pending.record.task,
        intentId: pending.intent.intentId
      });
      pending.record.transaction = txRecord;
      pending.record.status = "executed";
      pending.record.completedAt = nowIso();
      pending.record.approval = {
        ...pending.record.approval,
        status: "approved",
        completedAt: pending.record.completedAt,
        approvedBy: input?.approvedBy || null,
        reason: input?.reason || "Approved by user"
      };
      pending.record.execution = {
        status: "confirmed",
        reason: "Payment intent executed after human approval.",
        txHash: txRecord.executePayment?.txHash || txRecord.txHash || null
      };
      pending.record.timeline = buildIntentTimeline(pending.record);
      this._replaceIntent(pending.record);
      this._pendingApprovalsDelete(key);

      runtime.ledger?.append?.({
        eventType: "payment_intent",
        status: "executed",
        intentId: pending.intent.intentId,
        agentId: pending.intent.agentId,
        intent: this._publicIntent(pending.intent),
        validation: evaluation.validation,
        decision: evaluation.decision,
        transaction: txRecord,
        approval: pending.record.approval
      });

      return bigintJson({
        ok: true,
        accepted: true,
        status: "executed",
        intentId: pending.intent.intentId,
        validation: evaluation.validation,
        decision: evaluation.decision,
        transaction: txRecord,
        approval: pending.record.approval,
        receipt: txRecord.executePayment || null
      });
    } catch (error) {
      const rejection = this._normalizeIntentError(error);
      pending.record.status = "failed";
      pending.record.error = rejection.message;
      pending.record.execution = {
        status: "failed",
        reason: rejection.reason,
        message: rejection.message,
        details: rejection.details || null
      };
      pending.record.completedAt = nowIso();
      pending.record.timeline = buildIntentTimeline(pending.record);
      this._replaceIntent(pending.record);
      this._pendingApprovalsDelete(key);
      throw error;
    } finally {
      this.status = "idle";
      this.currentRun = null;
    }
  }

  async rejectPaymentIntent(intentId, input = {}) {
    const key = String(intentId || "");
    const pending = this.pendingApprovals.get(key);
    if (!pending) {
      throw makeValidationError("INTENT_NOT_PENDING", `intent ${key || "unknown"} is not pending approval`, { intentId: key }, 404);
    }

    pending.record.status = "rejected";
    pending.record.error = input?.reason || "Rejected by user";
    pending.record.completedAt = nowIso();
    pending.record.approval = {
      ...pending.record.approval,
      status: "rejected",
      completedAt: pending.record.completedAt,
      reason: pending.record.error
    };
    pending.record.execution = {
      status: "failed",
      reason: "INTENT_REJECTED",
      message: pending.record.error
    };
    pending.record.timeline = buildIntentTimeline(pending.record);
    this._replaceIntent(pending.record);
    this._pendingApprovalsDelete(key);
    return bigintJson({
      ok: true,
      accepted: false,
      status: "rejected",
      intentId: pending.record.intentId,
      approval: pending.record.approval,
      error: pending.record.error
    });
  }

  async _run(input) {
    const task = this._validateTask(input?.task || input?.prompt);
    const runId = crypto.randomUUID();
    const startedAt = nowIso();
    const agentId = toPositiveBigInt(input?.agentId || this.defaultAgentId, "agentId");

    this.status = "running";
    this.currentRun = { runId, task, agentId: agentId.toString(), startedAt };

    const record = {
      runId,
      task,
      agentId: agentId.toString(),
      startedAt,
      timestamp: startedAt,
      status: "running",
      decision: null,
      budget: null,
      transaction: null,
      error: null
    };

    if (process.env.ENABLE_LEGACY_AGENT_SPEND !== "true") {
      record.decision = {
        action: "hold",
        amount: 0,
        reasoning: "Legacy agent runs no longer trigger payment execution. Submit a payment intent to request execution."
      };
      record.status = "held";
      record.completedAt = nowIso();
      this._store(record);
      this.status = "idle";
      this.currentRun = null;
      return bigintJson(record);
    }

    try {
      const runtime = await this.getBlockchainRuntime();
      const context = await this._buildDecisionContext(runtime, agentId);
      record.budget = context.budget;

      const decisionResult = await this.llmProvider.decideEconomicAction({
        task,
        budgetRemaining: context.safeSpendLimitQie,
        safeSpendLimit: context.safeSpendLimitQie,
        recentHistory: context.recentHistory
      });

      const decision = this._parseDecision(decisionResult.content, context.safeSpendLimitQie);
      const clampedDecision = this._clampDecision(decision, context.safeSpendLimitWei);
      record.decision = {
        ...clampedDecision,
        model: decisionResult.model,
        usage: decisionResult.usage || null,
        providerResponseId: decisionResult.providerResponseId || null
      };

      if (clampedDecision.action === "hold") {
        record.status = "held";
        record.completedAt = nowIso();
        this._store(record);
        return bigintJson(record);
      }

      const requestedAmountWei = this._qieToWei(clampedDecision.amount);
      await this._assertBackendLimit(context, requestedAmountWei);

      const spendPlan = await this._planSpend(runtime, agentId, requestedAmountWei, input);
      await this._assertBackendLimit(context, spendPlan.amountWei);
      await this._assertOnChainLimit(runtime, agentId, spendPlan.amountWei);

      const txRecord = await this._executeSpend(runtime, agentId, spendPlan, input);
      record.transaction = txRecord;
      record.status = "spent";
      record.completedAt = nowIso();

      this._store(record);
      return bigintJson(record);
    } catch (error) {
      record.status = "failed";
      record.error = error.shortMessage || error.message;
      record.completedAt = nowIso();
      this._store(record);
      throw error;
    } finally {
      this.status = "idle";
      this.currentRun = null;
    }
  }

  _normalizePaymentIntent(input = {}) {
    input = input && typeof input === "object" ? input : {};
    const recipient = normalizeAddress(input.recipient || input.receiver);
    if (!recipient) {
      throw makeValidationError("INVALID_RECIPIENT", "recipient must be a valid address", {
        recipient: input.recipient || input.receiver || null
      }, 400);
    }

    let agentId;
    let amountWei;
    let streamId;
    try {
      agentId = toPositiveBigInt(input.agentId || this.defaultAgentId, "agentId");
    } catch (error) {
      throw makeValidationError("INVALID_AGENT_ID", error.message, { agentId: input.agentId || this.defaultAgentId }, 400);
    }
    try {
      amountWei = input.amountWei !== undefined && input.amountWei !== null && input.amountWei !== ""
        ? toPositiveBigInt(input.amountWei, "amountWei")
        : parseQieToWei(
          input.amount === undefined || input.amount === null || input.amount === ""
            ? this.defaultPaymentIntentAmount
            : input.amount,
          "amount"
        );
    } catch (error) {
      throw makeValidationError("INVALID_AMOUNT", error.message, {
        amount: input.amount || null,
        amountWei: input.amountWei || null
      }, 400);
    }
    try {
      streamId = input.streamId === undefined || input.streamId === null || input.streamId === ""
        ? null
        : toPositiveBigInt(input.streamId, "streamId");
    } catch (error) {
      throw makeValidationError("INVALID_STREAM_ID", error.message, { streamId: input.streamId }, 400);
    }

    const policy = normalizePolicy(input.policy || {});

    return {
      intentId: input.intentId || input.id || crypto.randomUUID(),
      recipient,
      amountWei,
      amount: ethers.formatUnits(amountWei, 18),
      agentId,
      streamId,
      policy,
      metadata: normalizeMetadata(input.metadata),
      receivedAt: nowIso()
    };
  }

  _buildPaymentIntentFingerprint(intentOrInput = {}) {
    try {
      const source = intentOrInput && typeof intentOrInput === "object" ? intentOrInput : {};
      const recipient = normalizeAddress(source.recipient || source.receiver);
      const agentId = source.agentId === undefined || source.agentId === null || source.agentId === ""
        ? toPositiveBigInt(this.defaultAgentId, "agentId")
        : toPositiveBigInt(source.agentId, "agentId");
      const amountWei = source.amountWei !== undefined && source.amountWei !== null && source.amountWei !== ""
        ? toPositiveBigInt(source.amountWei, "amountWei")
        : parseQieToWei(
          source.amount === undefined || source.amount === null || source.amount === ""
            ? this.defaultPaymentIntentAmount
            : source.amount,
          "amount"
        );
      const streamId = source.streamId === undefined || source.streamId === null || source.streamId === ""
        ? "none"
        : toPositiveBigInt(source.streamId, "streamId").toString();
      const metadata = normalizeMetadata(source.metadata) || {};
      const policy = normalizePolicy(source.policy || {});

      return [
        agentId.toString(),
        recipient.toLowerCase(),
        amountWei.toString(),
        streamId,
        metadata.task || "",
        metadata.category || "",
        metadata.description || "",
        metadata.templateId || "",
        policy.manualApprovalEnabled ? "1" : "0",
        policy.manualApprovalThresholdWei || "",
        policy.maxPaymentAmountWei || "",
        policy.maxPaymentsPerDay || "",
        (policy.whitelistRecipients || []).join(",")
      ].join("|");
    } catch (_error) {
      return null;
    }
  }

  _findRecentPaymentIntentByFingerprint(fingerprint) {
    if (!fingerprint || !this.intentDedupWindowMs) {
      return null;
    }

    const cutoff = Date.now() - this.intentDedupWindowMs;
    return this.intentHistory.find((record) => {
      if (record.fingerprint !== fingerprint) return false;
      const timestamp = new Date(record.startedAt || record.timestamp || record.completedAt || 0).getTime();
      return Number.isFinite(timestamp) && timestamp >= cutoff;
    }) || null;
  }

  _publicIntent(intent) {
    return bigintJson({
      intentId: intent.intentId,
      recipient: intent.recipient,
      amountWei: intent.amountWei,
      amount: intent.amount,
      agentId: intent.agentId,
      streamId: intent.streamId,
      policy: intent.policy || null,
      metadata: intent.metadata,
      receivedAt: intent.receivedAt
    });
  }

  async _evaluatePaymentIntent(runtime, intent, options = {}) {
    this._ensureRuntimeQusdc(runtime);
    const { contracts, ledger } = runtime;
    const policy = normalizePolicy(intent.policy || this.policy);
    const previewOnly = Boolean(options.previewOnly);
    let agent;
    try {
      agent = await contracts.registry.getAgent(intent.agentId);
    } catch (error) {
      throw makeValidationError("AGENT_NOT_FOUND", `agent ${intent.agentId.toString()} was not found`, {
        agentId: intent.agentId.toString(),
        cause: error.shortMessage || error.message
      }, 404);
    }
    const context = await this._buildDecisionContext(runtime, intent.agentId);
    const [budget, vaultWhitelisted, canSpendFor] = await Promise.all([
      contracts.controller.getBudget(intent.agentId),
      contracts.controller.isServiceWhitelisted(intent.agentId, contracts.addresses.vault),
      contracts.controller.canSpendFor(intent.agentId, contracts.addresses.vault, intent.amountWei)
    ]);
    const signerAddress = await contracts.signer.getAddress();
    const vaultAllowance = BigInt(await contracts.qusdc.allowance(signerAddress, contracts.addresses.vault));
    const [ownerBinding, walletBinding, passBinding] = await Promise.all([
      contracts.registry.ownerAgentId(agent.owner),
      contracts.registry.executionWalletAgentId(agent.agentWallet),
      contracts.registry.qiePassAgentId(agent.qiePassId)
    ]);
    const dailyLimit = BigInt(budget.dailyLimit || 0);
    const spentToday = BigInt(budget.spentToday || 0);
    const controllerRemainingWei = dailyLimit > spentToday ? dailyLimit - spentToday : 0n;
    const qiePass = {
      active: Boolean(agent.active),
      hasQiePassId: Boolean(agent.qiePassId) && !ZERO_BYTES32.test(agent.qiePassId),
      ownerBound: BigInt(ownerBinding || 0) === BigInt(intent.agentId),
      walletBound: BigInt(walletBinding || 0) === BigInt(intent.agentId),
      passBound: BigInt(passBinding || 0) === BigInt(intent.agentId),
      vaultWhitelisted: Boolean(vaultWhitelisted)
    };
    const todayStatuses = ["received", "pending_approval", "executed"];
    const sameDayIntents = this.intentHistory.filter((record) => (
      String(record.agentId) === String(intent.agentId)
        && String(record.intentId) !== String(intent.intentId)
        && todayStatuses.includes(record.status)
        && new Date(record.completedAt || record.timestamp || record.startedAt || 0).getTime() >= startOfUtcDay()
    ));
    const maxPaymentsPerDay = Number.isFinite(Number(policy.maxPaymentsPerDay)) && Number(policy.maxPaymentsPerDay) > 0
      ? Number(policy.maxPaymentsPerDay)
      : null;
    const recipientWhitelisted = policy.whitelistRecipients.length === 0
      || policy.whitelistRecipients.some((allowed) => sameAddress(allowed, intent.recipient));
    const maxPaymentAmountWei = policy.maxPaymentAmountWei ? BigInt(policy.maxPaymentAmountWei) : null;
    const manualApprovalThresholdWei = policy.manualApprovalThresholdWei ? BigInt(policy.manualApprovalThresholdWei) : null;
    const manualApprovalEnabled = Boolean(policy.manualApprovalEnabled);
    const approvalRequired = manualApprovalEnabled && (
      manualApprovalThresholdWei === null || intent.amountWei >= manualApprovalThresholdWei
    );
    const checks = {
      agentExists: true,
      agentActive: Boolean(agent.active),
      qiePassValid: Object.values(qiePass).every(Boolean),
      operatorAuthorized: sameAddress(signerAddress, agent.owner) || sameAddress(signerAddress, agent.agentWallet),
      paused: Boolean(budget.paused),
      dailyLimitExceeded: false,
      notWhitelisted: !Boolean(vaultWhitelisted),
      controllerRejected: !Boolean(canSpendFor),
      exceedsSafeSpendLimit: false,
      allowanceSufficient: vaultAllowance >= intent.amountWei,
      streamValid: false,
      liquidityAvailable: false,
      recipientWhitelisted,
      maxPaymentAmountExceeded: maxPaymentAmountWei !== null ? intent.amountWei > maxPaymentAmountWei : false,
      maxPaymentsPerDayExceeded: maxPaymentsPerDay !== null ? sameDayIntents.length >= maxPaymentsPerDay : false,
      manualApprovalRequired: approvalRequired
    };
    const stream = await this._inspectIntentStream(runtime, intent);
    checks.streamValid = Boolean(stream.valid);
    const liquidity = await this._inspectIntentLiquidity(runtime, intent.amountWei);
    const executionContext = this._contextWithIntentLiquidity(context, liquidity, {
      dailyLimit,
      spentToday,
      remainingWei: controllerRemainingWei
    });
    const budgetRemainingWei = controllerRemainingWei;
    checks.liquidityAvailable = Boolean(liquidity.available);
    checks.dailyLimitExceeded = dailyLimit === 0n || intent.amountWei > budgetRemainingWei;
    checks.exceedsSafeSpendLimit = intent.amountWei > BigInt(executionContext.safeSpendLimitWei || 0);

    const rejectionReasons = [];
    if (!checks.agentActive) rejectionReasons.push("AGENT_INACTIVE");
    if (!checks.qiePassValid) rejectionReasons.push("QIE_PASS_INVALID");
    if (!checks.operatorAuthorized) rejectionReasons.push("UNAUTHORIZED_AGENT_OPERATOR");
    if (checks.paused) rejectionReasons.push("AGENT_PAUSED");
    if (!checks.recipientWhitelisted) rejectionReasons.push("RECIPIENT_NOT_WHITELISTED");
    if (checks.maxPaymentAmountExceeded) rejectionReasons.push("MAX_PAYMENT_AMOUNT_EXCEEDED");
    if (checks.maxPaymentsPerDayExceeded) rejectionReasons.push("MAX_PAYMENTS_PER_DAY_EXCEEDED");
    if (checks.notWhitelisted) rejectionReasons.push("SERVICE_NOT_WHITELISTED");
    if (checks.dailyLimitExceeded) rejectionReasons.push("DAILY_LIMIT_EXCEEDED");
    if (checks.controllerRejected) rejectionReasons.push("CONTROLLER_REJECTED");
    if (checks.exceedsSafeSpendLimit) rejectionReasons.push("SAFE_SPEND_LIMIT_EXCEEDED");
    if (!checks.streamValid) rejectionReasons.push(stream.reason || "STREAM_INVALID");
    if (!checks.liquidityAvailable) rejectionReasons.push(liquidity.reason || "LIQUIDITY_UNAVAILABLE");
    const constraintFailures = this._buildIntentConstraintFailures({
      checks,
      intent,
      budget: {
        dailyLimit,
        spentToday,
        remainingWei: budgetRemainingWei,
        safeSpendLimitWei: BigInt(executionContext.safeSpendLimitWei || 0),
        maxPaymentAmountWei: maxPaymentAmountWei?.toString?.() || null,
        maxPaymentsPerDay,
        maxPaymentsToday: sameDayIntents.length
      },
      operator: {
        vaultAllowance
      },
      stream,
      liquidity
    });

    const accepted = rejectionReasons.length === 0;
    const validation = bigintJson({
      status: accepted ? "accepted" : "rejected",
      reason: accepted ? null : rejectionReasons[0],
      reasons: rejectionReasons,
      checks,
      constraintFailures,
      qiePass,
      policy: {
        manualApprovalEnabled,
        manualApprovalThresholdWei: manualApprovalThresholdWei?.toString?.() || null,
        maxPaymentAmountWei: maxPaymentAmountWei?.toString?.() || null,
        maxPaymentsPerDay,
        whitelistRecipients: policy.whitelistRecipients
      },
      approvalRequired,
      budget: {
        dailyLimit,
        spentToday,
        safeSpendLimitWei: executionContext.safeSpendLimitWei,
        originalSafeSpendLimitWei: context.safeSpendLimitWei,
        remainingWei: context.budget.remainingWei,
        controllerRemainingWei: budgetRemainingWei,
        limitingConstraint: context.budget.limitingConstraint
      },
      operator: {
        signer: signerAddress,
        owner: agent.owner,
        agentWallet: agent.agentWallet,
        vaultAllowance: vaultAllowance.toString(),
        allowanceRequiredWei: intent.amountWei.toString(),
        allowanceManagedAtExecution: true
      },
      stream,
      liquidity
    });
    const decision = {
      source: "agent_policy_engine",
      action: accepted ? (approvalRequired ? "pending_approval" : "approve") : "reject",
      amount: intent.amount,
      amountWei: intent.amountWei.toString(),
      reasoning: accepted
        ? (approvalRequired
          ? "Payment intent satisfies validation rules and is awaiting human approval."
          : "Payment intent satisfies agent policy, QIE Pass, controller, budget, and liquidity checks.")
        : `Payment intent rejected: ${constraintFailures[0]?.name || rejectionReasons[0]} ${constraintFailures[0]?.actual !== undefined ? `actual=${constraintFailures[0].actual} expected=${constraintFailures[0].expected}` : rejectionReasons.join(", ")}`
    };

    if (!previewOnly) {
      ledger?.append?.({
        eventType: "payment_intent_validation",
        status: accepted ? "accepted" : "rejected",
        intentId: intent.intentId,
        agentId: intent.agentId,
        recipient: intent.recipient,
        amountWei: intent.amountWei,
        validation,
        decision
      });
    }

    return {
      accepted,
      requiresApproval: approvalRequired,
      validation,
      decision,
      context: executionContext,
      policy
    };
  }

  _contextWithIntentLiquidity(context, liquidity, controllerBudget = {}) {
    const values = [
      controllerBudget.dailyLimit,
      controllerBudget.remainingWei
    ]
      .map((value) => {
        try {
          return BigInt(value || 0);
        } catch (_error) {
          return 0n;
        }
      })
      .filter((value) => value > 0n);

    if (!liquidity.available && liquidity.source === "qusdc_balance") {
      try {
        const balance = BigInt(liquidity.balance || 0);
        if (balance > 0n) {
          values.push(balance);
        }
      } catch (_error) {
        // Keep budget-derived constraints only.
      }
    }

    if (values.length === 0) {
      return context;
    }

    const safeSpendLimitWei = values.reduce((current, next) => (next < current ? next : current));
    return {
      ...context,
      safeSpendLimitWei,
      safeSpendLimitQie: weiToQieNumber(safeSpendLimitWei),
      budget: {
        ...context.budget,
        safeSpendLimitWei: safeSpendLimitWei.toString(),
        liquidityAdjustedSafeSpendLimitWei: safeSpendLimitWei.toString(),
        remainingWei: controllerBudget.remainingWei?.toString?.() || context.budget.remainingWei,
        onChainDailyLimit: controllerBudget.dailyLimit?.toString?.() || context.budget.onChainDailyLimit,
        onChainSpentToday: controllerBudget.spentToday?.toString?.() || context.budget.onChainSpentToday,
        intentPolicyMode: "budget_primary",
        nonBlockingConstraints: {
          qusdcBalance: context.budget.qusdcBalance,
          testModeLimit: context.budget.testModeLimit,
          defaultDailyLimit: context.budget.defaultDailyLimit
        }
      }
    };
  }

  _buildIntentConstraintFailures({ checks, intent, budget, operator, stream, liquidity }) {
    const failures = [];
    const push = (name, expected, actual, reason) => {
      failures.push({
        name,
        reason,
        expected: expected?.toString?.() || expected,
        actual: actual?.toString?.() || actual
      });
    };

    if (!checks.agentActive) push("agentActive", true, false, "AGENT_INACTIVE");
    if (!checks.qiePassValid) push("qiePassValid", true, false, "QIE_PASS_INVALID");
    if (!checks.operatorAuthorized) push("operatorAuthorized", true, false, "UNAUTHORIZED_AGENT_OPERATOR");
    if (checks.paused) push("paused", false, true, "AGENT_PAUSED");
    if (!checks.recipientWhitelisted) push("recipientWhitelisted", true, false, "RECIPIENT_NOT_WHITELISTED");
    if (checks.maxPaymentAmountExceeded) {
      push("maxPaymentAmountWei", `>= ${intent.amountWei.toString()}`, budget.maxPaymentAmountWei || "unavailable", "MAX_PAYMENT_AMOUNT_EXCEEDED");
    }
    if (checks.maxPaymentsPerDayExceeded) {
      push("maxPaymentsPerDay", `<= ${budget.maxPaymentsPerDay || 0}`, budget.maxPaymentsToday || "unavailable", "MAX_PAYMENTS_PER_DAY_EXCEEDED");
    }
    if (checks.notWhitelisted) push("vaultWhitelisted", true, false, "SERVICE_NOT_WHITELISTED");
    if (checks.dailyLimitExceeded) {
      push("budgetRemainingWei", `>= ${intent.amountWei.toString()}`, budget.remainingWei, "DAILY_LIMIT_EXCEEDED");
    }
    if (checks.controllerRejected) push("controllerCanSpendFor", true, false, "CONTROLLER_REJECTED");
    if (checks.exceedsSafeSpendLimit) {
      push("safeSpendLimitWei", `>= ${intent.amountWei.toString()}`, budget.safeSpendLimitWei, "SAFE_SPEND_LIMIT_EXCEEDED");
    }
    if (!checks.streamValid) push("streamValid", true, false, stream.reason || "STREAM_INVALID");
    if (!checks.liquidityAvailable) {
      push("liquidityAvailable", true, false, liquidity.reason || "LIQUIDITY_UNAVAILABLE");
    }

    return failures;
  }

  _pendingApprovalsUpsert(record) {
    const stored = bigintJson({
      ...record,
      updatedAt: nowIso()
    });
    this.pendingApprovals.set(String(record.intentId), stored);
    return stored;
  }

  _pendingApprovalsDelete(intentId) {
    this.pendingApprovals.delete(String(intentId));
  }

  async _estimateIntentGasFee(runtime) {
    try {
      const recentPayments = this.intentHistory
        .filter((record) => record.status === "executed" && record.transaction?.executePayment?.gasUsed)
        .slice(0, 10);
      if (!recentPayments.length) {
        return null;
      }

      const totalGasUsed = recentPayments.reduce((total, record) => total + BigInt(record.transaction.executePayment.gasUsed), 0n);
      const averageGasUsed = totalGasUsed / BigInt(recentPayments.length);
      const feeData = await runtime.contracts.provider.getFeeData().catch(() => null);
      const gasPrice = feeData?.gasPrice || feeData?.maxFeePerGas || feeData?.lastBaseFeePerGas || null;
      if (!gasPrice || averageGasUsed <= 0n) {
        return null;
      }

      return {
        gasUsed: averageGasUsed.toString(),
        gasPrice: gasPrice.toString(),
        feeWei: (averageGasUsed * BigInt(gasPrice)).toString(),
        feeQie: ethers.formatUnits(averageGasUsed * BigInt(gasPrice), 18)
      };
    } catch (_error) {
      return null;
    }
  }

  async _buildIntentPreview(intent, evaluation) {
    const runtime = await this.getBlockchainRuntime();
    const budgetRemainingWei = BigInt(evaluation.context?.budget?.remainingWei || 0);
    const dailyRemainingWei = BigInt(evaluation.validation?.budget?.controllerRemainingWei || evaluation.context?.budget?.remainingWei || 0);
    const amountWei = BigInt(intent.amountWei || 0);
    const budgetAfterWei = budgetRemainingWei > amountWei ? budgetRemainingWei - amountWei : 0n;
    const dailyAfterWei = dailyRemainingWei > amountWei ? dailyRemainingWei - amountWei : 0n;
    const gasEstimate = await this._estimateIntentGasFee(runtime);
    const policy = evaluation.policy || intent.policy || this.getPolicy();
    const currentPolicyStatus = evaluation.accepted
      ? (evaluation.requiresApproval ? "Pending approval" : "Allowed")
      : "Blocked";
    const executionReadiness = evaluation.accepted
      ? (evaluation.requiresApproval ? "Awaiting approval" : "Ready")
      : "Blocked";
    const budgetRatio = budgetRemainingWei > 0n ? Number((amountWei * 10000n) / budgetRemainingWei) / 100 : 100;
    let riskLevel = "LOW";
    if (!evaluation.accepted) {
      riskLevel = "HIGH";
    } else if (evaluation.requiresApproval || budgetRatio >= 50 || policy.riskOverride === "MEDIUM") {
      riskLevel = "MEDIUM";
    }
    if (policy.riskOverride === "HIGH") {
      riskLevel = "HIGH";
    }

    return {
      intent: this._publicIntent(intent),
      recipient: intent.recipient,
      amount: intent.amount,
      token: "QUSDC",
      estimatedGas: gasEstimate ? {
        ...gasEstimate,
        label: `${gasEstimate.feeQie} QIE`
      } : null,
      budgetRemainingAfterPayment: ethers.formatUnits(budgetAfterWei, 18),
      dailySpendingRemaining: ethers.formatUnits(dailyAfterWei, 18),
      policyStatus: currentPolicyStatus,
      riskLevel,
      executionReadiness,
      validation: evaluation.validation,
      decision: evaluation.decision,
      approvalRequired: Boolean(evaluation.requiresApproval),
      policy,
      reasons: evaluation.validation?.reasons || [],
      available: evaluation.accepted && !evaluation.requiresApproval,
      details: evaluation.accepted
        ? (evaluation.requiresApproval
          ? "Intent validated and queued for manual approval."
          : "Intent is ready for execution.")
        : summarizeReason(evaluation.validation?.reason || evaluation.validation?.reasons)
    };
  }

  async _inspectIntentStream(runtime, intent) {
    if (!intent.streamId) {
      return {
        valid: true,
        mode: "instant",
        streamId: null
      };
    }

    try {
      const stream = await runtime.contracts.vault.getStream(intent.streamId);
      const ratePerUnit = BigInt(stream.ratePerUnit || 0);
      const amount = BigInt(intent.amountWei);
      const receiverMatches = sameAddress(stream.receiver, intent.recipient);
      const agentMatches = BigInt(stream.agentId) === BigInt(intent.agentId);
      const units = ratePerUnit > 0n ? amount / ratePerUnit : 0n;
      const remainder = ratePerUnit > 0n ? amount % ratePerUnit : amount;
      const valid = Boolean(stream.active)
        && agentMatches
        && receiverMatches
        && ratePerUnit > 0n
        && units > 0n
        && remainder === 0n;
      let reason = null;
      if (!stream.active) reason = "STREAM_INACTIVE";
      else if (!agentMatches) reason = "STREAM_AGENT_MISMATCH";
      else if (!receiverMatches) reason = "STREAM_RECIPIENT_MISMATCH";
      else if (ratePerUnit <= 0n) reason = "STREAM_RATE_INVALID";
      else if (units <= 0n) reason = "AMOUNT_BELOW_STREAM_RATE";
      else if (remainder !== 0n) reason = "AMOUNT_NOT_DIVISIBLE_BY_STREAM_RATE";

      return bigintJson({
        valid,
        reason,
        mode: "stream",
        streamId: intent.streamId,
        agentId: stream.agentId,
        receiver: stream.receiver,
        active: stream.active,
        ratePerUnit,
        units,
        remainder
      });
    } catch (error) {
      return {
        valid: false,
        reason: "STREAM_NOT_FOUND",
        mode: "stream",
        streamId: intent.streamId.toString(),
        message: error.shortMessage || error.message
      };
    }
  }

  async _inspectIntentLiquidity(runtime, amountWei) {
    this._ensureRuntimeQusdc(runtime);
    const { contracts, liquidityEngine } = runtime;
    const owner = await contracts.signer.getAddress();
    const amount = BigInt(amountWei);
    const balance = BigInt(await contracts.qusdc.balanceOf(owner));

    if (balance >= amount) {
      return {
        available: true,
        reason: null,
        source: "qusdc_balance",
        balance: balance.toString(),
        requiredAmount: amount.toString()
      };
    }

    if (isMockQusdcMode()) {
      return {
        available: false,
        reason: "INSUFFICIENT_MOCK_QUSDC",
        source: "mock_qusdc",
        balance: balance.toString(),
        requiredAmount: amount.toString()
      };
    }

    if (!liquidityEngine) {
      return {
        available: false,
        reason: "LIQUIDITY_ENGINE_UNAVAILABLE",
        source: "qiedex",
        balance: balance.toString(),
        requiredAmount: amount.toString()
      };
    }

    const liquidity = typeof liquidityEngine.inspectLiquidity === "function"
      ? await liquidityEngine.inspectLiquidity(contracts.addresses.wqie, contracts.addresses.qusdc)
      : {
          hasLiquidity: Boolean(await liquidityEngine.checkPairExists(contracts.addresses.wqie, contracts.addresses.qusdc)),
          pair: await liquidityEngine.checkPairExists(contracts.addresses.wqie, contracts.addresses.qusdc),
          reason: null
        };

    return {
      available: Boolean(liquidity.hasLiquidity && liquidity.pair && liquidity.pair.toLowerCase?.() !== ZERO_ADDRESS),
      reason: liquidity.hasLiquidity ? null : liquidity.reason || "NO_LIQUIDITY_SKIP_SWAP",
      source: "qiedex",
      balance: balance.toString(),
      requiredAmount: amount.toString(),
      pair: liquidity.pair || null,
      diagnostic: liquidity.diagnostic || null
    };
  }

  _normalizeIntentError(error) {
    let parsed = error.details || null;
    if (!parsed && typeof error.message === "string" && error.message.trim().startsWith("{")) {
      try {
        parsed = JSON.parse(error.message);
      } catch (_parseError) {
        parsed = null;
      }
    }

    const reason = parsed?.reason || error.code || "PAYMENT_INTENT_REJECTED";
    return bigintJson({
      status: parsed?.status || (reason === "APPROVAL_FAILED" ? "failed" : "rejected"),
      reason,
      reasons: parsed?.reasons || [reason],
      message: parsed?.message || error.shortMessage || error.reason || error.message || String(error),
      checks: parsed?.checks || null,
      details: parsed || null
    });
  }

  _resolveQusdcAddress(runtime) {
    const { contracts } = runtime;
    const candidateQusdc = isMockQusdcMode()
      ? (
          process.env.MOCK_QUSDC_ADDRESS
          || contracts.deployment?.addresses?.mockQUSDC
          || contracts.deployment?.addresses?.mockQusdc
          || contracts.deployment?.mockQUSDC
          || contracts.deployment?.mockQusdc
          || process.env.QUSDC_ADDRESS
          || contracts.deployment?.addresses?.qusdc
          || contracts.deployment?.qusdc
          || contracts.addresses?.qusdc
        )
      : (
          process.env.QUSDC_ADDRESS
          || contracts.deployment?.addresses?.qusdc
          || contracts.deployment?.qieStablecoin
          || contracts.deployment?.stable
          || contracts.deployment?.qusdc
          || contracts.addresses?.qusdc
        );
    const configuredQusdc = normalizeAddress(
      candidateQusdc
    );

    if (!configuredQusdc) {
      throw new Error(
        isMockQusdcMode()
          ? "QUSDC_MODE=mock requires MOCK_QUSDC_ADDRESS or a mockQUSDC address in the deployment config"
          : "QUSDC_ADDRESS is required or must be present in deployment config"
      );
    }
    if (sameAddress(configuredQusdc, contracts.addresses?.wqie)) {
      throw new Error(`QUSDC address resolves to WQIE address ${configuredQusdc}`);
    }
    if (sameAddress(configuredQusdc, contracts.addresses?.vault)) {
      throw new Error(`QUSDC address resolves to StreamVault address ${configuredQusdc}`);
    }

    return configuredQusdc;
  }

  _ensureRuntimeQusdc(runtime) {
    const { contracts } = runtime;
    const resolvedQusdc = this._resolveQusdcAddress(runtime);
    const currentQusdc = normalizeAddress(contracts.addresses?.qusdc);

    if (currentQusdc !== resolvedQusdc) {
      runtime.ledger?.append?.({
        eventType: "qusdc_config",
        status: "corrected",
        previousRuntimeQusdc: currentQusdc,
        runtimeQusdc: resolvedQusdc,
        source: process.env.QUSDC_ADDRESS ? "env" : "deployment"
      });
      contracts.addresses = {
        ...contracts.addresses,
        qusdc: resolvedQusdc
      };
      contracts.qusdc = new ethers.Contract(resolvedQusdc, ERC20_ABI, contracts.signer);
    }

    return resolvedQusdc;
  }

  async _buildDecisionContext(runtime, agentId) {
    this._ensureRuntimeQusdc(runtime);
    const { contracts, ledger } = runtime;
    const budget = await contracts.controller.getBudget(agentId);
    const owner = await contracts.signer.getAddress();
    const qusdcBalance = BigInt(await contracts.qusdc.balanceOf(owner));
    const onChainDailyLimit = BigInt(budget.dailyLimit || 0);
    const onChainSpent = BigInt(budget.spentToday || 0);
    const localSpent = this._localSpendToday(agentId);
    const ledgerSpent = ledger?.dailyPaymentSpend ? BigInt(ledger.dailyPaymentSpend(agentId)) : 0n;
    const spentToday = onChainSpent > localSpent ? onChainSpent : localSpent;
    const combinedSpent = spentToday > ledgerSpent ? spentToday : ledgerSpent;
    const enforceableLimit = onChainDailyLimit > 0n && onChainDailyLimit < this.defaultDailyLimit
      ? onChainDailyLimit
      : this.defaultDailyLimit;
    const remainingWei = enforceableLimit > combinedSpent ? enforceableLimit - combinedSpent : 0n;
    const demoLimitWei = this.testModeLimit;
    const constraints = [
      { name: "enforceableLimit", value: enforceableLimit },
      { name: "remainingWei", value: remainingWei },
      { name: "qusdcBalance", value: qusdcBalance },
      { name: "demoLimit", value: demoLimitWei },
      { name: "defaultDailyLimit", value: this.defaultDailyLimit }
    ];
    const spendLimit = spendLimitFromConstraints(constraints, ["qusdcBalance", "enforceableLimit", "remainingWei"]);
    const safeSpendLimitWei = spendLimit.safeSpendLimitWei;
    const budgetDebug = {
      defaultDailyLimit: this.defaultDailyLimit.toString(),
      demoLimit: demoLimitWei.toString(),
      onChainDailyLimit: onChainDailyLimit.toString(),
      onChainSpentToday: onChainSpent.toString(),
      localSpentToday: localSpent.toString(),
      ledgerSpentToday: ledgerSpent.toString(),
      enforceableLimit: enforceableLimit.toString(),
      remainingWei: remainingWei.toString(),
      qusdcBalance: qusdcBalance.toString(),
      safeSpendLimitWei: safeSpendLimitWei.toString(),
      limitingConstraint: spendLimit.limitingConstraint,
      ignoredZeroConstraints: spendLimit.ignoredZeroConstraints,
      constraints: Object.fromEntries(constraints.map((constraint) => [constraint.name, constraint.value.toString()])),
      paused: Boolean(budget.paused)
    };

    ledger?.append?.({
      eventType: "agent_budget_context",
      status: safeSpendLimitWei > 0n ? "ok" : "blocked",
      ...budgetDebug
    });

    return {
      budget: budgetDebug,
      budgetRemainingQie: Number(ethers.formatUnits(remainingWei, 18)),
      safeSpendLimitWei,
      safeSpendLimitQie: weiToQieNumber(safeSpendLimitWei),
      recentHistory: this.getHistory(10).map((item) => ({
        timestamp: item.timestamp,
        task: item.task,
        action: item.decision?.action || null,
        amount: item.decision?.amount || 0,
        status: item.status,
        txHash: item.transaction?.txHash || null
      }))
    };
  }

  async _planSpend(runtime, agentId, requestedAmountWei, input) {
    const { contracts } = runtime;
    const streamId = input?.streamId || this.defaultStreamId;

    if (!streamId) {
      return {
        streamId: null,
        receiver: input?.receiver || this.defaultReceiver,
        ratePerUnit: requestedAmountWei,
        units: 1n,
        amountWei: requestedAmountWei
      };
    }

    const resolvedStreamId = BigInt(streamId);
    const stream = await contracts.vault.getStream(resolvedStreamId);
    if (BigInt(stream.agentId) !== BigInt(agentId)) {
      throw new Error(`stream ${resolvedStreamId.toString()} does not belong to agent ${agentId.toString()}`);
    }

    const ratePerUnit = BigInt(stream.ratePerUnit);
    const units = requestedAmountWei / ratePerUnit;
    if (units <= 0n) {
      throw new Error("AI spend amount is below the existing stream ratePerUnit");
    }

    return {
      streamId: resolvedStreamId,
      receiver: stream.receiver,
      ratePerUnit,
      units,
      amountWei: ratePerUnit * units
    };
  }

  async _executeSpend(runtime, agentId, spendPlan, input) {
    const { contracts, ledger } = runtime;
    let resolvedStreamId = spendPlan.streamId;
    let createTxRecord = null;
    let ratePerUnit = spendPlan.ratePerUnit;
    let approvalRecord = null;

    const funding = await this._ensureQusdcForPayment(runtime, spendPlan.amountWei);
    if (!funding.sufficient) {
      throw new Error(`QUSDC balance is insufficient for payment: ${funding.reason || "INSUFFICIENT_QUSDC"}`);
    }

    if (!resolvedStreamId) {
      const receiver = spendPlan.receiver || input?.receiver || this.defaultReceiver || (await contracts.signer.getAddress());
      if (!receiver || !ethers.isAddress(receiver)) {
        throw new Error("receiver or AGENT_RECEIVER is required to create a spending stream");
      }

      const createTx = await contracts.vault.createStream(agentId, ethers.getAddress(receiver), ratePerUnit);
      const createReceipt = await createTx.wait();
      const created = this._findEvent(createReceipt, contracts.vault.interface, "StreamCreated");
      resolvedStreamId = BigInt(created.args.streamId);
      createTxRecord = this._txRecord("createStream", createTx, createReceipt, {
        streamId: resolvedStreamId,
        amountWei: 0n
      });
      ledger?.append?.({
        eventType: "contract_interaction",
        status: createReceipt.status === 1 ? "confirmed" : "failed",
        agentId,
        interactionType: "createStream",
        txHash: createTx.hash,
        gasUsed: createReceipt.gasUsed,
        blockNumber: createReceipt.blockNumber,
        streamId: resolvedStreamId
      });
    }

    const stream = await contracts.vault.getStream(resolvedStreamId);
    const payer = ethers.getAddress(stream.payer);
    approvalRecord = await this._ensureVaultAllowance(runtime, {
      owner: payer,
      amountWei: spendPlan.amountWei,
      agentId,
      streamId: resolvedStreamId,
      intentId: input?.intentId || null,
      interactionType: "executePayment"
    });

    const executeTx = await contracts.vault.executePayment(resolvedStreamId, spendPlan.units);
    const executeReceipt = await executeTx.wait();
    const executeTxRecord = this._txRecord("executePayment", executeTx, executeReceipt, {
      streamId: resolvedStreamId,
      amountWei: spendPlan.amountWei,
      units: spendPlan.units
    });

    ledger?.append?.({
      eventType: "contract_interaction",
      status: executeReceipt.status === 1 ? "confirmed" : "failed",
      agentId,
      interactionType: "executePayment",
      txHash: executeTx.hash,
      gasUsed: executeReceipt.gasUsed,
      blockNumber: executeReceipt.blockNumber,
      streamId: resolvedStreamId,
      amount: spendPlan.amountWei,
      units: spendPlan.units
    });

    return {
      approval: approvalRecord,
      createStream: createTxRecord,
      executePayment: executeTxRecord
    };
  }

  async _ensureVaultAllowance(runtime, input) {
    this._ensureRuntimeQusdc(runtime);
    const { contracts, ledger } = runtime;
    const owner = ethers.getAddress(input.owner || await contracts.signer.getAddress());

    return this.allowanceManager.ensureAllowance({
      token: contracts.qusdc,
      tokenAddress: contracts.addresses.qusdc,
      signer: contracts.signer,
      owner,
      spender: contracts.addresses.vault,
      amount: input.amountWei,
      chainId: CHAIN_ID,
      ledger,
      metadata: {
        agentId: input.agentId,
        streamId: input.streamId || null,
        intentId: input.intentId || null,
        interactionType: input.interactionType || "executePayment"
      }
    });
  }

  async _assertOnChainLimit(runtime, agentId, amountWei) {
    const { contracts } = runtime;
    const [budget, allowed, whitelisted] = await Promise.all([
      contracts.controller.getBudget(agentId),
      contracts.controller.canSpendFor(agentId, contracts.addresses.vault, amountWei),
      contracts.controller.isServiceWhitelisted(agentId, contracts.addresses.vault)
    ]);
    const dailyLimit = BigInt(budget.dailyLimit || 0);
    const spentToday = BigInt(budget.spentToday || 0);
    const checks = {
      paused: Boolean(budget.paused),
      dailyLimitExceeded: dailyLimit > 0n && spentToday + amountWei > dailyLimit,
      notWhitelisted: !Boolean(whitelisted),
      exceedsSafeSpendLimit: false
    };
    const rejection = {
      reason: "SPEND_BLOCKED",
      checks,
      agentId: agentId.toString(),
      vault: contracts.addresses.vault,
      amountWei: amountWei.toString(),
      dailyLimit: dailyLimit.toString(),
      spentToday: spentToday.toString(),
      vaultWhitelisted: Boolean(whitelisted)
    };

    if (checks.paused || checks.dailyLimitExceeded || checks.notWhitelisted || !allowed) {
      runtime.ledger?.append?.({
        eventType: "spend_controller_precheck",
        status: "blocked",
        ...rejection
      });
      const error = new Error(JSON.stringify(rejection));
      error.code = "SPEND_BLOCKED";
      error.details = rejection;
      throw error;
    }
  }

  async _ensureQusdcForPayment(runtime, amountWei) {
    this._ensureRuntimeQusdc(runtime);
    const { contracts, ledger, liquidityEngine } = runtime;
    const owner = await contracts.signer.getAddress();
    const amount = BigInt(amountWei);
    const balance = BigInt(await contracts.qusdc.balanceOf(owner));

    ledger?.append?.({
      eventType: "qusdc_balance_check",
      owner,
      token: contracts.addresses.qusdc,
      requiredAmount: amount,
      balance,
      sufficient: balance >= amount
    });

    if (balance >= amount) {
      return { sufficient: true, balance: balance.toString() };
    }

    if (isMockQusdcMode()) {
      return {
        sufficient: false,
        reason: "INSUFFICIENT_MOCK_QUSDC",
        balance: balance.toString(),
        swap: null,
        note: "mock mode: QIEDEX bypassed; fund signer with MockQUSDC faucet"
      };
    }

    if (!liquidityEngine) {
      ledger?.append?.({
        eventType: "qiedex_swap",
        inputToken: contracts.addresses.wqie,
        outputToken: contracts.addresses.qusdc,
        amountIn: amount,
        txHash: null,
        status: "skipped",
        reason: "LIQUIDITY_ENGINE_UNAVAILABLE",
        recipient: owner
      });
      return { sufficient: false, reason: "LIQUIDITY_ENGINE_UNAVAILABLE" };
    }

    const liquidity = typeof liquidityEngine.inspectLiquidity === "function"
      ? await liquidityEngine.inspectLiquidity(contracts.addresses.wqie, contracts.addresses.qusdc)
      : {
          hasLiquidity: Boolean(await liquidityEngine.checkPairExists(contracts.addresses.wqie, contracts.addresses.qusdc)),
          pair: await liquidityEngine.checkPairExists(contracts.addresses.wqie, contracts.addresses.qusdc),
          reason: null
        };

    if (!liquidity.hasLiquidity || !liquidity.pair || liquidity.pair.toLowerCase?.() === ZERO_ADDRESS) {
      const reason = liquidity.reason || "NO_LIQUIDITY_SKIP_SWAP";
      ledger?.append?.({
        eventType: "qiedex_swap",
        inputToken: contracts.addresses.wqie,
        outputToken: contracts.addresses.qusdc,
        amountIn: amount,
        txHash: null,
        status: "skipped",
        reason,
        pair: liquidity.pair || null,
        diagnostic: liquidity.diagnostic || null,
        recipient: owner
      });
      return { sufficient: false, reason, liquidity };
    }

    const swap = await liquidityEngine.ensureQusdcBalance({
      tokenIn: contracts.addresses.wqie,
      tokenOut: contracts.addresses.qusdc,
      inputTokenContract: contracts.wqie,
      owner,
      requiredAmount: amount,
      amountIn: amount
    });

    const nextBalance = BigInt(await contracts.qusdc.balanceOf(owner));
    ledger?.append?.({
      eventType: "qusdc_balance_check",
      owner,
      token: contracts.addresses.qusdc,
      requiredAmount: amount,
      balance: nextBalance,
      sufficient: nextBalance >= amount,
      afterSwap: true
    });

    return {
      sufficient: nextBalance >= amount,
      balance: nextBalance.toString(),
      swap
    };
  }

  _assertBackendLimit(context, amountWei) {
    const safeSpendLimit = BigInt(context.safeSpendLimitWei || 0);
    if (amountWei <= 0n) {
      throw new Error("AI spend amount must be greater than zero");
    }
    if (amountWei > safeSpendLimit) {
      const checks = {
        paused: Boolean(context.budget.paused),
        dailyLimitExceeded: amountWei > BigInt(context.budget.remainingWei || 0),
        notWhitelisted: false,
        exceedsSafeSpendLimit: true
      };
      const error = new Error(JSON.stringify({
        reason: "SPEND_BLOCKED",
        checks,
        amountWei: amountWei.toString(),
        safeSpendLimitWei: safeSpendLimit.toString(),
        limitingConstraint: context.budget.limitingConstraint
      }));
      error.code = "SPEND_BLOCKED";
      throw error;
    }
    if (BigInt(context.budget.remainingWei || 0) > 0n && amountWei > BigInt(context.budget.remainingWei)) {
      const error = new Error(JSON.stringify({
        reason: "SPEND_BLOCKED",
        checks: {
          paused: Boolean(context.budget.paused),
          dailyLimitExceeded: true,
          notWhitelisted: false,
          exceedsSafeSpendLimit: false
        },
        amountWei: amountWei.toString(),
        remainingWei: context.budget.remainingWei
      }));
      error.code = "SPEND_BLOCKED";
      throw error;
    }
    if (context.budget?.intentPolicyMode !== "budget_primary" && amountWei > this.defaultDailyLimit) {
      const error = new Error(JSON.stringify({
        reason: "SPEND_BLOCKED",
        checks: {
          paused: Boolean(context.budget.paused),
          dailyLimitExceeded: false,
          notWhitelisted: false,
          exceedsSafeSpendLimit: true
        },
        amountWei: amountWei.toString(),
        defaultDailyLimit: this.defaultDailyLimit.toString()
      }));
      error.code = "SPEND_BLOCKED";
      throw error;
    }
  }

  _parseDecision(content, budgetRemaining) {
    const parsed = extractJsonObject(content);
    if (!parsed) {
      throw new Error("AI decision was not valid strict JSON");
    }

    if (!["spend", "hold"].includes(parsed.action)) {
      throw new Error('AI decision action must be "spend" or "hold"');
    }

    const amount = Number(parsed.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error("AI decision amount must be a non-negative number");
    }
    if (parsed.action === "hold" && amount !== 0) {
      throw new Error("AI hold decision must use amount 0");
    }
    if (parsed.action === "spend" && amount <= 0) {
      throw new Error("AI spend decision must use amount greater than 0");
    }
    if (typeof parsed.reasoning !== "string" || parsed.reasoning.trim().length === 0) {
      throw new Error("AI decision reasoning is required");
    }

    return {
      action: parsed.action,
      amount,
      reasoning: parsed.reasoning.trim()
    };
  }

  _clampDecision(decision, safeSpendLimitWei) {
    if (decision.action !== "spend") {
      return decision;
    }

    const requestedWei = this._qieToWei(decision.amount);
    const safeLimit = BigInt(safeSpendLimitWei || 0);
    if (safeLimit <= 0n) {
      return {
        action: "hold",
        amount: 0,
        reasoning: `${decision.reasoning} Safe spend limit is 0, so execution was clamped to hold.`
      };
    }
    if (requestedWei <= safeLimit) {
      return decision;
    }

    return {
      action: "spend",
      amount: weiToQieNumber(safeLimit),
      reasoning: `${decision.reasoning} Requested amount was clamped to safeSpendLimit before execution.`
    };
  }

  _qieToWei(amount) {
    const rounded = Math.floor(Number(amount) * 1_000_000);
    return (BigInt(rounded) * WEI_PER_QIE) / 1_000_000n;
  }

  _localSpendToday(agentId) {
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);

    return this.history.reduce((total, item) => {
      if (String(item.agentId) !== String(agentId)) return total;
      if (item.status !== "spent") return total;
      if (new Date(item.timestamp) < dayStart) return total;
      return total + BigInt(item.transaction?.executePayment?.amountWei || "0");
    }, 0n);
  }

  _findEvent(receipt, contractInterface, eventName) {
    for (const log of receipt.logs) {
      try {
        const parsed = contractInterface.parseLog(log);
        if (parsed?.name === eventName) {
          return parsed;
        }
      } catch (_error) {
        // Other contract logs can be present in the same receipt.
      }
    }

    throw new Error(`Event ${eventName} not found in transaction ${receipt.hash}`);
  }

  _txRecord(type, tx, receipt, extra) {
    return bigintJson({
      type,
      txHash: tx.hash,
      gasUsed: receipt.gasUsed,
      blockNumber: receipt.blockNumber,
      status: receipt.status === 1 ? "confirmed" : "failed",
      ...extra
    });
  }

  _store(record) {
    const stored = bigintJson({
      ...record,
      timestamp: record.completedAt || record.timestamp
    });
    this.history.unshift(stored);
    console.log(JSON.stringify({ event: "agent_runtime", ...stored }));
  }

  _storeIntent(record) {
    const stored = bigintJson({
      ...record,
      timestamp: record.completedAt || record.timestamp
    });
    this.intentHistory.unshift(stored);
    if (this.intentHistory.length > 500) {
      this.intentHistory = this.intentHistory.slice(0, 500);
    }
    console.log(JSON.stringify({ event: "payment_intent", ...stored }));
  }

  _replaceIntent(record) {
    const stored = bigintJson({
      ...record,
      timestamp: record.completedAt || record.timestamp
    });
    const index = this.intentHistory.findIndex((item) => item.runId === stored.runId);
    if (index >= 0) {
      this.intentHistory[index] = stored;
    } else {
      this.intentHistory.unshift(stored);
    }
    if (this.intentHistory.length > 500) {
      this.intentHistory = this.intentHistory.slice(0, 500);
    }
    console.log(JSON.stringify({ event: "payment_intent", ...stored }));
  }

  _validateTask(task) {
    if (typeof task !== "string" || task.trim().length === 0) {
      const error = new Error("task must be a non-empty string");
      error.statusCode = 400;
      throw error;
    }

    return task.trim();
  }

  _enqueue(work) {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => {});
    return next;
  }
}

module.exports = {
  AgentRuntime
};
