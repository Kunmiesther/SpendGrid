import { useCallback, useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { api } from "../lib/api";
import { loadDeployment } from "../lib/deployment";
import { useAgentSnapshot } from "./useAgentSnapshot";

const DEFAULT_AGENT_ID = process.env.REACT_APP_AGENT_ID || "1";
const DEFAULT_AGENT_PROMPT =
  process.env.REACT_APP_AGENT_PROMPT || "Run a bounded SpendGrid inference payment on QIE Mainnet.";
const DEFAULT_RECEIVER = process.env.REACT_APP_AGENT_RECEIVER || "";
const DEFAULT_INTENT_AMOUNT = process.env.REACT_APP_PAYMENT_INTENT_AMOUNT || process.env.REACT_APP_AGENT_RATE_PER_UNIT || "0.05";
const QUSDC_DECIMALS = Number(process.env.REACT_APP_QUSDC_DECIMALS || "6");

export function useAgentRuntime(interval = 4000) {
  const live = useAgentSnapshot(interval);
  const [deployment, setDeployment] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);

  const agentId = DEFAULT_AGENT_ID;
  const liveRefresh = live.refresh;
  const liveSnapshot = live.snapshot;

  const refresh = useCallback(async () => {
    try {
      const [nextDeployment] = await Promise.all([
        loadDeployment(),
        liveRefresh()
      ]);
      setDeployment(nextDeployment);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, [liveRefresh]);

  const buildPaymentIntent = useCallback(async () => {
    const activeDeployment = deployment || (await loadDeployment());
    const amountWei = ethers.parseUnits(DEFAULT_INTENT_AMOUNT, QUSDC_DECIMALS).toString();
    return {
      agentId,
      recipient: DEFAULT_RECEIVER || activeDeployment?.deployer || activeDeployment?.addresses?.agentRegistry,
      amountWei,
      metadata: {
        task: DEFAULT_AGENT_PROMPT,
        source: "dashboard",
        amount: DEFAULT_INTENT_AMOUNT,
        tokenDecimals: QUSDC_DECIMALS
      }
    };
  }, [agentId, deployment]);

  const submitIntent = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const intent = await buildPaymentIntent();
      const result = await api.submitPaymentIntent(intent);
      await liveRefresh();
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setRunning(false);
    }
  }, [buildPaymentIntent, liveRefresh]);

  const stopAgent = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const result = await api.stopAgentLoop();
      await liveRefresh();
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setRunning(false);
    }
  }, [liveRefresh]);

  useEffect(() => {
    loadDeployment()
      .then(setDeployment)
      .catch((err) => setError(err.message));
  }, []);

  const contractAddresses = liveSnapshot.contracts || deployment?.addresses || {};
  const effectiveLoopStatus = liveSnapshot.runtime?.loop || null;
  const lastDecision = liveSnapshot.decision || effectiveLoopStatus?.lastDecision || null;
  const lastTransactionHash = liveSnapshot.transaction?.txHash || effectiveLoopStatus?.lastTransactionHash || null;
  const totalSpent = Number(liveSnapshot.metrics?.totalSpent || 0);

  return useMemo(
    () => ({
      agentId,
      contractAddresses,
      deployment,
      error: error || live.error,
      history: liveSnapshot.history?.runtime || [],
      intents: liveSnapshot.history?.intents || [],
      lastDecision,
      lastTransactionHash,
      loopStatus: effectiveLoopStatus,
      refresh,
      running: running || Boolean(effectiveLoopStatus?.inFlight),
      snapshot: liveSnapshot,
      startAgent: submitIntent,
      submitIntent,
      stopAgent,
      status: liveSnapshot.runtime || null,
      paymentIntent: {
        amount: DEFAULT_INTENT_AMOUNT,
        amountWei: ethers.parseUnits(DEFAULT_INTENT_AMOUNT, QUSDC_DECIMALS).toString(),
        tokenDecimals: QUSDC_DECIMALS
      },
      totalSpent,
    }),
    [
      agentId,
      contractAddresses,
      deployment,
      error,
      live.error,
      lastDecision,
      lastTransactionHash,
      effectiveLoopStatus,
      liveSnapshot,
      refresh,
      running,
      submitIntent,
      stopAgent,
      totalSpent,
    ]
  );
}
