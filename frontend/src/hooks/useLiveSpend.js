import { useState, useEffect, useRef } from "react";

const MOCK_AGENTS = [
  { id: "AGT-001", task: "LLM Inference", spend: 18420, budget: 20000, status: "active" },
  { id: "AGT-002", task: "Data Indexing", spend: 9100, budget: 15000, status: "active" },
  { id: "AGT-003", task: "Oracle Queries", spend: 6050, budget: 12000, status: "paused" },
  { id: "AGT-004", task: "Storage Writes", spend: 14800, budget: 20000, status: "active" },
];

function generateTick(agents) {
  return agents.map((a) => {
    if (a.status !== "active") return a;
    const delta = Math.floor(Math.random() * 120 + 10);
    return { ...a, spend: Math.min(a.budget, a.spend + delta) };
  });
}

export function useLiveSpend(interval = 2500) {
  const [agents, setAgents] = useState(MOCK_AGENTS);
  const [txCount, setTxCount] = useState(1847);
  const timerRef = useRef(null);

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setAgents((prev) => generateTick(prev));
      setTxCount((c) => c + Math.floor(Math.random() * 3 + 1));
    }, interval);
    return () => clearInterval(timerRef.current);
  }, [interval]);

  const totalSpend = agents.reduce((s, a) => s + a.spend, 0);
  const totalBudget = agents.reduce((s, a) => s + a.budget, 0);
  const remaining = totalBudget - totalSpend;
  const activeAgent = agents.find((a) => a.status === "active") || agents[0];

  return { agents, totalSpend, totalBudget, remaining, txCount, activeAgent };
}
