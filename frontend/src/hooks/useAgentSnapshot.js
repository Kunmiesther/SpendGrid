import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";

const DEFAULT_AGENT_ID = process.env.REACT_APP_AGENT_ID || "1";

function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeSnapshot(payload) {
  const source = payload && typeof payload === "object" ? payload : {};
  const loop = source.runtime?.loop || {};
  const budget = source.budget || {};
  const balances = source.balances || {};
  const metrics = source.metrics || {};
  const qiePass = source.qiePass || {};

  return {
    ...source,
    agentId: String(source.agentId || DEFAULT_AGENT_ID),
    runtime: {
      status: source.runtime?.status || "unknown",
      totalRuns: asNumber(source.runtime?.totalRuns),
      lastRun: source.runtime?.lastRun || null,
      loop: {
        running: Boolean(loop.running),
        inFlight: Boolean(loop.inFlight),
        queuedTasks: asNumber(loop.queuedTasks),
        totalCycles: asNumber(loop.totalCycles),
        lastTransactionHash: loop.lastTransactionHash || null,
        lastDecision: loop.lastDecision || null,
        lastError: loop.lastError || null,
        cumulativeSpending: loop.cumulativeSpending || "0"
      }
    },
    budget: {
      ...budget,
      dailyLimit: budget.dailyLimit || "0",
      spentToday: budget.spentToday || "0",
      remaining: budget.remaining || "0",
      safeSpendLimit: budget.safeSpendLimit || "0",
      dailyLimitWei: budget.dailyLimitWei || "0",
      spentTodayWei: budget.spentTodayWei || "0",
      remainingWei: budget.remainingWei || "0",
      safeSpendLimitWei: budget.safeSpendLimitWei || "0",
      paused: Boolean(budget.paused),
      vaultWhitelisted: Boolean(budget.vaultWhitelisted)
    },
    balances: {
      ...balances,
      qusdc: balances.qusdc || "0",
      vaultAllowance: balances.vaultAllowance || "0",
      tokenDecimals: asNumber(balances.tokenDecimals, 18)
    },
    decision: source.decision || null,
    transaction: source.transaction || null,
    qiePass: {
      ...qiePass,
      status: qiePass.status || "unknown",
      verified: Boolean(qiePass.verified),
      checks: qiePass.checks || {}
    },
    metrics: {
      ...metrics,
      uptimeSeconds: asNumber(metrics.uptimeSeconds),
      paymentsProcessed: asNumber(metrics.paymentsProcessed),
      intentsReceived: asNumber(metrics.intentsReceived),
      intentsExecuted: asNumber(metrics.intentsExecuted),
      intentsRejected: asNumber(metrics.intentsRejected),
      intentsFailed: asNumber(metrics.intentsFailed),
      totalSpent: metrics.totalSpent || "0"
    },
    history: {
      runtime: Array.isArray(source.history?.runtime) ? source.history.runtime : [],
      intents: Array.isArray(source.history?.intents) ? source.history.intents : [],
      ledger: Array.isArray(source.history?.ledger) ? source.history.ledger : [],
      timeline: Array.isArray(source.history?.timeline) ? source.history.timeline : []
    },
    timestamp: source.timestamp || null,
    error: source.error || null
  };
}

const AgentSnapshotContext = createContext(null);

function useAgentSnapshotState(interval = 4000) {
  const [snapshot, setSnapshot] = useState(() => normalizeSnapshot(null));
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);
  const pollRef = useRef(null);

  const agentId = DEFAULT_AGENT_ID;

  const refresh = useCallback(async () => {
    try {
      const payload = await api.getAgentSnapshot(agentId);
      setSnapshot(normalizeSnapshot(payload));
      setError(null);
      return payload;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }, [agentId]);

  useEffect(() => {
    let cancelled = false;
    let eventSource = null;

    function startPolling() {
      if (pollRef.current) return;
      refresh().catch(() => {});
      pollRef.current = setInterval(() => {
        refresh().catch(() => {});
      }, interval);
    }

    if (typeof window !== "undefined" && "EventSource" in window) {
      eventSource = new EventSource(api.getAgentEventsUrl(agentId));
      eventSource.addEventListener("snapshot", (event) => {
        if (cancelled) return;
        try {
          setSnapshot(normalizeSnapshot(JSON.parse(event.data)));
          setConnected(true);
          setError(null);
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
        } catch (err) {
          setError(err.message);
        }
      });
      eventSource.onerror = () => {
        if (cancelled) return;
        setConnected(false);
        startPolling();
      };
    } else {
      startPolling();
    }

    return () => {
      cancelled = true;
      setConnected(false);
      if (eventSource) eventSource.close();
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [agentId, interval, refresh]);

  return useMemo(() => ({
    agentId,
    connected,
    error,
    refresh,
    snapshot
  }), [agentId, connected, error, refresh, snapshot]);
}

export function AgentSnapshotProvider({ children, interval = 4000 }) {
  const value = useAgentSnapshotState(interval);
  return (
    <AgentSnapshotContext.Provider value={value}>
      {children}
    </AgentSnapshotContext.Provider>
  );
}

export function useAgentSnapshot() {
  return useContext(AgentSnapshotContext) || {
    agentId: DEFAULT_AGENT_ID,
    connected: false,
    error: null,
    refresh: async () => null,
    snapshot: normalizeSnapshot(null)
  };
}
