import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useInView } from "../hooks/useInView";
import { useLiveSpend } from "../hooks/useLiveSpend";

const QIE_TX_EXPLORER_URL = "https://mainnet.qie.digital/tx/";

function SpendStat({ label, value, mono = true, accent = false }) {
  return (
    <div className="border-b border-wire last:border-b-0 py-6 first:pt-0">
      <p className="stat-label mb-2">{label}</p>
      <AnimatePresence mode="wait">
        <motion.p
          key={value}
          initial={{ opacity: 0.5 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.25 }}
          className={`${mono ? "font-mono" : "font-sans"} text-display-md font-medium tabular-nums ${accent ? "text-ink-0" : "text-ink-1"}`}
        >
          {value}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}

function shortHash(hash) {
  if (!hash) return "None";
  return `${hash.slice(0, 10)}...${hash.slice(-6)}`;
}

function TxHashLink({ hash }) {
  if (!hash) return "None";

  return (
    <a
      href={`${QIE_TX_EXPLORER_URL}${hash}`}
      target="_blank"
      rel="noopener noreferrer"
      className="hover:text-ink-0 transition-colors underline decoration-wire underline-offset-4"
    >
      {shortHash(hash)}
    </a>
  );
}

function BudgetBar({ used, total }) {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  const color = pct > 85 ? "bg-red-500" : pct > 60 ? "bg-amber-500" : "bg-ink-2";
  return (
    <div className="mt-8">
      <div className="flex justify-between items-baseline mb-2">
        <span className="stat-label">Daily utilization</span>
        <span className="font-mono text-body-sm text-ink-2">{pct}%</span>
      </div>
      <div className="h-px w-full bg-wire overflow-hidden">
        <motion.div
          className={`h-full ${color}`}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        />
      </div>
    </div>
  );
}

export default function LiveSpend() {
  const [ref, inView] = useInView(0.15);
  const {
    activeAgent,
    agents,
    connected,
    error,
    intentCount,
    lastDecision,
    lastTransactionHash,
    latestIntent,
    loopStatus,
    snapshot,
    totalSpend,
    totalBudget,
    remaining,
    txCount,
  } = useLiveSpend();

  const fmt = (n) =>
    n.toLocaleString(undefined, {
      maximumFractionDigits: 6,
    });
  const tokenSymbol = "QUSDC";
  const decisionLabel = lastDecision
    ? `${lastDecision.action || "decision"}${lastDecision.amount ? ` ${lastDecision.amount} ${tokenSymbol}` : ""}`
    : "None";
  const statusLabel = snapshot.runtime?.status === "executing_intent"
    ? "Executing intent"
    : snapshot.runtime?.status === "validating_intent"
      ? "Validating intent"
      : loopStatus?.running
        ? "Compatibility loop"
        : "Intent-ready";
  const transportLabel = connected ? "Live stream" : "Polling";
  const validationLabel = latestIntent?.validation?.status || "None";
  const executionLabel = latestIntent?.status || "None";

  return (
    <section id="dashboard" ref={ref} className="bg-surface-0 border-t border-wire py-section">
      <span id="live-spend" className="block -mt-20 pt-20" aria-hidden="true" />
      <div className="container-grid">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="mb-16"
        >
          <p className="tag mb-6">Live intents</p>
          <h2 className="text-display-md font-sans font-medium text-ink-0 max-w-xl text-balance">
            Spending that updates when intents execute.
          </h2>
          <p className="text-body-md text-ink-2 max-w-md mt-4">
            Payment intents, validation outcomes, QIE Pass, budget, and execution records sync from the backend automatically.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 border border-wire rounded-sm overflow-hidden">
          {/* Stats panel */}
          <motion.div
            initial={{ opacity: 0, x: -16 }}
            animate={inView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="bg-surface-1 p-10 lg:border-r border-wire"
          >
            {/* Live indicator */}
            <div className="flex items-center gap-2 mb-10">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-60" />
<span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
              </span>
              <span className="font-mono text-label text-ink-3 uppercase tracking-widest">{statusLabel} - {transportLabel}</span>
            </div>

            <SpendStat label="Active agent" value={activeAgent.id} mono accent />
            <SpendStat label="Daily budget" value={`${fmt(totalBudget)} ${tokenSymbol}`} accent />
            <SpendStat label="Remaining budget" value={`${fmt(remaining)} ${tokenSymbol}`} />
            <SpendStat label="Total spent today" value={`${fmt(totalSpend)} ${tokenSymbol}`} />
            <SpendStat label="Last policy decision" value={decisionLabel} mono={false} />
            <SpendStat label="Latest validation" value={validationLabel} mono={false} />
            <SpendStat label="Latest execution" value={executionLabel} mono={false} />
            <SpendStat label="Last transaction hash" value={<TxHashLink hash={lastTransactionHash} />} />
            <SpendStat label="Payments processed" value={fmt(txCount)} />
            <SpendStat label="Intents received" value={fmt(intentCount)} />
            <SpendStat label="QIE Pass" value={snapshot.qiePass?.status || "unknown"} mono={false} />
            {error && (
              <p className="mt-6 font-mono text-label text-amber-500 uppercase tracking-widest break-words">
                {error}
              </p>
            )}

            <BudgetBar used={totalSpend} total={totalBudget} />
          </motion.div>

          {/* Image block */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={inView ? { opacity: 1 } : {}}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="bg-surface-2 overflow-hidden"
            style={{ minHeight: "420px" }}
          >
            <img
              src="/images/lucid-origin_Macro_close-up_of_a_silicon_wafer_circuit_board_extreme_detail_dark_background_c-0.jpg"
              alt="Budget engine visualization"
              className="w-full h-full object-cover"
              style={{ minHeight: "420px" }}
            />
          </motion.div>
        </div>

        {/* Agent table */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.35 }}
          className="mt-6 border border-wire rounded-sm overflow-hidden"
        >
          <div className="hidden md:grid grid-cols-5 bg-surface-2 border-b border-wire px-6 py-3">
            {["Agent ID", "Latest intent", "Spent", "Budget", "Status"].map((h) => (
              <span key={h} className="stat-label">{h}</span>
            ))}
          </div>
          {agents.map((a) => (
            <div
              key={a.id}
              className="grid grid-cols-2 md:grid-cols-5 gap-y-1 px-6 py-4 border-b border-wire last:border-b-0 hover:bg-surface-2 transition-colors"
            >
              <span className="font-mono text-mono-sm text-ink-0">{a.id}</span>
              <span className="text-body-sm text-ink-2">{a.task}</span>
              <span className="font-mono text-mono-sm text-ink-1">{a.spend.toLocaleString()} {tokenSymbol}</span>
              <span className="font-mono text-mono-sm text-ink-3">{a.budget.toLocaleString()} {tokenSymbol}</span>
              <span>
                <span className={`inline-block font-mono text-label uppercase tracking-wide px-2 py-0.5 rounded-sm ${
                  a.status === "active" || a.status === "running"
                    ? "bg-green-900/30 text-green-400"
                    : "bg-amber-900/20 text-amber-500"
                }`}>
                  {a.status}
                </span>
              </span>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
