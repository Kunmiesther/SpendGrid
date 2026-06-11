import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";

const DEFAULT_AGENT_ID = process.env.REACT_APP_AGENT_ID || "1";

function toNumber(value) {
  const raw = Number(value || 0);
  if (!Number.isFinite(raw)) return 0;
  return raw;
}

function formatAgent(status, history) {
  const agentId = status?.agentId ? status.agentId.toString() : DEFAULT_AGENT_ID;
  const budget = status?.budget || {};
  const dailyLimit = toNumber(budget.dailyLimit);
  const spentToday = toNumber(budget.spentToday);
  const paused = Boolean(budget.paused);

  const lastAction = history.find((record) => record.eventType === "agent_run_completed")?.finalAction;

  return {
    id: `AGT-${agentId.padStart(3, "0")}`,
    task: lastAction || "Autonomous Execution",
    spend: spentToday,
    budget: dailyLimit,
    status: paused ? "paused" : "active",
  };
}

export function useLiveSpend(interval = 4000) {
  const [status, setStatus] = useState(null);
  const [history, setHistory] = useState([]);
  const timerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const [nextStatus, nextHistory] = await Promise.all([
          api.getAgentStatus(DEFAULT_AGENT_ID),
          api.getAgentHistory({ agentId: DEFAULT_AGENT_ID, limit: 50 }),
        ]);

        if (!cancelled) {
          setStatus(nextStatus);
          setHistory(nextHistory.records || []);
        }
      } catch (_error) {
        if (!cancelled) {
          setStatus(null);
          setHistory([]);
        }
      }
    }

    refresh();
    timerRef.current = setInterval(refresh, interval);

    return () => {
      cancelled = true;
      clearInterval(timerRef.current);
    };
  }, [interval]);

  return useMemo(() => {
    const activeAgent = formatAgent(status, history);
    const txCount = history.filter((record) => record.eventType === "contract_interaction").length;
    const totalSpend = activeAgent.spend;
    const totalBudget = activeAgent.budget;
    const remaining = Math.max(0, totalBudget - totalSpend);

    return {
      agents: [activeAgent],
      totalSpend,
      totalBudget,
      remaining,
      txCount,
      activeAgent,
    };
  }, [history, status]);
}
