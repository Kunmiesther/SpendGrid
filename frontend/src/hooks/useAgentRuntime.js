import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  const [history, setHistory] = useState([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const timerRef = useRef(null);

  const agentId = DEFAULT_AGENT_ID;

  const refresh = useCallback(async () => {
    try {
      const [nextDeployment, nextStatus, nextHistory] = await Promise.all([
        loadDeployment(),
        api.getAgentStatus(agentId),
        api.getAgentHistory({ agentId, limit: 50 }),
      ]);

      setDeployment(nextDeployment);
      setStatus(nextStatus);
      setHistory(nextHistory.records || []);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, [agentId]);

  const runAgent = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const activeDeployment = deployment || (await loadDeployment());
      const payload = {
        agentId,
        prompt: DEFAULT_AGENT_PROMPT,
        ratePerUnit: DEFAULT_RATE_PER_UNIT,
        closeAfterRun: false,
      };

      const activeStream = history.find(
        (record) => record.eventType === "contract_interaction" && record.interactionType === "createStream" && record.streamId
      );

      if (activeStream) {
        payload.streamId = activeStream.streamId;
        delete payload.ratePerUnit;
      } else {
        payload.receiver = DEFAULT_RECEIVER || activeDeployment?.deployer || activeDeployment?.addresses?.agentRegistry;
      }

      const result = await api.runAgent(payload);
      await refresh();
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setRunning(false);
    }
  }, [agentId, history, refresh]);

  useEffect(() => {
    refresh();
    timerRef.current = setInterval(refresh, interval);
    return () => clearInterval(timerRef.current);
  }, [interval, refresh]);

  const contractAddresses = deployment?.addresses || {};

  return useMemo(
    () => ({
      agentId,
      contractAddresses,
      deployment,
      error,
      history,
      refresh,
      runAgent,
      running,
      status,
    }),
    [agentId, contractAddresses, deployment, error, history, refresh, runAgent, running, status]
  );
}
