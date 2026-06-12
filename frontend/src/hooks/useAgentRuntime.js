import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ethers } from "ethers";
import { api } from "../lib/api";
import { loadDeployment } from "../lib/deployment";

const DEFAULT_AGENT_ID = process.env.REACT_APP_AGENT_ID || "1";
const DEFAULT_AGENT_PROMPT =
  process.env.REACT_APP_AGENT_PROMPT || "Run a bounded SpendGrid inference payment on QIE testnet.";
const DEFAULT_RECEIVER = process.env.REACT_APP_AGENT_RECEIVER || "";
const DEFAULT_RATE_PER_UNIT = process.env.REACT_APP_AGENT_RATE_PER_UNIT || "1";

export function useAgentRuntime(interval = 4000) {
  const [deployment, setDeployment] = useState(null);
  const [status, setStatus] = useState(null);
  const [loopStatus, setLoopStatus] = useState(null);
  const [history, setHistory] = useState([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const timerRef = useRef(null);

  const agentId = DEFAULT_AGENT_ID;

  const refresh = useCallback(async () => {
    try {
      const [nextDeployment, nextStatus, nextHistory] = await Promise.all([
        loadDeployment(),
        api.getAgentLoopStatus(),
        api.getAgentHistory({ agentId, limit: 50 }),
      ]);

      setDeployment(nextDeployment);
      setLoopStatus(nextStatus);
      setStatus(nextStatus);
      setHistory(nextHistory.records || []);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, [agentId]);

  const buildLoopTask = useCallback(async () => {
    const activeDeployment = deployment || (await loadDeployment());
    const task = {
      agentId,
      task: DEFAULT_AGENT_PROMPT,
      prompt: DEFAULT_AGENT_PROMPT,
      ratePerUnit: DEFAULT_RATE_PER_UNIT,
      closeAfterRun: false,
    };

    const activeRun = history.find(
      (record) => record.status === "spent" && record.transaction?.executePayment?.streamId
    );

    if (activeRun?.transaction?.executePayment?.streamId) {
      task.streamId = activeRun.transaction.executePayment.streamId;
      delete task.ratePerUnit;
    } else {
      task.receiver = DEFAULT_RECEIVER || activeDeployment?.deployer || activeDeployment?.addresses?.agentRegistry;
    }

    return task;
  }, [agentId, deployment, history]);

  const startAgent = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const task = await buildLoopTask();
      const result = await api.startAgentLoop({ tasks: [task] });
      await refresh();
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setRunning(false);
    }
  }, [buildLoopTask, refresh]);

  const stopAgent = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const result = await api.stopAgentLoop();
      setLoopStatus(result);
      setStatus(result);
      await refresh();
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setRunning(false);
    }
  }, [refresh]);

  useEffect(() => {
    refresh();
    timerRef.current = setInterval(refresh, interval);
    return () => clearInterval(timerRef.current);
  }, [interval, refresh]);

  const contractAddresses = deployment?.addresses || {};
  const lastDecision = loopStatus?.lastDecision || null;
  const lastTransactionHash = loopStatus?.lastTransactionHash || null;
  const totalSpent = loopStatus?.cumulativeSpending
    ? Number(ethers.formatEther(loopStatus.cumulativeSpending))
    : 0;

  return useMemo(
    () => ({
      agentId,
      contractAddresses,
      deployment,
      error,
      history,
      lastDecision,
      lastTransactionHash,
      loopStatus,
      refresh,
      running: running || Boolean(loopStatus?.inFlight),
      startAgent,
      stopAgent,
      status,
      totalSpent,
    }),
    [
      agentId,
      contractAddresses,
      deployment,
      error,
      history,
      lastDecision,
      lastTransactionHash,
      loopStatus,
      refresh,
      running,
      startAgent,
      status,
      stopAgent,
      totalSpent,
    ]
  );
}
