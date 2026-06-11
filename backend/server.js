require("dotenv").config();

const fs = require("fs");
const path = require("path");
const cors = require("cors");
const express = require("express");
const { ethers } = require("ethers");

const ERC20_ABI = [
  "function approve(address spender,uint256 amount) external returns (bool)",
  "function allowance(address owner,address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)"
];

const eventCache = {
  agents: new Map(),
  budgets: new Map(),
  streams: new Map(),
  payments: []
};

const ZERO_ADDRESS = ethers.ZeroAddress.toLowerCase();

function resolveFromRoot(filePath) {
  if (!filePath) {
    return filePath;
  }

  return path.isAbsolute(filePath) ? filePath : path.join(__dirname, "..", filePath);
}

function loadDeployment() {
  const explicitPath = resolveFromRoot(process.env.DEPLOYMENT_PATH);
  const defaultPath = path.join(__dirname, "..", "deployments", "qie-testnet.json");
  const legacyPath = path.join(__dirname, "..", "deployments", "qieTestnet.json");
  const deploymentPath = explicitPath || (fs.existsSync(defaultPath) ? defaultPath : legacyPath);

  if (!fs.existsSync(deploymentPath)) {
    return {};
  }

  return JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
}

function loadArtifact(contractName) {
  const artifactPath = path.join(
    __dirname,
    "..",
    "artifacts",
    "contracts",
    `${contractName}.sol`,
    `${contractName}.json`
  );

  if (!fs.existsSync(artifactPath)) {
    throw new Error(`Missing ${contractName} artifact. Run npm run compile first.`);
  }

  return JSON.parse(fs.readFileSync(artifactPath, "utf8"));
}

function isZeroAddress(value) {
  return ethers.isAddress(value) && value.toLowerCase() === ZERO_ADDRESS;
}

function envAddress(name, ...fallbacks) {
  const envValue = process.env[name];
  if (envValue) {
    if (ethers.isAddress(envValue) && !isZeroAddress(envValue)) {
      return ethers.getAddress(envValue);
    }
    if (!isZeroAddress(envValue)) {
      throw new Error(`${name} must be set to a valid address`);
    }
  }

  for (const fallback of fallbacks) {
    if (fallback && ethers.isAddress(fallback) && !isZeroAddress(fallback)) {
      return ethers.getAddress(fallback);
    }
  }

  throw new Error(`${name} must be set to a deployed non-zero address`);
}

function normalizeBytes32(value) {
  if (!value) {
    throw new Error("qiePassId is required");
  }
  if (ethers.isHexString(value, 32)) {
    return value;
  }
  return ethers.id(String(value));
}

function toUint(value, fieldName) {
  if (value === undefined || value === null || value === "") {
    throw new Error(`${fieldName} is required`);
  }
  const parsed = BigInt(value);
  if (parsed < 0n) {
    throw new Error(`${fieldName} cannot be negative`);
  }
  return parsed;
}

function bigintJson(value) {
  return JSON.parse(
    JSON.stringify(value, (_key, innerValue) => (typeof innerValue === "bigint" ? innerValue.toString() : innerValue))
  );
}

function findEvent(receipt, contractInterface, eventName) {
  for (const log of receipt.logs) {
    try {
      const parsed = contractInterface.parseLog(log);
      if (parsed && parsed.name === eventName) {
        return parsed;
      }
    } catch (_error) {
      // Logs from other contracts are expected in the same transaction.
    }
  }

  throw new Error(`Event ${eventName} not found in transaction ${receipt.hash}`);
}

function simulateAiExecution(prompt, requestedUnits) {
  const safePrompt = String(prompt || "");
  const usageUnits = requestedUnits ? BigInt(requestedUnits) : BigInt(Math.max(1, Math.ceil(safePrompt.length / 512)));

  return {
    provider: "placeholder-ai",
    output: `Simulated AI response for ${safePrompt.length} input characters.`,
    usageUnits
  };
}

function makeContracts() {
  const deployment = loadDeployment();
  const rpcUrl = process.env.QIE_RPC_URL;
  const privateKey = process.env.BACKEND_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;

  if (!rpcUrl) throw new Error("QIE_RPC_URL is required");
  if (!privateKey) throw new Error("BACKEND_PRIVATE_KEY or DEPLOYER_PRIVATE_KEY is required");

  const provider = new ethers.JsonRpcProvider(rpcUrl, 1983);
  const signer = new ethers.Wallet(privateKey, provider);

  const registryAddress = envAddress(
    "AGENT_REGISTRY_ADDRESS",
    deployment.registry,
    deployment.agentRegistry,
    deployment.addresses?.agentRegistry
  );
  const controllerAddress = envAddress(
    "SPEND_CONTROLLER_ADDRESS",
    deployment.controller,
    deployment.spendController,
    deployment.addresses?.spendController
  );
  const vaultAddress = envAddress(
    "STREAM_VAULT_ADDRESS",
    deployment.vault,
    deployment.streamVault,
    deployment.addresses?.streamVault
  );
  const stablecoinAddress = envAddress(
    "QIE_STABLECOIN_ADDRESS",
    deployment.stable,
    deployment.qieStablecoin,
    deployment.addresses?.mockQIEStable
  );

  const registryArtifact = loadArtifact("AgentRegistry");
  const controllerArtifact = loadArtifact("SpendController");
  const vaultArtifact = loadArtifact("StreamVault");

  return {
    provider,
    signer,
    addresses: {
      registry: registryAddress,
      controller: controllerAddress,
      vault: vaultAddress,
      stablecoin: stablecoinAddress
    },
    registry: new ethers.Contract(registryAddress, registryArtifact.abi, signer),
    controller: new ethers.Contract(controllerAddress, controllerArtifact.abi, signer),
    vault: new ethers.Contract(vaultAddress, vaultArtifact.abi, signer),
    stablecoin: new ethers.Contract(stablecoinAddress, ERC20_ABI, signer)
  };
}

function wireEventListeners(contracts) {
  const { registry, controller, vault } = contracts;

  registry.on("AgentRegistered", (agentId, owner, agentWallet, qiePassId, createdAt, event) => {
    eventCache.agents.set(agentId.toString(), { agentId, owner, agentWallet, qiePassId, createdAt });
    console.log("AgentRegistered", bigintJson({ agentId, owner, agentWallet, qiePassId, txHash: event.log.transactionHash }));
  });

  registry.on("AgentDeactivated", (agentId, owner, agentWallet, qiePassId, deactivatedAt, event) => {
    eventCache.agents.set(agentId.toString(), {
      agentId,
      owner,
      agentWallet,
      qiePassId,
      active: false,
      deactivatedAt
    });
    console.log("AgentDeactivated", bigintJson({ agentId, owner, agentWallet, txHash: event.log.transactionHash }));
  });

  controller.on("BudgetUpdated", (agentId, dailyLimit, spentToday, lastResetTimestamp, updatedBy, event) => {
    eventCache.budgets.set(agentId.toString(), { agentId, dailyLimit, spentToday, lastResetTimestamp, updatedBy });
    console.log("BudgetUpdated", bigintJson({ agentId, dailyLimit, spentToday, txHash: event.log.transactionHash }));
  });

  controller.on("AgentPaused", (agentId, pausedBy, event) => {
    console.log("AgentPaused", bigintJson({ agentId, pausedBy, txHash: event.log.transactionHash }));
  });

  controller.on("AgentUnpaused", (agentId, unpausedBy, event) => {
    console.log("AgentUnpaused", bigintJson({ agentId, unpausedBy, txHash: event.log.transactionHash }));
  });

  controller.on("SpendApproved", (agentId, service, amount, spentToday, dailyLimit, timestamp, event) => {
    console.log(
      "SpendApproved",
      bigintJson({ agentId, service, amount, spentToday, dailyLimit, timestamp, txHash: event.log.transactionHash })
    );
  });

  vault.on(
    "StreamCreated",
    (streamId, agentId, payer, receiver, ratePerUnit, createdAt, event) => {
      eventCache.streams.set(streamId.toString(), { streamId, agentId, payer, receiver, ratePerUnit, createdAt });
      console.log("StreamCreated", bigintJson({ streamId, agentId, payer, receiver, txHash: event.log.transactionHash }));
    }
  );

  vault.on(
    "PaymentExecuted",
    (streamId, agentId, payer, receiver, token, units, amount, ratePerUnit, totalUnits, totalPaid, timestamp, event) => {
      const payment = {
        streamId,
        agentId,
        payer,
        receiver,
        token,
        units,
        amount,
        ratePerUnit,
        totalUnits,
        totalPaid,
        timestamp,
        txHash: event.log.transactionHash
      };
      eventCache.payments.unshift(payment);
      eventCache.payments = eventCache.payments.slice(0, 100);
      console.log("PaymentExecuted", bigintJson(payment));
    }
  );

  vault.on("StreamClosed", (streamId, agentId, payer, receiver, totalUnits, totalPaid, closedAt, event) => {
    console.log("StreamClosed", bigintJson({ streamId, agentId, payer, receiver, totalUnits, totalPaid, closedAt, txHash: event.log.transactionHash }));
  });
}

function makeApp(contracts) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, chainId: 1983, addresses: contracts.addresses });
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
      const agentId = toUint(req.body.agentId, "agentId");
      const aiResult = simulateAiExecution(req.body.prompt, req.body.units);
      let streamId = req.body.streamId ? toUint(req.body.streamId, "streamId") : null;
      let createStreamTx = null;

      if (!streamId) {
        const receiver = req.body.receiver;
        const ratePerUnit = toUint(req.body.ratePerUnit, "ratePerUnit");

        if (!ethers.isAddress(receiver)) {
          throw new Error("receiver must be a valid address when streamId is not supplied");
        }

        const tx = await contracts.vault.createStream(agentId, receiver, ratePerUnit);
        const receipt = await tx.wait();
        const created = findEvent(receipt, contracts.vault.interface, "StreamCreated");
        streamId = created.args.streamId;
        createStreamTx = tx.hash;
      }

      const stream = await contracts.vault.getStream(streamId);
      const amount = stream.ratePerUnit * aiResult.usageUnits;
      const allowed = await contracts.controller.canSpendFor(agentId, contracts.addresses.vault, amount);

      if (!allowed) {
        return res.status(402).json(bigintJson({ error: "Spend blocked by budget controls", agentId, streamId, amount }));
      }

      const executeTx = await contracts.vault.executePayment(streamId, aiResult.usageUnits);
      await executeTx.wait();

      let closeTx = null;
      if (req.body.closeAfterRun === true) {
        const tx = await contracts.vault.closeStream(streamId);
        await tx.wait();
        closeTx = tx.hash;
      }

      res.json(
        bigintJson({
          agentId,
          streamId,
          usageUnits: aiResult.usageUnits,
          amount,
          ai: aiResult,
          createStreamTx,
          executePaymentTx: executeTx.hash,
          closeStreamTx: closeTx
        })
      );
    } catch (error) {
      next(error);
    }
  });

  app.post("/pause-agent", async (req, res, next) => {
    try {
      const agentId = toUint(req.body.agentId, "agentId");
      const tx = await contracts.controller.pauseAgent(agentId);
      await tx.wait();
      res.json(bigintJson({ agentId, paused: true, txHash: tx.hash }));
    } catch (error) {
      next(error);
    }
  });

  app.get("/status/:agentId", async (req, res, next) => {
    try {
      const agentId = toUint(req.params.agentId, "agentId");
      const agent = await contracts.registry.getAgent(agentId);
      const budget = await contracts.controller.getBudget(agentId);
      const vaultWhitelisted = await contracts.controller.isServiceWhitelisted(agentId, contracts.addresses.vault);
      const payerBalance = await contracts.stablecoin.balanceOf(agent.owner);
      const vaultAllowance = await contracts.stablecoin.allowance(agent.owner, contracts.addresses.vault);

      res.json(
        bigintJson({
          agentId,
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
            paused: budget.paused
          },
          vaultWhitelisted,
          ownerStablecoinBalance: payerBalance,
          vaultAllowance,
          recentPayments: eventCache.payments.filter((payment) => payment.agentId.toString() === agentId.toString()).slice(0, 10)
        })
      );
    } catch (error) {
      next(error);
    }
  });

  app.use((error, _req, res, _next) => {
    console.error(error);
    res.status(500).json({ error: error.shortMessage || error.message || "Internal server error" });
  });

  return app;
}

if (require.main === module) {
  const contracts = makeContracts();
  wireEventListeners(contracts);

  const port = Number(process.env.PORT || 8080);
  makeApp(contracts).listen(port, () => {
    console.log(`SpendGrid backend listening on port ${port}`);
    contracts.signer.getAddress().then((address) => {
      console.log(`Signer: ${address}`);
    });
  });
}

module.exports = {
  makeApp,
  makeContracts,
  simulateAiExecution
};
