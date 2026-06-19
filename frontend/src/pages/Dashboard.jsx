import React from "react";
import { motion } from "framer-motion";
import { useAgentSnapshot } from "../hooks/useAgentSnapshot";

const QIE_TX_EXPLORER_URL = "https://mainnet.qie.digital/tx/";

function Panel({ children, className = "" }) {
  return (
    <motion.section
      whileHover={{ scale: 1.005 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
      className={`card-dark p-5 md:p-6 ${className}`}
    >
      {children}
    </motion.section>
  );
}

function StatusPill({ children, tone = "neutral" }) {
  const tones = {
    ok: "text-green-400 bg-green-900/20 border-green-900/40",
    warn: "text-amber-500 bg-amber-900/20 border-amber-900/40",
    bad: "text-red-400 bg-red-950/20 border-red-900/40",
    neutral: "text-ink-2 bg-surface-3 border-surface-5",
  };
  return (
    <span className={`inline-flex w-fit items-center border rounded-sm px-2.5 py-1 font-mono text-label uppercase ${tones[tone] || tones.neutral}`}>
      {children}
    </span>
  );
}

function shortHash(value) {
  if (!value) return "None";
  if (value.length <= 18) return value;
  return `${value.slice(0, 10)}...${value.slice(-6)}`;
}

function TxHashLink({ hash, className = "" }) {
  if (!hash) return "None";

  return (
    <a
      href={`${QIE_TX_EXPLORER_URL}${hash}`}
      target="_blank"
      rel="noopener noreferrer"
      className={`hover:text-ink-1 transition-colors underline decoration-wire underline-offset-4 ${className}`}
    >
      {shortHash(hash)}
    </a>
  );
}

function formatDate(value) {
  if (!value) return "No timestamp";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Stat({ label, value }) {
  return (
    <div className="bg-surface-1 border border-wire rounded-sm p-4">
      <p className="stat-label mb-2">{label}</p>
      <p className="font-mono text-body-md text-ink-0 break-words">{value}</p>
    </div>
  );
}

function intentTone(status) {
  if (status === "executed" || status === "accepted") return "ok";
  if (status === "failed" || status === "rejected") return "bad";
  if (status === "received") return "warn";
  return "neutral";
}

export default function Dashboard() {
  const { connected, error, snapshot } = useAgentSnapshot(3000);
  const loop = snapshot.runtime?.loop || {};
  const budget = snapshot.budget || {};
  const decision = snapshot.decision || {};
  const transaction = snapshot.transaction || {};
  const pass = snapshot.qiePass || {};
  const intents = snapshot.history?.intents || [];
  const running = loop.inFlight || loop.running;

  return (
    <main className="min-h-screen bg-surface-0 text-ink-1 pt-20 pb-12">
      <div className="container-grid">
        <header className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="tag mb-4">Command center</p>
            <h1 className="text-3xl md:text-5xl font-medium text-ink-0">SpendGrid Dashboard</h1>
            <p className="text-body-md text-ink-2 mt-4 max-w-2xl">
              Live payment intents, validation outcomes, on-chain budget, QIE Pass, and execution state.
            </p>
          </div>
          <div className="flex flex-col gap-2 md:items-end">
            <StatusPill tone={connected ? "ok" : "warn"}>{connected ? "Live stream" : "Polling"}</StatusPill>
            <StatusPill tone={snapshot.runtime?.status === "executing_intent" ? "ok" : "neutral"}>
              {snapshot.runtime?.status === "executing_intent" ? "Executing intent" : snapshot.runtime?.status === "validating_intent" ? "Validating intent" : running ? "Compatibility loop" : "Intent-ready"}
            </StatusPill>
            {(error || snapshot.error) && (
              <p className="font-mono text-label text-amber-500 max-w-sm break-words">{error || snapshot.error}</p>
            )}
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <Panel>
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <p className="stat-label mb-2">Budget</p>
                <h2 className="text-xl md:text-2xl font-medium text-ink-0">Spend limits</h2>
              </div>
              <StatusPill tone={budget.paused ? "bad" : "ok"}>{budget.paused ? "Paused" : "Unpaused"}</StatusPill>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Stat label="Daily limit" value={`${budget.dailyLimit || "0"} QUSDC`} />
              <Stat label="Remaining" value={`${budget.remaining || "0"} QUSDC`} />
              <Stat label="Spent today" value={`${budget.spentToday || "0"} QUSDC`} />
              <Stat label="Safe spend cap" value={`${budget.safeSpendLimit || "0"} QUSDC`} />
              <Stat label="Limiter" value={budget.limitingConstraint || "unknown"} />
              <Stat label="QUSDC balance" value={`${snapshot.balances?.qusdc || "0"} QUSDC`} />
            </div>
          </Panel>

          <Panel>
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <p className="stat-label mb-2">QIE Pass</p>
                <h2 className="text-xl md:text-2xl font-medium text-ink-0">Identity enforcement</h2>
              </div>
              <StatusPill tone={pass.verified ? "ok" : "warn"}>{pass.status || "unknown"}</StatusPill>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Stat label="Agent" value={`AGT-${String(snapshot.agentId || "1").padStart(3, "0")}`} />
              <Stat label="Agent active" value={snapshot.agent?.active ? "Yes" : "No"} />
              <Stat label="Pass bound" value={pass.checks?.passBound ? "Yes" : "No"} />
              <Stat label="Vault whitelisted" value={pass.checks?.vaultWhitelisted ? "Yes" : "No"} />
            </div>
          </Panel>

          <Panel>
            <p className="stat-label mb-2">Last decision</p>
            <h2 className="text-xl md:text-2xl font-medium text-ink-0 mb-5">{decision.action || "No decision"}</h2>
            <p className="text-body-sm text-ink-2 leading-relaxed">
              {decision.reasoning || "No payment intent policy decision has been recorded by the backend runtime yet."}
            </p>
            <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Stat label="Source" value={decision.source || "none"} />
              <Stat label="Timestamp" value={formatDate(decision.timestamp)} />
            </div>
          </Panel>

          <Panel>
            <p className="stat-label mb-2">Last transaction</p>
            <h2 className="text-xl md:text-2xl font-medium text-ink-0 mb-5">
              <TxHashLink hash={transaction.txHash} />
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Stat label="Status" value={transaction.status || "none"} />
              <Stat label="Amount" value={`${transaction.amount || "0"} QUSDC`} />
              <Stat label="Stream" value={transaction.streamId || "none"} />
              <Stat label="Block" value={transaction.blockNumber || "none"} />
            </div>
          </Panel>
        </div>

        <Panel className="mt-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between mb-5">
            <div>
              <p className="stat-label mb-2">Payment intents</p>
              <h2 className="text-xl md:text-2xl font-medium text-ink-0">Received requests</h2>
            </div>
            <div className="grid grid-cols-3 gap-2 text-right">
              <StatusPill tone="neutral">{snapshot.metrics?.intentsReceived || 0} received</StatusPill>
              <StatusPill tone="ok">{snapshot.metrics?.intentsExecuted || 0} executed</StatusPill>
              <StatusPill tone="bad">{snapshot.metrics?.intentsRejected || 0} rejected</StatusPill>
            </div>
          </div>
          <div className="space-y-3">
            {intents.length ? intents.slice(0, 8).map((intent) => (
              <div key={intent.id || intent.intentId || intent.runId} className="border border-wire bg-surface-1 rounded-sm p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-mono text-mono-sm text-ink-0">{shortHash(intent.intentId || intent.id)}</p>
                    <p className="text-body-sm text-ink-3 mt-1">{formatDate(intent.timestamp)}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <StatusPill tone={intentTone(intent.validation?.status)}>{intent.validation?.status || "unknown"}</StatusPill>
                    <StatusPill tone={intentTone(intent.status)}>{intent.status || "unknown"}</StatusPill>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Stat label="Recipient" value={shortHash(intent.recipient)} />
                  <Stat label="Amount" value={`${intent.amount || "0"} QUSDC`} />
                  <Stat label="Tx" value={<TxHashLink hash={intent.txHash} />} />
                </div>
                {(intent.validation?.reason || intent.execution?.reason || intent.decision?.reasoning) && (
                  <p className="mt-3 text-body-sm text-ink-2 break-words">
                    {intent.validation?.reason || intent.execution?.reason || intent.decision?.reasoning}
                  </p>
                )}
              </div>
            )) : (
              <div className="border border-dashed border-surface-5 bg-surface-1 rounded-sm p-4">
                <p className="font-mono text-mono-sm text-ink-3">No payment intents received</p>
              </div>
            )}
          </div>
        </Panel>

        <Panel className="mt-5">
          <p className="stat-label mb-2">Runtime timeline</p>
          <h2 className="text-xl md:text-2xl font-medium text-ink-0 mb-5">Recent events</h2>
          <div className="space-y-3">
            {snapshot.history?.timeline?.length ? snapshot.history.timeline.slice(0, 12).map((event) => (
              <div key={event.id} className="border border-wire bg-surface-1 rounded-sm p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-mono text-mono-sm text-ink-0">{event.label}</p>
                    <p className="text-body-sm text-ink-3 mt-1">{formatDate(event.timestamp)}</p>
                  </div>
                  <StatusPill>{event.status}</StatusPill>
                </div>
                <p className="mt-3 text-body-sm text-ink-2 break-words">{event.detail}</p>
              </div>
            )) : (
              <div className="border border-dashed border-surface-5 bg-surface-1 rounded-sm p-4">
                <p className="font-mono text-mono-sm text-ink-3">No runtime events recorded</p>
              </div>
            )}
          </div>
        </Panel>
      </div>
    </main>
  );
}
