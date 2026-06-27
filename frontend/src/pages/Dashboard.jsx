import React, { useMemo, useState } from "react";
import { ethers } from "ethers";
import { motion } from "framer-motion";
import { api } from "../lib/api";
import { getQieTxExplorerUrl } from "../lib/explorer";
import { loadIntentPolicy } from "../lib/intentWorkspace";
import { useAgentSnapshot } from "../hooks/useAgentSnapshot";

function Panel({ children, className = "" }) {
  return (
    <motion.section
      whileHover={{ scale: 1.005 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
      className={`card-dark p-5 md:p-6 min-w-0 ${className}`}
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

function TxHashLink({ hash, network, className = "" }) {
  if (!hash) return "None";

  return (
    <a
      href={getQieTxExplorerUrl(network, hash)}
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
  if (status === "pending_approval" || status === "received") return "warn";
  return "neutral";
}

function toBigIntSafe(value) {
  try {
    return BigInt(value || 0);
  } catch (_error) {
    return 0n;
  }
}

function formatUnitsSafe(value, decimals = 6) {
  try {
    return ethers.formatUnits(toBigIntSafe(value), decimals);
  } catch (_error) {
    return "0";
  }
}

function buildSpendingInsights(intents, decimals = 6) {
  const history = Array.isArray(intents) ? intents : [];
  const successful = history.filter((intent) => intent.status === "executed");
  const failed = history.filter((intent) => ["failed", "rejected"].includes(intent.status));
  const successfulAmounts = successful.map((intent) => toBigIntSafe(intent.amountWei));
  const totalSpentWei = successfulAmounts.reduce((sum, amount) => sum + amount, 0n);
  const largestPaymentWei = successfulAmounts.reduce((largest, amount) => (amount > largest ? amount : largest), 0n);
  const averagePaymentWei = successful.length > 0 ? totalSpentWei / BigInt(successful.length) : 0n;

  return {
    totalPayments: history.length,
    totalQusdcSpent: formatUnitsSafe(totalSpentWei, decimals),
    largestPayment: formatUnitsSafe(largestPaymentWei, decimals),
    averagePayment: formatUnitsSafe(averagePaymentWei, decimals),
    successfulPayments: successful.length,
    failedPayments: failed.length
  };
}

export default function Dashboard() {
  const { connected, error, refresh, snapshot } = useAgentSnapshot(3000);
  const [actionBusyId, setActionBusyId] = useState(null);
  const loop = snapshot.runtime?.loop || {};
  const budget = snapshot.budget || {};
  const decision = snapshot.decision || {};
  const transaction = snapshot.transaction || {};
  const pass = snapshot.qiePass || {};
  const intents = snapshot.history?.intents || [];
  const pendingApprovals = snapshot.pendingApprovals || [];
  const analytics = snapshot.analytics || {};
  const tokenDecimals = snapshot.balances?.tokenDecimals || 6;
  const network = snapshot.network || {};
  const spendingInsights = useMemo(() => buildSpendingInsights(intents, tokenDecimals), [intents, tokenDecimals]);
  const settings = snapshot.settings || {};
  const localPolicy = loadIntentPolicy();
  const currentPolicy = {
    ...settings,
    ...localPolicy
  };
  const running = loop.inFlight || loop.running;

  const handlePendingApproval = async (intentId, action) => {
    if (!intentId) return;
    setActionBusyId(intentId);
    try {
      if (action === "approve") {
        await api.approvePaymentIntent(intentId, { reason: "Approved from dashboard" });
      } else {
        await api.rejectPaymentIntent(intentId, { reason: "Rejected from dashboard" });
      }
      await refresh();
    } catch (_error) {
      // Keep the dashboard responsive; snapshot refresh will surface the latest state.
    } finally {
      setActionBusyId(null);
    }
  };

  const formatSuccessRate = (value) => {
    if (value === null || value === undefined || value === "") return "Unavailable";
    if (typeof value === "number") return `${value.toFixed(2)}%`;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? `${parsed.toFixed(2)}%` : String(value);
  };

  return (
    <main className="min-h-screen bg-surface-0 text-ink-1 pt-20 pb-12 overflow-x-hidden">
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
              <TxHashLink hash={transaction.txHash} network={network} />
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
              <p className="stat-label mb-2">Analytics</p>
              <h2 className="text-xl md:text-2xl font-medium text-ink-0">Live spending metrics</h2>
            </div>
            <StatusPill tone={currentPolicy.manualApprovalEnabled ? "warn" : "ok"}>
              {currentPolicy.manualApprovalEnabled ? "Manual approval enabled" : "Auto approval"}
            </StatusPill>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Stat label="Total Payments" value={analytics.totalPayments ?? 0} />
            <Stat label="Total QUSDC Spent" value={`${analytics.totalQusdcSpent || "0"} QUSDC`} />
            <Stat label="Payments Today" value={analytics.paymentsToday ?? 0} />
            <Stat label="Success Rate" value={formatSuccessRate(analytics.successRate)} />
            <Stat label="Failed Validations" value={analytics.failedValidations ?? 0} />
            <Stat label="Average Payment Size" value={`${analytics.averagePaymentSize || "0"} QUSDC`} />
            <Stat label="Daily Budget Remaining" value={`${analytics.currentDailyBudgetRemaining || budget.remaining || "0"} QUSDC`} />
            <Stat label="Pending Approvals" value={pendingApprovals.length} />
          </div>
        </Panel>

        <Panel className="mt-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between mb-5">
            <div>
              <p className="stat-label mb-2">Spending insights</p>
              <h2 className="text-xl md:text-2xl font-medium text-ink-0">Derived from payment history</h2>
            </div>
            <StatusPill tone={spendingInsights.successfulPayments > 0 ? "ok" : "neutral"}>
              {spendingInsights.successfulPayments > 0 ? "History available" : "No successful payments yet"}
            </StatusPill>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Stat label="Total payments" value={spendingInsights.totalPayments} />
            <Stat label="Total QUSDC spent" value={`${spendingInsights.totalQusdcSpent} QUSDC`} />
            <Stat label="Largest payment" value={`${spendingInsights.largestPayment} QUSDC`} />
            <Stat label="Average payment" value={`${spendingInsights.averagePayment} QUSDC`} />
            <Stat label="Successful payments" value={spendingInsights.successfulPayments} />
            <Stat label="Failed payments" value={spendingInsights.failedPayments} />
          </div>
        </Panel>

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
                  <Stat label="Tx" value={<TxHashLink hash={intent.txHash} network={network} />} />
                </div>
                {intent.approval?.status === "pending" && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      className="btn-secondary text-xs px-4 py-2"
                      onClick={() => handlePendingApproval(intent.intentId || intent.id, "approve")}
                      disabled={actionBusyId === (intent.intentId || intent.id)}
                    >
                      {actionBusyId === (intent.intentId || intent.id) ? "Working..." : "Approve"}
                    </button>
                    <button
                      className="btn-secondary text-xs px-4 py-2"
                      onClick={() => handlePendingApproval(intent.intentId || intent.id, "reject")}
                      disabled={actionBusyId === (intent.intentId || intent.id)}
                    >
                      Reject
                    </button>
                  </div>
                )}
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

        {pendingApprovals.length > 0 && (
          <Panel className="mt-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between mb-5">
              <div>
                <p className="stat-label mb-2">Approval queue</p>
                <h2 className="text-xl md:text-2xl font-medium text-ink-0">Pending human review</h2>
              </div>
              <StatusPill tone="warn">{pendingApprovals.length} pending</StatusPill>
            </div>
            <div className="space-y-3">
              {pendingApprovals.map((intent) => (
                <div key={intent.intentId || intent.id} className="border border-wire bg-surface-1 rounded-sm p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-mono text-mono-sm text-ink-0">{shortHash(intent.intentId || intent.id)}</p>
                      <p className="text-body-sm text-ink-3 mt-1">{formatDate(intent.approval?.requestedAt || intent.timestamp)}</p>
                    </div>
                    <StatusPill tone="warn">Pending approval</StatusPill>
                  </div>
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <Stat label="Recipient" value={shortHash(intent.recipient)} />
                    <Stat label="Amount" value={`${intent.amount || "0"} QUSDC`} />
                    <Stat label="Risk" value={intent.validation?.approvalRequired ? "Manual review" : "Queued"} />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      className="btn-primary text-xs px-4 py-2"
                      onClick={() => handlePendingApproval(intent.intentId || intent.id, "approve")}
                      disabled={actionBusyId === (intent.intentId || intent.id)}
                    >
                      Approve
                    </button>
                    <button
                      className="btn-secondary text-xs px-4 py-2"
                      onClick={() => handlePendingApproval(intent.intentId || intent.id, "reject")}
                      disabled={actionBusyId === (intent.intentId || intent.id)}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        )}

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
                  <div className="flex flex-wrap gap-2">
                    <StatusPill>{event.status}</StatusPill>
                    {event.type === "intent_stage" && <StatusPill tone="neutral">{event.label}</StatusPill>}
                  </div>
                  </div>
                  <p className="mt-3 text-body-sm text-ink-2 break-words">{event.detail}</p>
                  {event.txHash && (
                    <div className="mt-3">
                      <p className="stat-label mb-2">Tx</p>
                      <TxHashLink hash={event.txHash} network={network} />
                    </div>
                  )}
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
