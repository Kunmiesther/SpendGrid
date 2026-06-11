require("dotenv").config();

const cors = require("cors");
const express = require("express");
const { ethers } = require("ethers");
const { AgentLoop } = require("./services/agentLoop");
const { AgentRuntime } = require("./services/agentRuntime");
const { AutonomousAgentEngine } = require("./src/engine");
const { makeContracts } = require("./src/contracts");
const { AgentLedger } = require("./src/ledger");
const { bigintJson, findEvent, normalizeBytes32, toPositiveUint, toUint } = require("./src/utils");

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
  const engine = new AutonomousAgentEngine(contracts, ledger);
  await engine.start();

  runtime.blockchainRuntime = {
    contracts,
    engine,
    ledger
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
        const approveTx = await contracts.stablecoin.approve(contracts.addresses.vault, approveAmount);
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
