import { useEffect, useMemo, useRef, useState } from "react";
import { ethers } from "ethers";
import { api } from "../lib/api";

const DEFAULT_AGENT_ID = process.env.REACT_APP_AGENT_ID || "1";

function weiToQie(value) {
  try {
    return Number(ethers.formatEther(value || "0"));
  } catch (_error) {
    return 0;
  }
}

function findBudget(history) {
  const record = history.find((item) => item.budget?.enforceableLimit || item.budget?.defaultDailyLimit);
  const budgetWei = record?.budget?.enforceableLimit || record?.budget?.defaultDailyLimit;
  const budget = weiToQie(budgetWei);
  return budget || Number(process.env.REACT_APP_AGENT_DAILY_LIMIT_QIE || 0);
}

function formatAgent(loopStatus, history) {
  const agentId = DEFAULT_AGENT_ID;
  const spentToday = weiToQie(loopStatus?.cumulativeSpending);
  const paused = !loopStatus?.running;
  const lastDecision = loopStatus?.lastDecision;
  const lastRun = history.find((record) => record.decision || record.status);
  const lastAction = lastDecision?.action || lastRun?.decision?.action || lastRun?.status;

  return {
    id: `AGT-${agentId.padStart(3, "0")}`,
    task: lastAction || "Autonomous Execution",
    spend: spentToday,
    budget: findBudget(history),
    status: paused ? "paused" : "active",
  };
}

export function useLiveSpend(interval = 4000) {
  const [loopStatus, setLoopStatus] = useState(null);
  const [history, setHistory] = useState([]);
  const timerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const [nextLoopStatus, nextHistory] = await Promise.all([
          api.getAgentLoopStatus(),
          api.getAgentHistory({ agentId: DEFAULT_AGENT_ID, limit: 50 }),
        ]);

        if (!cancelled) {
          setLoopStatus(nextLoopStatus);
          setHistory(nextHistory.records || []);
        }
      } catch (_error) {
        if (!cancelled) {
          setLoopStatus(null);
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
    const activeAgent = formatAgent(loopStatus, history);
    const txCount = history.filter((record) => record.transaction?.executePayment?.txHash).length;
    const totalSpend = activeAgent.spend;
    const totalBudget = activeAgent.budget;
    const remaining = Math.max(0, totalBudget - totalSpend);
    const lastDecision = loopStatus?.lastDecision || null;
    const lastTransactionHash = loopStatus?.lastTransactionHash || null;

    return {
      agents: [activeAgent],
      history,
      lastDecision,
      lastTransactionHash,
      loopStatus,
      totalSpend,
      totalBudget,
      remaining,
      txCount,
      activeAgent,
    };
  }, [history, loopStatus]);
}
