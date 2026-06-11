require("dotenv").config();

const cors = require("cors");
const express = require("express");
const { ethers } = require("ethers");
const { AutonomousAgentEngine } = require("./src/engine");
const { makeContracts } = require("./src/contracts");
const { AgentLedger } = require("./src/ledger");
const { bigintJson, findEvent, normalizeBytes32, toPositiveUint, toUint } = require("./src/utils");

function makeRuntime() {
  const contracts = makeContracts();
  const ledger = new AgentLedger();
  const engine = new AutonomousAgentEngine(contracts, ledger);

  return {
    contracts,
    engine,
    ledger
  };
}

function makeApp(runtime) {
  const { contracts, engine } = runtime;
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", async (_req, res, next) => {
    try {
      res.json(await engine.status());
    } catch (error) {
      next(error);
    }
  });

  app.post("/agent/run", async (req, res, next) => {
    try {
      res.json(await engine.runTask(req.body));
    } catch (error) {
      next(error);
    }
  });

  app.get("/agent/status", async (req, res, next) => {
    try {
      res.json(await engine.status(req.query.agentId));
    } catch (error) {
      next(error);
    }
  });

  app.get("/agent/history", (req, res, next) => {
    try {
      res.json(
        engine.history({
          agentId: req.query.agentId,
          eventType: req.query.eventType,
          limit: req.query.limit
        })
      );
    } catch (error) {
      next(error);
    }
  });

  app.post("/create-agent", async (req, res, next) => {
    try {
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
      const agentId = toPositiveUint(req.body.agentId, "agentId");
      const tx = await contracts.controller.pauseAgent(agentId);
      const receipt = await tx.wait();
      runtime.ledger.append({
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
      res.json(await engine.status(req.params.agentId));
    } catch (error) {
      next(error);
    }
  });

  app.use((error, _req, res, _next) => {
    const statusCode = error.message && error.message.includes("exceeded") ? 402 : 500;
    runtime.ledger.append({
      eventType: "agent_error",
      status: "failed",
      error: error.shortMessage || error.message || "Internal server error"
    });
    res.status(statusCode).json({ error: error.shortMessage || error.message || "Internal server error" });
  });

  return app;
}

async function start() {
  const runtime = makeRuntime();
  await runtime.engine.start();

  const port = Number(process.env.PORT || 8080);
  makeApp(runtime).listen(port, async () => {
    const signer = await runtime.contracts.signer.getAddress();
    console.log(`SpendGrid autonomous agent engine listening on port ${port}`);
    console.log(`Signer: ${signer}`);
  });
}

if (require.main === module) {
  start().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  makeApp,
  makeRuntime,
  start
};
