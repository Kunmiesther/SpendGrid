const { loadEnv } = require("./src/env");

loadEnv();

const cors = require("cors");
const express = require("express");
const { ethers } = require("ethers");
const { AgentLoop } = require("./services/agentLoop");
const { AgentRuntime } = require("./services/agentRuntime");
const { LiquidityEngine } = require("./services/liquidityEngine");
const { AutonomousAgentEngine } = require("./src/engine");
const { makeContracts } = require("./src/contracts");
const { AgentLedger } = require("./src/ledger");
const { CHAIN_ID, NETWORK_NAME, loadDeployment } = require("./src/deployment");
const { isMockQusdcMode } = require("./src/qusdcMode");
const { bigintJson, findEvent, normalizeBytes32, toPositiveUint, toUint } = require("./src/utils");

const SNAPSHOT_EVENT_INTERVAL_MS = Number(process.env.AGENT_SNAPSHOT_EVENT_INTERVAL_MS || 4000);

function maxBigInt(...values) {
  return values.reduce((current, value) => {
    const parsed = BigInt(value || 0);
    return parsed > current ? parsed : current;
  }, 0n);
}

function minPositiveConstraint(constraints) {
  const positive = constraints.filter((constraint) => constraint.value > 0n);
  if (positive.length === 0) {
    return {
      value: 0n,
      name: constraints
        .filter((constraint) => constraint.value === 0n)
        .map((constraint) => constraint.name)
        .join("+") || "none"
    };
  }

  return positive.reduce((current, next) => (next.value < current.value ? next : current));
}

function sameAddress(left, right) {
  try {
    return Boolean(left && right && ethers.getAddress(left) === ethers.getAddress(right));
  } catch (_error) {
    return false;
  }
}

function startOfUtcDay(date = new Date()) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function runtimeDailySpend(agentRuntime, agentId) {
  const dayStart = startOfUtcDay();
  const targetAgentId = String(agentId);
  return agentRuntime.getHistory(500).reduce((total, record) => {
    if (String(record.agentId) !== targetAgentId) return total;
    if (record.status !== "spent") return total;
    if (new Date(record.timestamp || record.completedAt || 0).getTime() < dayStart) return total;
    return total + BigInt(record.transaction?.executePayment?.amountWei || "0");
  }, 0n);
}

function formatUnits(value, decimals) {
  try {
    return ethers.formatUnits(BigInt(value || 0), decimals);
  } catch (_error) {
    return "0";
  }
}

function latestByTimestamp(records) {
  return records
    .filter(Boolean)
    .sort((left, right) => new Date(right.timestamp || right.completedAt || 0) - new Date(left.timestamp || left.completedAt || 0))[0] || null;
}

function normalizeRuntimeDecision(record) {
  if (!record?.decision) return null;
  return {
    source: record.source === "payment_intent" ? "agent_policy_engine" : "agent_runtime",
    timestamp: record.completedAt || record.timestamp || null,
    status: record.status || null,
    action: record.decision.action || null,
    amount: record.decision.amount ?? null,
    amountWei: record.decision.amountWei || null,
    reasoning: record.decision.reasoning || null,
    model: record.decision.model || null,
    raw: record.decision
  };
}

function normalizeLedgerDecision(record) {
  if (!record?.decision) return null;
  return {
    source: "agent_engine",
    timestamp: record.timestamp || null,
    status: record.status || null,
    action: record.decision.action || null,
    amount: record.decision.amount || record.decision.usageUnits || null,
    reasoning: record.decision.reason || record.decision.reasoning || null,
    confidence: record.decision.confidence || null,
    raw: record.decision
  };
}

function normalizeTransaction(record, decimals) {
  if (!record?.txHash && !record?.transaction?.executePayment?.txHash) return null;
  const tx = record.transaction?.executePayment || record;
  return {
    source: record.eventType === "contract_interaction" ? "ledger" : "agent_runtime",
    timestamp: record.timestamp || record.completedAt || null,
    status: tx.status || record.status || null,
    interactionType: record.interactionType || tx.type || "executePayment",
    txHash: tx.txHash,
    amountWei: String(tx.amountWei || tx.amount || "0"),
    amount: formatUnits(tx.amountWei || tx.amount || "0", decimals),
    streamId: tx.streamId || record.streamId || null,
    units: tx.units || record.units || null,
    blockNumber: tx.blockNumber || record.blockNumber || null
  };
}

function normalizeIntent(record, decimals) {
  if (!record) return null;
  const executePayment = record.transaction?.executePayment || null;
  return {
    id: record.intentId || record.runId,
    intentId: record.intentId || null,
    runId: record.runId || null,
    source: "payment_intent",
    timestamp: record.completedAt || record.timestamp || record.startedAt || null,
    status: record.status || null,
    agentId: record.agentId || record.intent?.agentId || null,
    recipient: record.intent?.recipient || null,
    amountWei: String(record.intent?.amountWei || executePayment?.amountWei || "0"),
    amount: record.intent?.amount || formatUnits(record.intent?.amountWei || executePayment?.amountWei || 0, decimals),
    metadata: record.intent?.metadata || null,
    policy: record.intent?.policy || null,
    validation: record.validation || null,
    decision: record.decision || null,
    approval: record.approval || null,
    txHash: executePayment?.txHash || null,
    execution: record.execution || null,
    timeline: Array.isArray(record.timeline) ? record.timeline : []
  };
}

function buildTimeline({ runtimeHistory, intentHistory, ledgerRecords, decimals }) {
  const runtimeEvents = runtimeHistory.map((record) => ({
    id: record.runId || `runtime-${record.timestamp}`,
    source: "agent_runtime",
    timestamp: record.timestamp || record.completedAt,
    type: "agent_run",
    status: record.status,
    label: "Agent runtime",
    detail: record.decision?.reasoning || record.error || record.task || "Runtime record",
    txHash: record.transaction?.executePayment?.txHash || null,
    amount: formatUnits(record.transaction?.executePayment?.amountWei || 0, decimals)
  }));

  const ledgerEvents = ledgerRecords.map((record) => ({
    id: `${record.eventType}-${record.timestamp}-${record.txHash || record.runId || ""}`,
    source: "ledger",
    timestamp: record.timestamp,
    type: record.eventType,
    status: record.status || record.decision?.action || "recorded",
    label: record.interactionType || record.eventType,
    detail: record.reason || record.decision?.reason || record.limitingConstraint || record.contractFunction || "Ledger event",
    txHash: record.txHash || null,
    amount: formatUnits(record.amount || record.requiredAmount || 0, decimals)
  }));

  const intentEvents = intentHistory.flatMap((record) => {
    const intent = normalizeIntent(record, decimals);
    const stages = Array.isArray(record.timeline) && record.timeline.length > 0
      ? record.timeline.map((stage, index) => ({
          id: `${record.intentId || record.runId || "intent"}-${index}`,
          source: "payment_intent",
          timestamp: stage.timestamp || record.completedAt || record.timestamp || record.startedAt || null,
          type: "intent_stage",
          status: stage.status || record.status || "unknown",
          label: stage.stage || "Intent stage",
          detail: stage.detail || record.validation?.reason || record.execution?.reason || record.decision?.reasoning || "Payment intent stage",
          txHash: intent?.txHash || null,
          amount: intent?.amount || "0"
        }))
      : [{
          id: record.intentId || record.runId || `intent-${record.timestamp}`,
          source: "payment_intent",
          timestamp: record.completedAt || record.timestamp || record.startedAt || null,
          type: "payment_intent",
          status: record.status,
          label: "Payment intent",
          detail: record.validation?.reason
            || record.execution?.reason
            || record.decision?.reasoning
            || record.intent?.metadata?.task
            || "Payment intent",
          txHash: intent?.txHash || null,
          amount: intent?.amount || "0"
        }];

    return stages;
  });

  return [...runtimeEvents, ...intentEvents, ...ledgerEvents]
    .filter((event) => event.timestamp)
    .sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp))
    .slice(0, 50);
}

function qiePassStatus({ agent, agentId, ownerBinding, walletBinding, passBinding, vaultWhitelisted }) {
  const zeroPass = !agent?.qiePassId || /^0x0{64}$/i.test(agent.qiePassId);
  const checks = {
    active: Boolean(agent?.active),
    hasQiePassId: !zeroPass,
    ownerBound: BigInt(ownerBinding || 0) === BigInt(agentId),
    walletBound: BigInt(walletBinding || 0) === BigInt(agentId),
    passBound: BigInt(passBinding || 0) === BigInt(agentId),
    vaultWhitelisted: Boolean(vaultWhitelisted)
  };
  const verified = Object.values(checks).every(Boolean);

  return {
    status: verified ? "verified" : (checks.hasQiePassId ? "invalid" : "missing"),
    verified,
    qiePassId: agent?.qiePassId || null,
    checks
  };
}

async function buildAgentSnapshot(runtime, requestedAgentId) {
  const agentId = toPositiveUint(requestedAgentId || process.env.AGENT_ID || "1", "agentId");
  const runtimeStatus = runtime.agentRuntime.getStatus();
  const loopStatus = runtime.agentLoop.status();
  const runtimeHistory = runtime.agentRuntime.getHistory(100);
  const intentHistory = runtime.agentRuntime.getIntentHistory(100);
  const snapshot = {
    timestamp: new Date().toISOString(),
    agentId: agentId.toString(),
    runtime: {
      ...runtimeStatus,
      loop: loopStatus
    },
    network: null,
    contracts: null,
    agent: null,
    qiePass: null,
    budget: null,
    balances: null,
    decision: normalizeRuntimeDecision(runtimeStatus.lastRun),
    transaction: normalizeTransaction(runtimeStatus.lastRun, 18),
    metrics: {
      uptimeSeconds: Math.floor(process.uptime()),
      paymentsProcessed: 0,
      totalSpentWei: "0",
      totalSpent: "0",
      loopCycles: loopStatus.totalCycles || 0
    },
    history: {
      runtime: runtimeHistory,
      intents: intentHistory,
      ledger: [],
      timeline: []
    },
    error: null
  };

  try {
    const { contracts, ledger } = await getBlockchainRuntime(runtime);
    const owner = await contracts.signer.getAddress();
    const [blockNumber, tokenDecimals, agent, budget, vaultWhitelisted, qusdcBalance, vaultAllowance] = await Promise.all([
      contracts.provider.getBlockNumber(),
      contracts.qusdc.decimals().catch(() => 18),
      contracts.registry.getAgent(agentId),
      contracts.controller.getBudget(agentId),
      contracts.controller.isServiceWhitelisted(agentId, contracts.addresses.vault),
      contracts.qusdc.balanceOf(owner),
      contracts.qusdc.allowance(owner, contracts.addresses.vault)
    ]);
    const decimals = Number(tokenDecimals || 18);
    const [ownerBinding, walletBinding, passBinding] = await Promise.all([
      contracts.registry.ownerAgentId(agent.owner),
      contracts.registry.executionWalletAgentId(agent.agentWallet),
      contracts.registry.qiePassAgentId(agent.qiePassId)
    ]);
    const ledgerRecords = ledger.list({ agentId: agentId.toString(), limit: 100 });
    const allLedgerRecords = ledger.records.filter((record) => String(record.agentId || "") === agentId.toString());
    const paymentRecords = allLedgerRecords.filter((record) => (
      record.eventType === "contract_interaction"
        && record.status === "confirmed"
        && record.interactionType === "executePayment"
    ));
    const totalSpentWei = paymentRecords.reduce((total, record) => total + BigInt(record.amount || "0"), 0n);
    const onChainDailyLimit = BigInt(budget.dailyLimit || 0);
    const onChainSpentToday = BigInt(budget.spentToday || 0);
    const runtimeSpentToday = runtimeDailySpend(runtime.agentRuntime, agentId);
    const ledgerSpentToday = BigInt(ledger.dailyPaymentSpend(agentId));
    const spentToday = maxBigInt(onChainSpentToday, runtimeSpentToday, ledgerSpentToday);
    const defaultDailyLimit = runtime.agentRuntime.defaultDailyLimit;
    const demoLimit = runtime.agentRuntime.testModeLimit;
    const enforceableLimit = onChainDailyLimit > 0n && onChainDailyLimit < defaultDailyLimit
      ? onChainDailyLimit
      : defaultDailyLimit;
    const remainingWei = enforceableLimit > spentToday ? enforceableLimit - spentToday : 0n;
    const constraints = [
      { name: "enforceableLimit", value: enforceableLimit },
      { name: "remainingWei", value: remainingWei },
      { name: "qusdcBalance", value: BigInt(qusdcBalance) },
      { name: "demoLimit", value: demoLimit },
      { name: "defaultDailyLimit", value: defaultDailyLimit }
    ];
    const limitingConstraint = minPositiveConstraint(constraints);
    const ledgerDecision = latestByTimestamp(ledgerRecords.filter((record) => record.eventType === "agent_decision"));
    const runtimeDecision = latestByTimestamp(runtimeHistory.filter((record) => record.decision));
    const intentDecision = latestByTimestamp(intentHistory.filter((record) => record.decision));
    const latestDecision = latestByTimestamp([
      normalizeLedgerDecision(ledgerDecision),
      normalizeRuntimeDecision(runtimeDecision),
      normalizeRuntimeDecision(intentDecision)
    ]);
    const ledgerTx = latestByTimestamp(paymentRecords);
    const runtimeTx = latestByTimestamp(runtimeHistory.filter((record) => record.transaction?.executePayment?.txHash));
    const intentTx = latestByTimestamp(intentHistory.filter((record) => record.transaction?.executePayment?.txHash));
    const latestTransaction = latestByTimestamp([
      normalizeTransaction(ledgerTx, decimals),
      normalizeTransaction(runtimeTx, decimals),
      normalizeTransaction(intentTx, decimals)
    ]);
    const normalizedIntents = intentHistory.map((record) => normalizeIntent(record, decimals));
    const pendingApprovals = runtime.agentRuntime.getPendingApprovals(100).map((record) => normalizeIntent(record, decimals));
    const finalizedIntents = normalizedIntents.filter((record) => ["executed", "failed", "rejected"].includes(record.status));
    const executedIntents = normalizedIntents.filter((record) => record.status === "executed");
    const successfulPaymentsToday = finalizedIntents.filter((record) => {
      const timestamp = new Date(record.timestamp || record.completedAt || 0).getTime();
      return record.status === "executed" && timestamp >= startOfUtcDay();
    });
    const successRate = finalizedIntents.length > 0
      ? Number(((executedIntents.length * 10000) / finalizedIntents.length)) / 100
      : null;
    const averagePaymentSizeWei = executedIntents.length > 0
      ? executedIntents.reduce((total, record) => total + BigInt(record.amountWei || "0"), 0n) / BigInt(executedIntents.length)
      : 0n;
    const largestPaymentSizeWei = executedIntents.reduce((largest, record) => {
      const amountWei = BigInt(record.amountWei || "0");
      return amountWei > largest ? amountWei : largest;
    }, 0n);
    const paymentsToday = successfulPaymentsToday.length;
    const failedValidations = normalizedIntents.filter((record) => record.status === "rejected" && record.validation).length;
    const successfulPayments = executedIntents.length;
    const failedPayments = normalizedIntents.filter((record) => ["failed", "rejected"].includes(record.status)).length;
    const totalPayments = normalizedIntents.length;

    snapshot.network = {
      chainId: CHAIN_ID,
      name: NETWORK_NAME,
      blockNumber
    };
    snapshot.contracts = contracts.addresses;
    snapshot.agent = {
      id: agentId.toString(),
      owner: agent.owner,
      agentWallet: agent.agentWallet,
      qiePassId: agent.qiePassId,
      active: Boolean(agent.active),
      createdAt: agent.createdAt.toString()
    };
    snapshot.qiePass = qiePassStatus({
      agent,
      agentId,
      ownerBinding,
      walletBinding,
      passBinding,
      vaultWhitelisted
    });
    snapshot.budget = {
      dailyLimitWei: onChainDailyLimit.toString(),
      dailyLimit: formatUnits(onChainDailyLimit, decimals),
      spentTodayWei: spentToday.toString(),
      spentToday: formatUnits(spentToday, decimals),
      onChainSpentTodayWei: onChainSpentToday.toString(),
      runtimeSpentTodayWei: runtimeSpentToday.toString(),
      ledgerSpentTodayWei: ledgerSpentToday.toString(),
      remainingWei: remainingWei.toString(),
      remaining: formatUnits(remainingWei, decimals),
      safeSpendLimitWei: limitingConstraint.value.toString(),
      safeSpendLimit: formatUnits(limitingConstraint.value, decimals),
      limitingConstraint: limitingConstraint.name,
      defaultDailyLimitWei: defaultDailyLimit.toString(),
      demoLimitWei: demoLimit.toString(),
      paused: Boolean(budget.paused),
      vaultWhitelisted: Boolean(vaultWhitelisted),
      constraints: Object.fromEntries(constraints.map((constraint) => [constraint.name, constraint.value.toString()]))
    };
    snapshot.balances = {
      owner,
      qusdcWei: BigInt(qusdcBalance).toString(),
      qusdc: formatUnits(qusdcBalance, decimals),
      vaultAllowanceWei: BigInt(vaultAllowance).toString(),
      vaultAllowance: formatUnits(vaultAllowance, decimals),
      tokenDecimals: decimals
    };
    snapshot.decision = latestDecision || snapshot.decision;
    snapshot.transaction = latestTransaction || snapshot.transaction;
    snapshot.metrics = {
      ...snapshot.metrics,
      paymentsProcessed: paymentRecords.length,
      totalSpentWei: totalSpentWei.toString(),
      totalSpent: formatUnits(totalSpentWei, decimals),
      latestBlock: blockNumber,
      intentsReceived: intentHistory.length,
      intentsExecuted: successfulPayments,
      intentsRejected: intentHistory.filter((record) => record.status === "rejected").length,
      intentsFailed: intentHistory.filter((record) => record.status === "failed").length,
      totalPayments,
      totalQusdcSpent: formatUnits(totalSpentWei, decimals),
      paymentsToday,
      successRate,
      failedValidations,
      successfulPayments,
      failedPayments,
      largestPaymentWei: largestPaymentSizeWei.toString(),
      largestPayment: largestPaymentSizeWei > 0n ? formatUnits(largestPaymentSizeWei, decimals) : "0",
      averagePaymentWei: averagePaymentSizeWei.toString(),
      averagePayment: averagePaymentSizeWei > 0n ? formatUnits(averagePaymentSizeWei, decimals) : "0",
      averagePaymentSize: averagePaymentSizeWei > 0n ? formatUnits(averagePaymentSizeWei, decimals) : "0",
      currentDailyBudgetRemaining: formatUnits(remainingWei, decimals),
      pendingApprovals: pendingApprovals.length,
      manualApprovalEnabled: Boolean(runtime.agentRuntime.getPolicy?.()?.manualApprovalEnabled)
    };
    snapshot.history = {
      runtime: runtimeHistory,
      intents: normalizedIntents,
      ledger: ledgerRecords,
      timeline: buildTimeline({ runtimeHistory, intentHistory, ledgerRecords, decimals })
    };
    snapshot.pendingApprovals = pendingApprovals;
    snapshot.settings = runtime.agentRuntime.getPolicy();
    snapshot.analytics = {
      totalPayments,
      totalQusdcSpent: formatUnits(totalSpentWei, decimals),
      paymentsToday,
      successRate,
      failedValidations,
      successfulPayments,
      failedPayments,
      largestPayment: largestPaymentSizeWei > 0n ? formatUnits(largestPaymentSizeWei, decimals) : "0",
      averagePayment: averagePaymentSizeWei > 0n ? formatUnits(averagePaymentSizeWei, decimals) : "0",
      averagePaymentSize: averagePaymentSizeWei > 0n ? formatUnits(averagePaymentSizeWei, decimals) : "0",
      currentDailyBudgetRemaining: formatUnits(remainingWei, decimals)
    };
  } catch (error) {
    snapshot.error = error.shortMessage || error.reason || error.message || String(error);
  }

  return bigintJson(snapshot);
}

function logStartupConfig() {
  let parsedDefaultDailyLimit = null;
  let parsedTestModeLimit = null;
  let resolvedQusdc = null;
  let resolvedQusdcSource = null;
  try {
    parsedDefaultDailyLimit = BigInt(process.env.DEFAULT_DAILY_LIMIT || "").toString();
  } catch (_error) {
    parsedDefaultDailyLimit = "INVALID";
  }
  try {
    parsedTestModeLimit = process.env.TEST_MODE_LIMIT_WEI
      ? BigInt(process.env.TEST_MODE_LIMIT_WEI).toString()
      : ethers.parseUnits(
        String(process.env.TEST_MODE_LIMIT || process.env.TEST_MODE_LIMIT_QIE || "0.05"),
        18
      ).toString();
  } catch (_error) {
    parsedTestModeLimit = "INVALID";
  }
  try {
    const deployment = loadDeployment();
    resolvedQusdc = deployment.addresses.qusdc;
    resolvedQusdcSource = process.env.QUSDC_ADDRESS ? "env" : "deployment";
  } catch (error) {
    resolvedQusdc = error.message;
    resolvedQusdcSource = "unresolved";
  }

  console.log(JSON.stringify({
    eventType: "startup_config",
    DEFAULT_DAILY_LIMIT: process.env.DEFAULT_DAILY_LIMIT || null,
    parsedDefaultDailyLimit,
    TEST_MODE_LIMIT: process.env.TEST_MODE_LIMIT || process.env.TEST_MODE_LIMIT_QIE || "0.05",
    TEST_MODE_LIMIT_WEI: process.env.TEST_MODE_LIMIT_WEI || null,
    parsedTestModeLimit,
    PAYMENT_INTENT_AMOUNT: process.env.PAYMENT_INTENT_AMOUNT || process.env.DEFAULT_PAYMENT_INTENT_AMOUNT || "0.05",
    QIE_STABLECOIN_ADDRESS: process.env.QIE_STABLECOIN_ADDRESS || null,
    QUSDC_MODE: process.env.QUSDC_MODE || null,
    QUSDC_ADDRESS: process.env.QUSDC_ADDRESS || null,
    MOCK_QUSDC_ADDRESS: process.env.MOCK_QUSDC_ADDRESS || null,
    resolvedQusdc,
    resolvedQusdcSource
  }));
}

function makeRuntime() {
  const runtime = {
    agentRuntime: null,
    agentLoop: null,
    blockchainRuntime: null
  };

  runtime.agentRuntime = new AgentRuntime({
    getBlockchainRuntime: () => getBlockchainRuntime(runtime)
  });
  runtime.agentLoop = new AgentLoop({
    agentRuntime: runtime.agentRuntime
  });

  return runtime;
}

async function getBlockchainRuntime(runtime) {
  if (runtime.blockchainRuntime) {
    return runtime.blockchainRuntime;
  }

  const contracts = makeContracts();
  const ledger = new AgentLedger();
  const vaultToken = await contracts.vault.qieStablecoin();
  const tokenMatchesQusdc = ethers.getAddress(vaultToken) === ethers.getAddress(contracts.addresses.qusdc);
  ledger.append({
    eventType: "qusdc_config",
    status: tokenMatchesQusdc ? "ok" : "mismatch",
    runtimeQusdc: contracts.addresses.qusdc,
    vaultToken,
    source: process.env.QUSDC_ADDRESS ? "env" : "deployment"
  });
  if (!tokenMatchesQusdc) {
    if (isMockQusdcMode()) {
      const reason = "QUSDC_MODE=mock requires StreamVault.qieStablecoin to match the configured mock QUSDC token";
      ledger.append({
        eventType: "qusdc_config",
        status: "blocked",
        runtimeQusdc: contracts.addresses.qusdc,
        vaultToken,
        reason
      });
      throw new Error(`${reason}. StreamVault token: ${vaultToken}; configured QUSDC: ${contracts.addresses.qusdc}. Redeploy the protocol with QUSDC_MODE=mock or point MOCK_QUSDC_ADDRESS at the vault token.`);
    }

    ledger.append({
      eventType: "qusdc_config_warning",
      status: "warning",
      runtimeQusdc: contracts.addresses.qusdc,
      vaultToken,
      reason: "StreamVault payment token differs from configured QUSDC; runtime QUSDC was not overwritten"
    });
  }
  let liquidityEngine = null;
  if (isMockQusdcMode()) {
    ledger.append({
      eventType: "qiedex_liquidity_engine",
      status: "disabled",
      reason: "QUSDC_MODE_MOCK_BYPASS"
    });
  } else {
    try {
      liquidityEngine = new LiquidityEngine({
        factory: contracts.qiedexFactory,
        router: contracts.qiedexRouter,
        wqie: contracts.addresses.wqie,
        qusdc: contracts.addresses.qusdc,
        ledger
      });
    } catch (error) {
      ledger.append({
        eventType: "qiedex_liquidity_engine",
        status: "disabled",
        reason: error.shortMessage || error.message
      });
    }
  }
  const engine = new AutonomousAgentEngine(contracts, ledger, { liquidityEngine });
  await engine.start();

  runtime.blockchainRuntime = {
    contracts,
    engine,
    ledger,
    liquidityEngine
  };

  return runtime.blockchainRuntime;
}

function makeApp(runtime = makeRuntime()) {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, agent: runtime.agentRuntime.getStatus() });
  });

  app.post("/agent/run", async (req, res, next) => {
    try {
      const result = await runtime.agentRuntime.run(req.body);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/payment-intents", async (req, res, next) => {
    try {
      const result = await runtime.agentRuntime.submitPaymentIntent(req.body);
      res.status(result.ok ? 200 : 422).json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/payment-intents/preview", async (req, res, next) => {
    try {
      const result = await runtime.agentRuntime.previewPaymentIntent(req.body);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/payment-intents/:intentId/approve", async (req, res, next) => {
    try {
      const result = await runtime.agentRuntime.approvePaymentIntent(req.params.intentId, req.body);
      res.status(result.ok ? 200 : 422).json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/payment-intents/:intentId/reject", async (req, res, next) => {
    try {
      const result = await runtime.agentRuntime.rejectPaymentIntent(req.params.intentId, req.body);
      res.status(result.ok ? 200 : 422).json(result);
    } catch (error) {
      next(error);
    }
  });

  app.get("/payment-intents", (req, res) => {
    const intents = runtime.agentRuntime.getIntentHistory(req.query.limit);
    res.json({
      intents,
      records: intents
    });
  });

  app.get("/agent/status", (_req, res) => {
    res.json(runtime.agentRuntime.getStatus());
  });

  app.get("/agent/snapshot", async (req, res, next) => {
    try {
      res.json(await buildAgentSnapshot(runtime, req.query.agentId));
    } catch (error) {
      next(error);
    }
  });

  app.get("/agent/events", async (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    res.write("retry: 4000\n\n");

    let closed = false;
    const sendSnapshot = async () => {
      if (closed) return;
      try {
        const snapshot = await buildAgentSnapshot(runtime, req.query.agentId);
        res.write(`event: snapshot\n`);
        res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
      } catch (error) {
        res.write(`event: error\n`);
        res.write(`data: ${JSON.stringify({ error: error.shortMessage || error.message })}\n\n`);
      }
    };

    await sendSnapshot();
    const timer = setInterval(sendSnapshot, SNAPSHOT_EVENT_INTERVAL_MS);
    req.on("close", () => {
      closed = true;
      clearInterval(timer);
      res.end();
    });
  });

  app.get("/agent/history", (req, res) => {
    const history = runtime.agentRuntime.getHistory(req.query.limit);
    const intents = runtime.agentRuntime.getIntentHistory(req.query.limit);
    res.json({
      history,
      intents,
      records: history
    });
  });

  app.post("/agent/start-loop", (req, res) => {
    const tasks = Array.isArray(req.body?.tasks) ? req.body.tasks : [];
    if (req.body?.task) {
      tasks.push(req.body);
    }

    const status = tasks.length > 0
      ? runtime.agentLoop.start(tasks)
      : runtime.agentLoop.status();
    res.json({
      ...status,
      mode: "intent-driven",
      message: tasks.length > 0
        ? "Queued explicit task for policy evaluation. External payment intents are the standard execution trigger."
        : "Agent loop did not start because SpendGrid now executes only explicit payment intents or queued tasks."
    });
  });

  app.post("/agent/stop-loop", (_req, res) => {
    res.json(runtime.agentLoop.stop());
  });

  app.get("/agent/loop-status", (_req, res) => {
    res.json(runtime.agentLoop.status());
  });

  app.post("/create-agent", async (req, res, next) => {
    try {
      const { contracts } = await getBlockchainRuntime(runtime);
      const ownerAddress = await contracts.signer.getAddress();
      const agentWallet = req.body.agentWallet || ownerAddress;
      const qiePassId = normalizeBytes32(req.body.qiePassId);
      const dailyLimit = toUint(req.body.dailyLimit || process.env.DEFAULT_DAILY_LIMIT, "dailyLimit");

      if (!ethers.isAddress(agentWallet)) {
        throw new Error("agentWallet must be a valid address");
      }

      const registerTx = await contracts.registry.registerAgent(agentWallet, qiePassId);
      const registerReceipt = await registerTx.wait();
      const registered = findEvent(registerReceipt, contracts.registry.interface, "AgentRegistered");
      const agentId = registered.args.agentId;

      const budgetTx = await contracts.controller.setBudget(agentId, dailyLimit);
      await budgetTx.wait();

      const whitelistTx = await contracts.controller.setServiceWhitelist(agentId, contracts.addresses.vault, true);
      await whitelistTx.wait();

      let approvalHash = null;
      if (req.body.approveAmount) {
        const approveAmount = toUint(req.body.approveAmount, "approveAmount");
        const approveTx = await contracts.qusdc.approve(contracts.addresses.vault, approveAmount);
        await approveTx.wait();
        approvalHash = approveTx.hash;
      }

      res.json(
        bigintJson({
          agentId,
          owner: ownerAddress,
          agentWallet,
          qiePassId,
          dailyLimit,
          registerTx: registerTx.hash,
          budgetTx: budgetTx.hash,
          whitelistTx: whitelistTx.hash,
          approvalTx: approvalHash
        })
      );
    } catch (error) {
      next(error);
    }
  });

  app.post("/run-task", async (req, res, next) => {
    try {
      const { engine } = await getBlockchainRuntime(runtime);
      res.json(
        await engine.runTask({
          action: req.body.streamId ? "executePayment" : "createStream",
          agentId: req.body.agentId,
          prompt: req.body.prompt,
          streamId: req.body.streamId,
          receiver: req.body.receiver,
          ratePerUnit: req.body.ratePerUnit,
          units: req.body.units,
          closeAfterRun: req.body.closeAfterRun
        })
      );
    } catch (error) {
      next(error);
    }
  });

  app.post("/pause-agent", async (req, res, next) => {
    try {
      const { contracts, ledger } = await getBlockchainRuntime(runtime);
      const agentId = toPositiveUint(req.body.agentId, "agentId");
      const tx = await contracts.controller.pauseAgent(agentId);
      const receipt = await tx.wait();
      ledger.append({
        eventType: "contract_interaction",
        status: receipt.status === 1 ? "confirmed" : "failed",
        agentId,
        interactionType: "pauseAgent",
        contractInteractionType: "pauseAgent",
        contractFunction: "pauseAgent",
        contractAddress: contracts.addresses.controller,
        txHash: tx.hash,
        gasUsed: receipt.gasUsed,
        blockNumber: receipt.blockNumber
      });
      res.json(bigintJson({ agentId, paused: true, txHash: tx.hash, gasUsed: receipt.gasUsed }));
    } catch (error) {
      next(error);
    }
  });

  app.post("/unpause-agent", async (req, res, next) => {
    try {
      const { contracts, ledger } = await getBlockchainRuntime(runtime);
      const agentId = toPositiveUint(req.body.agentId, "agentId");
      const tx = await contracts.controller.unpauseAgent(agentId);
      const receipt = await tx.wait();
      ledger.append({
        eventType: "contract_interaction",
        status: receipt.status === 1 ? "confirmed" : "failed",
        agentId,
        interactionType: "unpauseAgent",
        contractInteractionType: "unpauseAgent",
        contractFunction: "unpauseAgent",
        contractAddress: contracts.addresses.controller,
        txHash: tx.hash,
        gasUsed: receipt.gasUsed,
        blockNumber: receipt.blockNumber
      });
      res.json(bigintJson({ agentId, paused: false, txHash: tx.hash, gasUsed: receipt.gasUsed }));
    } catch (error) {
      next(error);
    }
  });

  app.get("/status/:agentId", async (req, res, next) => {
    try {
      const { engine } = await getBlockchainRuntime(runtime);
      res.json(await engine.status(req.params.agentId));
    } catch (error) {
      next(error);
    }
  });

  app.use((error, _req, res, _next) => {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ error: error.shortMessage || error.message || "Internal server error" });
  });

  return app;
}

function start() {
  logStartupConfig();
  const runtime = makeRuntime();
  const port = Number(process.env.PORT || 8080);
  makeApp(runtime).listen(port, () => {
    console.log(`SpendGrid Agent Runtime listening on port ${port}`);
  });
}

if (require.main === module) {
  start();
}

module.exports = {
  getBlockchainRuntime,
  makeApp,
  makeRuntime,
  start
};
