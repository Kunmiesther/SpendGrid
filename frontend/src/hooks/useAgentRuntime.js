import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  const submitIntentPromiseRef = useRef(null);
  const stopAgentPromiseRef = useRef(null);

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

  const buildPaymentIntent = useCallback(async (overrides = {}) => {
    const activeDeployment = deployment || (await loadDeployment());
    const amountValue = overrides.amount !== undefined && overrides.amount !== null && overrides.amount !== ""
      ? String(overrides.amount)
      : DEFAULT_INTENT_AMOUNT;
    const amountWei = overrides.amountWei !== undefined && overrides.amountWei !== null && overrides.amountWei !== ""
      ? String(overrides.amountWei)
      : ethers.parseUnits(amountValue, QUSDC_DECIMALS).toString();
    const recipient = overrides.recipient || DEFAULT_RECEIVER || activeDeployment?.deployer || activeDeployment?.addresses?.agentRegistry;
    const metadata = {
      task: overrides.metadata?.task || DEFAULT_AGENT_PROMPT,
      source: overrides.metadata?.source || "dashboard",
      amount: amountValue,
      tokenDecimals: QUSDC_DECIMALS,
      category: overrides.metadata?.category || null,
      description: overrides.metadata?.description || null,
      templateId: overrides.metadata?.templateId || null
    };
    return {
      agentId,
      recipient,
      amountWei,
      metadata,
      policy: overrides.policy || null
    };
  }, [agentId, deployment]);

  const previewIntent = useCallback(async (overrides = {}) => {
    setError(null);
    try {
      const intent = await buildPaymentIntent(overrides);
      return await api.previewPaymentIntent(intent);
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }, [buildPaymentIntent]);

  const submitIntent = useCallback(async (overrides = {}) => {
    if (submitIntentPromiseRef.current) {
      return submitIntentPromiseRef.current;
    }

    setRunning(true);
    setError(null);
    const request = (async () => {
      const intent = await buildPaymentIntent(overrides);
      const result = await api.submitPaymentIntent(intent);
      await liveRefresh();
      return result;
    })();

    submitIntentPromiseRef.current = request.finally(() => {
      submitIntentPromiseRef.current = null;
      setRunning(false);
    });

    try {
      return await submitIntentPromiseRef.current;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }, [buildPaymentIntent, liveRefresh]);

  const stopAgent = useCallback(async () => {
    if (stopAgentPromiseRef.current) {
      return stopAgentPromiseRef.current;
    }

    setRunning(true);
    setError(null);
    const request = (async () => {
      const result = await api.stopAgentLoop();
      await liveRefresh();
      return result;
    })();

    stopAgentPromiseRef.current = request.finally(() => {
      stopAgentPromiseRef.current = null;
      setRunning(false);
    });

    try {
      return await stopAgentPromiseRef.current;
    } catch (err) {
      setError(err.message);
      throw err;
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
      previewIntent,
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
      previewIntent,
      submitIntent,
      stopAgent,
      totalSpent,
    ]
  );
}
