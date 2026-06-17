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
const { loadDeployment } = require("./src/deployment");
const { isMockQusdcMode } = require("./src/qusdcMode");
const { bigintJson, findEvent, normalizeBytes32, toPositiveUint, toUint } = require("./src/utils");

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

  app.get("/agent/status", (_req, res) => {
    res.json(runtime.agentRuntime.getStatus());
  });

  app.get("/agent/history", (req, res) => {
    const history = runtime.agentRuntime.getHistory(req.query.limit);
    res.json({
      history,
      records: history
    });
  });

  app.post("/agent/start-loop", (req, res) => {
    const tasks = Array.isArray(req.body?.tasks) ? req.body.tasks : [];
    if (req.body?.task) {
      tasks.push(req.body);
    }

    res.json(runtime.agentLoop.start(tasks));
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
