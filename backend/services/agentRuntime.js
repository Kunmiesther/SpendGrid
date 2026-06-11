const crypto = require("crypto");
const { ethers } = require("ethers");
const { LLMProvider } = require("./llmProvider");

const WEI_PER_QIE = 10n ** 18n;

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

class AgentRuntime {
  constructor(options = {}) {
    this.llmProvider = options.llmProvider || new LLMProvider(options.llm);
    this.getBlockchainRuntime = options.getBlockchainRuntime;
    this.defaultDailyLimit = BigInt(options.defaultDailyLimit || process.env.DEFAULT_DAILY_LIMIT || "0");
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
    if (this.defaultDailyLimit <= 0n) {
      throw new Error("DEFAULT_DAILY_LIMIT is required and must be greater than zero");
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
        budgetRemaining: context.budgetRemainingQie,
        recentHistory: context.recentHistory
      });

      const decision = this._parseDecision(decisionResult.content, context.budgetRemainingQie);
      record.decision = {
        ...decision,
        model: decisionResult.model,
        usage: decisionResult.usage || null,
        providerResponseId: decisionResult.providerResponseId || null
      };

      if (decision.action === "hold") {
        record.status = "held";
        record.completedAt = nowIso();
        this._store(record);
        return bigintJson(record);
      }

      const requestedAmountWei = this._qieToWei(decision.amount);
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

  async _buildDecisionContext(runtime, agentId) {
    const { contracts, ledger } = runtime;
    const budget = await contracts.controller.getBudget(agentId);
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

    return {
      budget: {
        defaultDailyLimit: this.defaultDailyLimit.toString(),
        onChainDailyLimit: onChainDailyLimit.toString(),
        onChainSpentToday: onChainSpent.toString(),
        localSpentToday: localSpent.toString(),
        ledgerSpentToday: ledgerSpent.toString(),
        enforceableLimit: enforceableLimit.toString(),
        remainingWei: remainingWei.toString(),
        paused: Boolean(budget.paused)
      },
      budgetRemainingQie: Number(ethers.formatUnits(remainingWei, 18)),
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
    const [budget, allowed] = await Promise.all([
      contracts.controller.getBudget(agentId),
      contracts.controller.canSpendFor(agentId, contracts.addresses.vault, amountWei)
    ]);

    if (budget.paused) {
      throw new Error("SpendController budget is paused");
    }
    if (BigInt(budget.dailyLimit || 0) > 0n && BigInt(budget.spentToday || 0) + amountWei > BigInt(budget.dailyLimit)) {
      throw new Error("on-chain SpendController daily limit would be exceeded");
    }
    if (!allowed) {
      throw new Error("SpendController rejected the AI spending decision");
    }
  }

  _assertBackendLimit(context, amountWei) {
    if (amountWei <= 0n) {
      throw new Error("AI spend amount must be greater than zero");
    }
    if (amountWei > BigInt(context.budget.remainingWei)) {
      throw new Error("AI spend amount exceeds backend remaining budget");
    }
    if (amountWei > this.defaultDailyLimit) {
      throw new Error("AI spend amount exceeds DEFAULT_DAILY_LIMIT");
    }
  }

  _parseDecision(content, budgetRemaining) {
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (_error) {
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
    if (amount > budgetRemaining) {
      throw new Error("AI decision exceeds supplied budgetRemaining");
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
