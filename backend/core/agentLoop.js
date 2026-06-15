const aiSentry = require("../services/aiSentry");

const RECOMMENDATIONS = new Set(["HOLD", "SWAP_PREPARATION", "REDUCE_SPEND"]);

function nowTimestamp() {
  return Date.now();
}

function isObject(value) {
  return value !== null && typeof value === "object";
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function toBigInt(value, fallback = 0n) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  try {
    return BigInt(value);
  } catch (_error) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }

    return BigInt(Math.floor(parsed));
  }
}

function errorMessage(error) {
  return error?.shortMessage || error?.reason || error?.message || String(error);
}

function safeJson(value) {
  return JSON.parse(
    JSON.stringify(value, (_key, innerValue) => (typeof innerValue === "bigint" ? innerValue.toString() : innerValue))
  );
}

function appendLog(state, entry) {
  const record = {
    timestamp: new Date().toISOString(),
    ...entry
  };

  if (state?.ledger && typeof state.ledger.append === "function") {
    try {
      state.ledger.append(record);
    } catch (_error) {
      // Logging should never break the treasury cycle.
    }
  }

  return record;
}

function getLiquidityEngine(state) {
  return firstDefined(
    state?.liquidityEngine,
    state?.runtime?.liquidityEngine,
    state?.blockchainRuntime?.liquidityEngine
  );
}

function getContracts(state) {
  return firstDefined(
    state?.contracts,
    state?.runtime?.contracts,
    state?.blockchainRuntime?.contracts
  ) || {};
}

function getSpendGate(state) {
  const contracts = getContracts(state);

  return firstDefined(
    state?.spendGate,
    state?.spendController,
    state?.spendControllerAdapter,
    contracts.spendController,
    contracts.controller
  );
}

function getPaymentExecutor(state) {
  const contracts = getContracts(state);

  return firstDefined(
    state?.paymentExecutor,
    state?.spendController?.executePayment ? state.spendController : null,
    state?.spendControllerAdapter?.executePayment ? state.spendControllerAdapter : null,
    contracts.vault,
    state?.streamVault,
    state?.vault
  );
}

function getTokenAddresses(state) {
  const contracts = getContracts(state);
  const addresses = isObject(state?.addresses) ? state.addresses : {};
  const contractAddresses = isObject(contracts.addresses) ? contracts.addresses : {};

  return {
    wqie: firstDefined(state?.wqie, state?.wqieAddress, state?.WQIE, addresses.wqie, addresses.WQIE, contractAddresses.wqie),
    qusdc: firstDefined(state?.qusdc, state?.qusdcAddress, state?.QUSDC, addresses.qusdc, addresses.QUSDC, contractAddresses.qusdc),
    vault: firstDefined(state?.vaultAddress, addresses.vault, contractAddresses.vault)
  };
}

function getQusdcBalance(state) {
  return toBigInt(firstDefined(
    state?.qusdcBalanceWei,
    state?.qUSDCBalanceWei,
    state?.requiredBalanceWei,
    state?.balances?.qusdcWei,
    state?.balances?.QUSDCWei,
    state?.balances?.qusdc?.amountWei,
    state?.balances?.QUSDC?.amountWei,
    state?.balances?.qusdc?.balanceWei,
    state?.balances?.QUSDC?.balanceWei,
    state?.qusdcBalance,
    state?.qUSDCBalance,
    state?.balance,
    state?.balances?.qusdc?.amount,
    state?.balances?.QUSDC?.amount,
    state?.balances?.qusdc?.balance,
    state?.balances?.QUSDC?.balance,
    isObject(state?.balances?.qusdc) ? null : state?.balances?.qusdc,
    isObject(state?.balances?.QUSDC) ? null : state?.balances?.QUSDC
  ));
}

async function getOwner(state) {
  const contracts = getContracts(state);
  const owner = firstDefined(state?.owner, state?.wallet, state?.walletAddress, state?.payer);
  if (owner) {
    return owner;
  }
  if (contracts.signer && typeof contracts.signer.getAddress === "function") {
    return contracts.signer.getAddress();
  }

  return null;
}

async function readQusdcBalance(state) {
  if (typeof state?.getQusdcBalance === "function") {
    return toBigInt(await state.getQusdcBalance());
  }

  const contracts = getContracts(state);
  const owner = await getOwner(state);
  if (contracts.qusdc && typeof contracts.qusdc.balanceOf === "function" && owner) {
    return toBigInt(await contracts.qusdc.balanceOf(owner));
  }

  return getQusdcBalance(state);
}

function getRequiredPaymentAmount(state) {
  const payment = isObject(state?.payment) ? state.payment : {};
  const duePayment = isObject(state?.paymentDue) ? state.paymentDue : {};
  const subscription = isObject(state?.subscription) ? state.subscription : {};

  return toBigInt(firstDefined(
    state?.requiredAmount,
    state?.requiredAmountWei,
    state?.amount,
    state?.amountWei,
    state?.paymentAmount,
    state?.paymentAmountWei,
    payment.requiredAmount,
    payment.requiredAmountWei,
    payment.amount,
    payment.amountWei,
    duePayment.requiredAmount,
    duePayment.requiredAmountWei,
    duePayment.amount,
    duePayment.amountWei,
    subscription.requiredAmount,
    subscription.requiredAmountWei,
    subscription.amount,
    subscription.amountWei
  ));
}

function getPaymentArgs(state) {
  const payment = isObject(state?.payment) ? state.payment : {};
  const duePayment = isObject(state?.paymentDue) ? state.paymentDue : {};
  const subscription = isObject(state?.subscription) ? state.subscription : {};

  return {
    agentId: firstDefined(state?.agentId, payment.agentId, duePayment.agentId, subscription.agentId),
    streamId: firstDefined(state?.streamId, payment.streamId, duePayment.streamId, subscription.streamId),
    units: toBigInt(firstDefined(state?.units, payment.units, duePayment.units, subscription.units, 1), 1n),
    amount: getRequiredPaymentAmount(state),
    receiver: firstDefined(state?.receiver, payment.receiver, duePayment.receiver, subscription.receiver)
  };
}

function isCriticalPayment(state) {
  const payment = isObject(state?.payment) ? state.payment : {};
  const duePayment = isObject(state?.paymentDue) ? state.paymentDue : {};
  const subscription = isObject(state?.subscription) ? state.subscription : {};
  const value = firstDefined(
    state?.critical,
    state?.isCritical,
    state?.paymentCritical,
    payment.critical,
    payment.isCritical,
    duePayment.critical,
    duePayment.isCritical,
    subscription.critical,
    subscription.isCritical
  );

  return value === true || value === "true" || value === "critical" || value === 1;
}

async function waitForReceipt(tx) {
  if (tx && typeof tx.wait === "function") {
    return tx.wait();
  }

  return null;
}

async function callHasLiquidity(liquidityEngine, state) {
  if (!liquidityEngine || typeof liquidityEngine.hasLiquidity !== "function") {
    return { ok: false, hasLiquidity: false, reason: "LIQUIDITY_ENGINE_UNAVAILABLE" };
  }

  const addresses = getTokenAddresses(state);
  try {
    if (typeof liquidityEngine.inspectLiquidity === "function") {
      const liquidity = await liquidityEngine.inspectLiquidity(addresses.wqie, addresses.qusdc);
      return {
        ok: true,
        hasLiquidity: Boolean(liquidity.hasLiquidity),
        reason: liquidity.reason || null,
        pair: liquidity.pair || null,
        diagnostic: liquidity.diagnostic || null
      };
    }

    const hasLiquidity = await liquidityEngine.hasLiquidity(addresses.wqie, addresses.qusdc);
    const diagnostic = typeof liquidityEngine.getLastDiagnostic === "function" ? liquidityEngine.getLastDiagnostic() : null;
    return {
      ok: true,
      hasLiquidity: Boolean(hasLiquidity),
      reason: diagnostic?.reason || null,
      pair: diagnostic?.pair || null,
      diagnostic
    };
  } catch (error) {
    return { ok: false, hasLiquidity: false, reason: errorMessage(error) };
  }
}

async function executeSwap(liquidityEngine, state, requiredAmount) {
  if (!liquidityEngine) {
    return { executed: false, reason: "LIQUIDITY_ENGINE_UNAVAILABLE" };
  }

  const addresses = getTokenAddresses(state);
  const owner = await getOwner(state);
  const amountIn = toBigInt(firstDefined(state?.swapAmount, state?.swapAmountWei, requiredAmount), requiredAmount);

  try {
    let result;
    if (typeof liquidityEngine.ensureQusdcBalance === "function") {
      result = await liquidityEngine.ensureQusdcBalance({
        tokenIn: addresses.wqie,
        tokenOut: addresses.qusdc,
        inputTokenContract: firstDefined(state?.wqieContract, getContracts(state).wqie),
        owner,
        requiredAmount,
        amountIn
      });
    } else if (typeof liquidityEngine.swapTokens === "function") {
      result = await liquidityEngine.swapTokens(addresses.wqie, addresses.qusdc, amountIn);
    } else if (typeof liquidityEngine.swap === "function") {
      result = await liquidityEngine.swap({
        tokenIn: addresses.wqie,
        tokenOut: addresses.qusdc,
        amountIn,
        owner,
        requiredAmount
      });
    } else {
      return { executed: false, reason: "SWAP_METHOD_UNAVAILABLE" };
    }

    const executed = Boolean(result?.swapped || result?.ok || result?.status === "confirmed");
    return {
      executed,
      reason: executed ? null : result?.reason || "SWAP_NOT_CONFIRMED",
      balance: firstDefined(result?.balance, result?.nextBalance, result?.qusdcBalance, result?.balanceWei),
      result
    };
  } catch (error) {
    return { executed: false, reason: errorMessage(error) };
  }
}

async function canSpend(spendController, state, paymentArgs) {
  if (!spendController || !paymentArgs.agentId || paymentArgs.amount <= 0n) {
    return { ok: true, allowed: true };
  }

  const addresses = getTokenAddresses(state);

  try {
    if (typeof spendController.canSpendFor === "function" && addresses.vault) {
      return {
        ok: true,
        allowed: Boolean(await spendController.canSpendFor(paymentArgs.agentId, addresses.vault, paymentArgs.amount))
      };
    }
    if (typeof spendController.canSpend === "function") {
      return {
        ok: true,
        allowed: Boolean(await spendController.canSpend(paymentArgs.agentId, paymentArgs.amount))
      };
    }
  } catch (error) {
    return { ok: false, allowed: false, reason: errorMessage(error) };
  }

  return { ok: true, allowed: true };
}

async function executePayment(spendController, state, paymentArgs) {
  if (!spendController || typeof spendController.executePayment !== "function") {
    return { executed: false, reason: "PAYMENT_EXECUTOR_UNAVAILABLE" };
  }

  try {
    const tx = paymentArgs.streamId !== undefined && paymentArgs.streamId !== null && paymentArgs.streamId !== ""
      ? await spendController.executePayment(paymentArgs.streamId, paymentArgs.units)
      : await spendController.executePayment(paymentArgs);
    const receipt = await waitForReceipt(tx);
    const confirmed = !receipt || receipt.status === undefined || receipt.status === 1;

    return {
      executed: confirmed,
      reason: confirmed ? null : "PAYMENT_NOT_CONFIRMED",
      txHash: tx?.hash || receipt?.hash || receipt?.transactionHash || null,
      receipt
    };
  } catch (error) {
    return { executed: false, reason: errorMessage(error) };
  }
}

async function runAgentCycle(state = {}) {
  const result = {
    cycleStatus: "FAILED",
    aiDecision: null,
    swapExecuted: false,
    paymentExecuted: false,
    timestamp: nowTimestamp()
  };
  const warnings = [];
  const errors = [];
  let liquidityChecked = false;

  try {
    const aiDecision = aiSentry.generateRecommendation(state);
    result.aiDecision = aiDecision;
    appendLog(state, {
      eventType: "agent_cycle_ai_decision",
      decision: aiDecision
    });

    if (!RECOMMENDATIONS.has(aiDecision.recommendation)) {
      throw new Error(`Unsupported AI Sentry recommendation: ${aiDecision.recommendation}`);
    }

    const liquidityEngine = getLiquidityEngine(state);
    const spendGate = getSpendGate(state);
    const paymentExecutor = getPaymentExecutor(state);
    const requiredPaymentAmount = getRequiredPaymentAmount(state);
    let currentQusdcBalance = await readQusdcBalance(state);

    if (aiDecision.recommendation === "SWAP_PREPARATION") {
      const liquidity = await callHasLiquidity(liquidityEngine, state);
      liquidityChecked = true;
      if (!liquidity.ok) {
        warnings.push(liquidity.reason);
        appendLog(state, {
          eventType: "agent_cycle_liquidity",
          status: "warning",
          reason: liquidity.reason
        });
      } else if (liquidity.hasLiquidity) {
        const swap = await executeSwap(liquidityEngine, state, requiredPaymentAmount);
        result.swapExecuted = swap.executed;
        if (swap.executed && swap.balance !== undefined) {
          currentQusdcBalance = toBigInt(swap.balance, currentQusdcBalance);
        } else if (swap.executed) {
          currentQusdcBalance = await readQusdcBalance(state);
        }
        if (!swap.executed) {
          warnings.push(swap.reason);
        }
        appendLog(state, {
          eventType: "agent_cycle_swap",
          status: swap.executed ? "confirmed" : "skipped",
          reason: swap.reason || null,
          result: swap.result || null
        });
      } else {
        warnings.push(liquidity.reason || "NO_LIQUIDITY");
        appendLog(state, {
          eventType: "agent_cycle_liquidity",
          status: "skipped",
          reason: liquidity.reason || "NO_LIQUIDITY",
          pair: liquidity.pair || null,
          diagnostic: liquidity.diagnostic || null
        });
      }
    }

    if (!liquidityChecked) {
      const liquidity = await callHasLiquidity(liquidityEngine, state);
      liquidityChecked = true;
      if (!liquidity.ok) {
        warnings.push(liquidity.reason);
        appendLog(state, {
          eventType: "agent_cycle_liquidity",
          status: "warning",
          reason: liquidity.reason
        });
      } else if (!liquidity.hasLiquidity) {
        warnings.push(liquidity.reason || "NO_LIQUIDITY");
        appendLog(state, {
          eventType: "agent_cycle_liquidity",
          status: "skipped",
          reason: liquidity.reason || "NO_LIQUIDITY",
          pair: liquidity.pair || null,
          diagnostic: liquidity.diagnostic || null
        });
      } else {
        appendLog(state, {
          eventType: "agent_cycle_liquidity",
          status: "checked"
        });
      }
    }

    if (aiDecision.recommendation === "REDUCE_SPEND") {
      warnings.push("REDUCE_SPEND_RECOMMENDED");
      appendLog(state, {
        eventType: "agent_cycle_warning",
        status: "warning",
        reason: "REDUCE_SPEND_RECOMMENDED",
        action: "pause_non_critical_payments"
      });
    }

    const paymentArgs = getPaymentArgs(state);
    if (aiDecision.recommendation === "REDUCE_SPEND" && !isCriticalPayment(state)) {
      warnings.push("NON_CRITICAL_PAYMENT_PAUSED");
      appendLog(state, {
        eventType: "agent_cycle_payment",
        status: "skipped",
        reason: "NON_CRITICAL_PAYMENT_PAUSED"
      });
    } else if (paymentArgs.amount <= 0n) {
      warnings.push("NO_PAYMENT_DUE");
      appendLog(state, {
        eventType: "agent_cycle_payment",
        status: "skipped",
        reason: "NO_PAYMENT_DUE"
      });
    } else if (currentQusdcBalance < paymentArgs.amount) {
      warnings.push("INSUFFICIENT_QUSDC");
      appendLog(state, {
        eventType: "agent_cycle_payment",
        status: "skipped",
        reason: "INSUFFICIENT_QUSDC",
        balance: currentQusdcBalance,
        requiredAmount: paymentArgs.amount
      });
    } else {
      const spendGateResult = await canSpend(spendGate, state, paymentArgs);
      if (!spendGateResult.ok || !spendGateResult.allowed) {
        warnings.push(spendGateResult.reason || "SPEND_CONTROLLER_REJECTED");
        appendLog(state, {
          eventType: "agent_cycle_payment",
          status: "blocked",
          reason: spendGateResult.reason || "SPEND_CONTROLLER_REJECTED"
        });
      } else {
        const payment = await executePayment(paymentExecutor, state, paymentArgs);
        result.paymentExecuted = payment.executed;
        if (!payment.executed) {
          warnings.push(payment.reason);
        }
        appendLog(state, {
          eventType: "agent_cycle_payment",
          status: payment.executed ? "confirmed" : "failed",
          reason: payment.reason || null,
          txHash: payment.txHash || null,
          receipt: payment.receipt || null
        });
      }
    }

    result.cycleStatus = result.paymentExecuted
      ? (warnings.length > 0 ? "PARTIAL" : "SUCCESS")
      : (warnings.length > 0 ? "PARTIAL" : "FAILED");
  } catch (error) {
    errors.push(errorMessage(error));
    appendLog(state, {
      eventType: "agent_cycle_failed",
      status: "failed",
      reason: errorMessage(error)
    });
    result.cycleStatus = "FAILED";
  }

  if (warnings.length > 0) {
    result.warnings = warnings.filter(Boolean);
  }
  if (errors.length > 0) {
    result.errors = errors.filter(Boolean);
  }

  return safeJson(result);
}

module.exports = {
  runAgentCycle
};
