import { useMemo } from "react";
import { useAgentSnapshot } from "./useAgentSnapshot";

const DEFAULT_AGENT_ID = process.env.REACT_APP_AGENT_ID || "1";

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatAgent(snapshot) {
  const agentId = String(snapshot.agentId || DEFAULT_AGENT_ID);
  const budget = snapshot.budget || {};
  const runtime = snapshot.runtime || {};
  const lastDecision = snapshot.decision || runtime.loop?.lastDecision;
  const active = Boolean(snapshot.agent?.active);
  const paused = Boolean(budget.paused);
  const executing = Boolean(runtime.status === "executing_intent" || runtime.status === "validating_intent" || runtime.loop?.inFlight);
  const latestIntent = snapshot.history?.intents?.[0] || null;

  return {
    id: `AGT-${agentId.padStart(3, "0")}`,
    task: latestIntent?.metadata?.task || lastDecision?.action || runtime.status || "Intent policy evaluation",
    spend: toNumber(budget.spentToday),
    budget: toNumber(budget.dailyLimit),
    remaining: toNumber(budget.remaining),
    status: paused ? "paused" : executing ? "executing" : active ? "active" : "inactive",
  };
}

export function useLiveSpend(interval = 4000) {
  const { connected, error, refresh, snapshot } = useAgentSnapshot(interval);

  return useMemo(() => {
    const activeAgent = formatAgent(snapshot);
    const txCount = snapshot.metrics?.paymentsProcessed || 0;
    const totalSpend = activeAgent.spend;
    const totalBudget = activeAgent.budget;
    const remaining = activeAgent.remaining;
    const lastDecision = snapshot.decision || snapshot.runtime?.loop?.lastDecision || null;
    const lastTransactionHash = snapshot.transaction?.txHash || snapshot.runtime?.loop?.lastTransactionHash || null;
    const intents = snapshot.history?.intents || [];
    const latestIntent = intents[0] || null;

    return {
      agents: [activeAgent],
      connected,
      error,
      history: snapshot.history?.runtime || [],
      intents,
      latestIntent,
      lastDecision,
      lastTransactionHash,
      loopStatus: snapshot.runtime?.loop || null,
      refresh,
      snapshot,
      totalSpend,
      totalBudget,
      remaining,
      txCount,
      intentCount: snapshot.metrics?.intentsReceived || intents.length,
      activeAgent,
    };
  }, [connected, error, refresh, snapshot]);
}
