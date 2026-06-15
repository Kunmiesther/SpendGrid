const { ethers } = require("ethers");
const { decideAction, runModel } = require("./aiAgent");
const { assertQieTestnet, makeStreamVaultAdapter } = require("./contracts");
const { CHAIN_ID, NETWORK_NAME } = require("./deployment");
const { bigintJson, createId, findEvent, hashPrompt, nowIso, toPositiveUint } = require("./utils");

const ZERO_ADDRESS = ethers.ZeroAddress.toLowerCase();
const DEFAULT_TEST_MODE_LIMIT_QIE = "1";

function readPositiveBigInt(value, label) {
  if (value === undefined || value === null || value === "") {
    throw new Error(`${label} is required and must be greater than zero`);
  }

  const parsed = BigInt(value);
  if (parsed <= 0n) {
    throw new Error(`${label} must be greater than zero`);
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

function minimumConstraint(constraints) {
  return constraints.reduce((current, next) => (next.value < current.value ? next : current));
}

class AutonomousAgentEngine {
  constructor(contracts, ledger, options = {}) {
    this.contracts = contracts;
    this.streamVault = makeStreamVaultAdapter(contracts.vault);
    this.ledger = ledger;
    this.liquidityEngine = options.liquidityEngine || null;
    this.defaultDailyLimit = readPositiveBigInt(
      options.defaultDailyLimit || process.env.DEFAULT_DAILY_LIMIT,
      "DEFAULT_DAILY_LIMIT"
    );
    this.testModeLimit = readTestModeLimitWei(options);
    this.ready = false;
    this.queue = Promise.resolve();
  }

  async start() {
    await assertQieTestnet(this.contracts.provider);
    const signerAddress = await this.contracts.signer.getAddress();

    this.ready = true;
    this.ledger.append({
      eventType: "agent_status",
      status: "online",
      mode: "autonomous",
      chainId: CHAIN_ID,
      network: NETWORK_NAME,
      signer: signerAddress,
      contracts: this.contracts.addresses,
      defaultDailyLimit: this.defaultDailyLimit,
      testModeLimit: this.testModeLimit
    });
  }

  async runTask(input) {
    return this._enqueue(() => this._runTask(input));
  }

  async status(agentId) {
    const signer = await this.contracts.signer.getAddress();
    const blockNumber = await this.contracts.provider.getBlockNumber();
    const base = {
      ok: true,
      mode: "autonomous",
      chainId: CHAIN_ID,
      network: NETWORK_NAME,
      ready: this.ready,
      signer,
      blockNumber,
      contracts: this.contracts.addresses,
      defaultDailyLimit: this.defaultDailyLimit.toString(),
      logPath: this.ledger.logPath
    };

    if (agentId === undefined || agentId === null || agentId === "") {
      return bigintJson(base);
    }

    const normalizedAgentId = toPositiveUint(agentId, "agentId");
    const [agent, budget, vaultWhitelisted] = await Promise.all([
      this.contracts.registry.getAgent(normalizedAgentId),
      this.contracts.controller.getBudget(normalizedAgentId),
      this.contracts.controller.isServiceWhitelisted(normalizedAgentId, this.contracts.addresses.vault)
    ]);

    const localSpentToday = this.ledger.dailyPaymentSpend(normalizedAgentId);

    return bigintJson({
      ...base,
      agentId: normalizedAgentId,
      agent: {
        owner: agent.owner,
        agentWallet: agent.agentWallet,
        qiePassId: agent.qiePassId,
        active: agent.active,
        createdAt: agent.createdAt
      },
      budget: {
        dailyLimit: budget.dailyLimit,
        spentToday: budget.spentToday,
        lastResetTimestamp: budget.lastResetTimestamp,
        nextResetTimestamp: budget.nextResetTimestamp,
        paused: budget.paused,
        localSpentToday
      },
      vaultWhitelisted
    });
  }

  history(filters = {}) {
    return {
      logPath: this.ledger.logPath,
      records: this.ledger.list(filters)
    };
  }

  async _runTask(input) {
    if (!this.ready) {
      throw new Error("Autonomous agent engine is not ready");
    }

    const runId = createId("run");
    const startedAt = nowIso();
    const agentId = toPositiveUint(input.agentId, "agentId");

    this.ledger.append({
      eventType: "agent_run_started",
      runId,
      agentId,
      promptHash: input.prompt ? hashPrompt(input.prompt) : null,
      requestedAction: input.action || "auto"
    });

    const aiResult = await runModel(input.prompt, input);
    const decision = decideAction(input, aiResult);

    this.ledger.append({
      eventType: "agent_decision",
      runId,
      agentId,
      decisionId: decision.decisionId,
      decision: {
        action: decision.action,
        reason: decision.reason,
        confidence: aiResult.confidence,
        usageUnits: decision.units,
        receiver: decision.receiver || null,
        streamId: decision.streamId || null,
        closeAfterRun: decision.closeAfterRun || false
      },
      ai: aiResult
    });

    const interactions = [];

    if (decision.action === "stopStream") {
      await this._loadStreamForAgent(decision.streamId, agentId);
      const stopped = await this._stopStream({ runId, agentId, streamId: decision.streamId });
      interactions.push(stopped);
      return this._completeRun(runId, agentId, startedAt, decision, aiResult, interactions);
    }

    let streamId = decision.streamId || null;
    let ratePerUnit = null;

    if (decision.action === "createStream") {
      ratePerUnit = decision.ratePerUnit;
      const safeCreateSpend = await this._capSpendAmount(agentId, ratePerUnit * decision.units);
      decision.units = this._capUnitsForAmount(decision.units, ratePerUnit, safeCreateSpend);
      await this._assertSpendAllowed(agentId, null, ratePerUnit * decision.units);

      const created = await this._createStream({
        runId,
        agentId,
        receiver: decision.receiver,
        ratePerUnit
      });
      interactions.push(created);
      streamId = BigInt(created.streamId);
    }

    if (!streamId) {
      throw new Error("streamId was not resolved for payment execution");
    }

    const stream = await this._loadStreamForAgent(streamId, agentId);
    ratePerUnit = ratePerUnit || BigInt(stream.ratePerUnit);
    const safePaymentSpend = await this._capSpendAmount(agentId, ratePerUnit * decision.units);
    decision.units = this._capUnitsForAmount(decision.units, ratePerUnit, safePaymentSpend);
    const amount = ratePerUnit * decision.units;

    if (decision.action !== "createStream") {
      await this._assertSpendAllowed(agentId, streamId, amount);
    }

    const executed = await this._executePayment({
      runId,
      agentId,
      streamId,
      units: decision.units,
      amount,
      ratePerUnit
    });
    interactions.push(executed);

    if (decision.closeAfterRun) {
      const stopped = await this._stopStream({ runId, agentId, streamId });
      interactions.push(stopped);
    }

    return this._completeRun(runId, agentId, startedAt, decision, aiResult, interactions);
  }

  async _createStream({ runId, agentId, receiver, ratePerUnit }) {
    const funding = await this._ensureQusdcForPayment(ratePerUnit);
    if (!funding.sufficient) {
      throw new Error(`QUSDC balance is insufficient for payment: ${funding.reason || "INSUFFICIENT_QUSDC"}`);
    }
    const tx = await this.streamVault.createStream(agentId, receiver, ratePerUnit);
    const receipt = await tx.wait();
    const event = findEvent(receipt, this.streamVault.interface, "StreamCreated");

    return this._logContractInteraction({
      runId,
      agentId,
      interactionType: "createStream",
      tx,
      receipt,
      streamId: event.args.streamId,
      receiver,
      ratePerUnit,
      amount: 0n,
      units: 0n
    });
  }

  async _executePayment({ runId, agentId, streamId, units, amount, ratePerUnit }) {
    const funding = await this._ensureQusdcForPayment(amount);
    if (!funding.sufficient) {
      throw new Error(`QUSDC balance is insufficient for payment: ${funding.reason || "INSUFFICIENT_QUSDC"}`);
    }
    const tx = await this.streamVault.executePayment(streamId, units);
    const receipt = await tx.wait();

    return this._logContractInteraction({
      runId,
      agentId,
      interactionType: "executePayment",
      tx,
      receipt,
      streamId,
      amount,
      units,
      ratePerUnit
    });
  }

  async _stopStream({ runId, agentId, streamId }) {
    const tx = await this.streamVault.stopStream(streamId);
    const receipt = await tx.wait();

    return this._logContractInteraction({
      runId,
      agentId,
      interactionType: "stopStream",
      contractFunction: "closeStream",
      tx,
      receipt,
      streamId,
      amount: 0n,
      units: 0n
    });
  }

  async _loadStreamForAgent(streamId, agentId) {
    const stream = await this.contracts.vault.getStream(streamId);
    if (BigInt(stream.agentId) !== BigInt(agentId)) {
      throw new Error(`stream ${streamId.toString()} does not belong to agent ${agentId.toString()}`);
    }

    return stream;
  }

  async _assertSpendAllowed(agentId, streamId, amount) {
    if (amount <= 0n) {
      throw new Error("payment amount must be greater than zero");
    }

    if (this.defaultDailyLimit > 0n) {
      const localSpentToday = this.ledger.dailyPaymentSpend(agentId);
      if (localSpentToday + amount > this.defaultDailyLimit) {
        this.ledger.append({
          eventType: "agent_decision",
          status: "blocked",
          agentId,
          streamId,
          decision: {
            action: "executePayment",
            reason: "Local DEFAULT_DAILY_LIMIT guard blocked the transaction",
            amount,
            localSpentToday,
            defaultDailyLimit: this.defaultDailyLimit
          }
        });
        throw new Error("DEFAULT_DAILY_LIMIT would be exceeded");
      }
    }

    const [budget, canSpendFor, vaultWhitelisted] = await Promise.all([
      this.contracts.controller.getBudget(agentId),
      this.contracts.controller.canSpendFor(agentId, this.contracts.addresses.vault, amount),
      this.contracts.controller.isServiceWhitelisted(agentId, this.contracts.addresses.vault)
    ]);
    const dailyLimit = BigInt(budget.dailyLimit || 0);
    const spentToday = BigInt(budget.spentToday || 0);
    const checks = {
      paused: Boolean(budget.paused),
      dailyLimitExceeded: dailyLimit === 0n || spentToday + amount > dailyLimit,
      notWhitelisted: !Boolean(vaultWhitelisted),
      exceedsSafeSpendLimit: false
    };

    if (amount > this.defaultDailyLimit) {
      checks.exceedsSafeSpendLimit = true;
    }

    if (checks.paused || checks.dailyLimitExceeded || checks.notWhitelisted || checks.exceedsSafeSpendLimit || !canSpendFor) {
      const reason = bigintJson({
        reason: "SPEND_BLOCKED",
        checks,
        agentId,
        streamId,
        vault: this.contracts.addresses.vault,
        amountWei: amount,
        dailyLimit,
        spentToday,
        vaultWhitelisted
      });
      this.ledger.append({
        eventType: "spend_controller_precheck",
        status: "blocked",
        ...reason
      });
      const error = new Error(JSON.stringify(reason));
      error.code = "SPEND_BLOCKED";
      error.details = reason;
      throw error;
    }
  }

  async _capSpendAmount(agentId, requestedAmount) {
    const owner = await this.contracts.signer.getAddress();
    const [budget, balance] = await Promise.all([
      this.contracts.controller.getBudget(agentId),
      this.contracts.qusdc.balanceOf(owner)
    ]);
    const onChainDailyLimit = BigInt(budget.dailyLimit || 0);
    const spentToday = BigInt(budget.spentToday || 0);
    const enforceableLimit = onChainDailyLimit > 0n && onChainDailyLimit < this.defaultDailyLimit
      ? onChainDailyLimit
      : this.defaultDailyLimit;
    const onChainRemaining = enforceableLimit > spentToday ? enforceableLimit - spentToday : 0n;
    const testnetCap = BigInt(CHAIN_ID) === 1983n ? this.testModeLimit : this.defaultDailyLimit;
    const constraints = [
      { name: "requestedAmount", value: BigInt(requestedAmount) },
      { name: "defaultDailyLimit", value: this.defaultDailyLimit },
      { name: "qusdcBalance", value: BigInt(balance) },
      { name: "testModeLimit", value: testnetCap },
      { name: "remainingWei", value: onChainRemaining }
    ];
    const limitingConstraint = minimumConstraint(constraints);
    const capped = limitingConstraint.value;

    this.ledger.append({
      eventType: "agent_budget_context",
      status: capped > 0n ? "ok" : "blocked",
      agentId,
      safeSpendLimitWei: capped,
      limitingConstraint: limitingConstraint.name,
      constraints: Object.fromEntries(constraints.map((constraint) => [constraint.name, constraint.value.toString()])),
      enforceableLimit,
      onChainDailyLimit,
      spentToday
    });

    if (capped < BigInt(requestedAmount)) {
      this.ledger.append({
        eventType: "agent_spend_clamped",
        status: capped > 0n ? "clamped" : "held",
        agentId,
        requestedAmount,
        cappedAmount: capped,
        defaultDailyLimit: this.defaultDailyLimit,
        qusdcBalance: balance,
        testModeLimit: testnetCap,
        onChainRemaining,
        limitingConstraint: limitingConstraint.name
      });
    }

    return capped;
  }

  _capUnitsForAmount(requestedUnits, ratePerUnit, cappedAmount) {
    const rate = BigInt(ratePerUnit);
    if (rate <= 0n || BigInt(cappedAmount) <= 0n) {
      throw new Error("safe spend cap is below the stream ratePerUnit");
    }

    const cappedUnits = BigInt(cappedAmount) / rate;
    if (cappedUnits <= 0n) {
      throw new Error("safe spend cap is below the stream ratePerUnit");
    }

    return cappedUnits < BigInt(requestedUnits) ? cappedUnits : BigInt(requestedUnits);
  }

  async _ensureQusdcForPayment(amount) {
    const owner = await this.contracts.signer.getAddress();
    const requiredAmount = BigInt(amount);
    const balance = BigInt(await this.contracts.qusdc.balanceOf(owner));

    this.ledger.append({
      eventType: "qusdc_balance_check",
      owner,
      token: this.contracts.addresses.qusdc,
      requiredAmount,
      balance,
      sufficient: balance >= requiredAmount
    });

    if (balance >= requiredAmount) {
      return { sufficient: true, balance: balance.toString() };
    }

    if (!this.liquidityEngine) {
      this.ledger.append({
        eventType: "qiedex_swap",
        inputToken: this.contracts.addresses.wqie,
        outputToken: this.contracts.addresses.qusdc,
        amountIn: requiredAmount,
        txHash: null,
        status: "skipped",
        reason: "LIQUIDITY_ENGINE_UNAVAILABLE",
        recipient: owner
      });
      return { sufficient: false, reason: "LIQUIDITY_ENGINE_UNAVAILABLE", balance: balance.toString() };
    }

    const liquidity = typeof this.liquidityEngine.inspectLiquidity === "function"
      ? await this.liquidityEngine.inspectLiquidity(this.contracts.addresses.wqie, this.contracts.addresses.qusdc)
      : {
          hasLiquidity: Boolean(await this.liquidityEngine.checkPairExists(this.contracts.addresses.wqie, this.contracts.addresses.qusdc)),
          pair: await this.liquidityEngine.checkPairExists(this.contracts.addresses.wqie, this.contracts.addresses.qusdc),
          reason: null
        };

    if (!liquidity.hasLiquidity || !liquidity.pair || liquidity.pair.toLowerCase?.() === ZERO_ADDRESS) {
      const reason = liquidity.reason || "NO_LIQUIDITY_SKIP_SWAP";
      this.ledger.append({
        eventType: "qiedex_swap",
        inputToken: this.contracts.addresses.wqie,
        outputToken: this.contracts.addresses.qusdc,
        amountIn: requiredAmount,
        txHash: null,
        status: "skipped",
        reason,
        pair: liquidity.pair || null,
        diagnostic: liquidity.diagnostic || null,
        recipient: owner
      });
      return { sufficient: false, reason, balance: balance.toString(), liquidity };
    }

    const swap = await this.liquidityEngine.ensureQusdcBalance({
      tokenIn: this.contracts.addresses.wqie,
      tokenOut: this.contracts.addresses.qusdc,
      inputTokenContract: this.contracts.wqie,
      owner,
      requiredAmount,
      amountIn: requiredAmount
    });

    const nextBalance = BigInt(await this.contracts.qusdc.balanceOf(owner));
    this.ledger.append({
      eventType: "qusdc_balance_check",
      owner,
      token: this.contracts.addresses.qusdc,
      requiredAmount,
      balance: nextBalance,
      sufficient: nextBalance >= requiredAmount,
      afterSwap: true
    });

    return {
      sufficient: nextBalance >= requiredAmount,
      reason: nextBalance >= requiredAmount ? null : swap?.reason || "INSUFFICIENT_QUSDC_AFTER_SWAP",
      balance: nextBalance.toString(),
      swap
    };
  }

  _logContractInteraction(fields) {
    const record = this.ledger.append({
      eventType: "contract_interaction",
      status: fields.receipt.status === 1 ? "confirmed" : "failed",
      runId: fields.runId,
      agentId: fields.agentId,
      interactionType: fields.interactionType,
      contractInteractionType: fields.interactionType,
      contractFunction: fields.contractFunction || fields.interactionType,
      contractAddress: this.contracts.addresses.vault,
      txHash: fields.tx.hash,
      gasUsed: fields.receipt.gasUsed,
      blockNumber: fields.receipt.blockNumber,
      streamId: fields.streamId || null,
      receiver: fields.receiver || null,
      amount: fields.amount || 0n,
      units: fields.units || 0n,
      ratePerUnit: fields.ratePerUnit || null
    });

    return record;
  }

  _completeRun(runId, agentId, startedAt, decision, aiResult, interactions) {
    const completed = this.ledger.append({
      eventType: "agent_run_completed",
      status: "completed",
      runId,
      agentId,
      startedAt,
      completedAt: nowIso(),
      decisionId: decision.decisionId,
      finalAction: decision.action,
      interactionCount: interactions.length
    });

    return bigintJson({
      runId,
      agentId,
      status: "completed",
      mode: "autonomous",
      ai: aiResult,
      decision,
      interactions,
      completed
    });
  }

  _enqueue(work) {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => {});
    return next;
  }
}

module.exports = {
  AutonomousAgentEngine
};
