const crypto = require("crypto");
const { ethers } = require("ethers");
const { ERC20_ABI } = require("../src/contracts");
const { CHAIN_ID } = require("../src/deployment");
const { LLMProvider } = require("./llmProvider");

const WEI_PER_QIE = 10n ** 18n;
const ZERO_ADDRESS = ethers.ZeroAddress.toLowerCase();
const DEFAULT_TEST_MODE_LIMIT_QIE = "1";

function nowIso() {
  return new Date().toISOString();
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

function qieToWei(amount) {
  const rounded = Math.floor(Number(amount) * 1_000_000);
  return (BigInt(rounded) * WEI_PER_QIE) / 1_000_000n;
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

class AgentRuntime {
  constructor(options = {}) {
    this.llmProvider = options.llmProvider || new LLMProvider(options.llm);
    this.getBlockchainRuntime = options.getBlockchainRuntime;
    this.defaultDailyLimit = readPositiveBigInt(
      options.defaultDailyLimit || process.env.DEFAULT_DAILY_LIMIT,
      "DEFAULT_DAILY_LIMIT"
    );
    this.testModeLimit = readTestModeLimitWei(options);
    this.defaultAgentId = options.defaultAgentId || process.env.AGENT_ID || "1";
    this.defaultReceiver = options.defaultReceiver || process.env.AGENT_RECEIVER;
    this.defaultStreamId = options.defaultStreamId || process.env.AGENT_STREAM_ID;
    this.status = "idle";
    this.currentRun = null;
    this.history = [];
    this.queue = Promise.resolve();

    if (!this.getBlockchainRuntime) {
      throw new Error("AgentRuntime requires getBlockchainRuntime");
    }
  }

  run(input) {
    return this._enqueue(() => this._run(input));
  }

  getHistory(limit = 50) {
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 500);
    return this.history.slice(0, safeLimit);
  }

  getStatus() {
    return {
      status: this.status,
      totalRuns: this.history.length,
      lastRun: this.history[0] || null
    };
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

  _resolveQusdcAddress(runtime) {
    const { contracts } = runtime;
    const configuredQusdc = normalizeAddress(
      process.env.QUSDC_ADDRESS
      || contracts.deployment?.addresses?.qusdc
      || contracts.deployment?.qieStablecoin
      || contracts.deployment?.stable
      || contracts.deployment?.qusdc
      || contracts.addresses?.qusdc
    );

    if (!configuredQusdc) {
      throw new Error("QUSDC_ADDRESS is required or must be present in deployment config");
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
    const testnetCapWei = BigInt(CHAIN_ID) === 1983n ? this.testModeLimit : this.defaultDailyLimit;
    const constraints = [
      { name: "enforceableLimit", value: enforceableLimit },
      { name: "remainingWei", value: remainingWei },
      { name: "qusdcBalance", value: qusdcBalance },
      { name: "testModeLimit", value: testnetCapWei },
      { name: "defaultDailyLimit", value: this.defaultDailyLimit }
    ];
    const spendLimit = spendLimitFromConstraints(constraints, ["qusdcBalance", "enforceableLimit", "remainingWei"]);
    const safeSpendLimitWei = spendLimit.safeSpendLimitWei;
    const budgetDebug = {
      defaultDailyLimit: this.defaultDailyLimit.toString(),
      testModeLimit: testnetCapWei.toString(),
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
      createStream: createTxRecord,
      executePayment: executeTxRecord
    };
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
    if (amountWei > this.defaultDailyLimit) {
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
