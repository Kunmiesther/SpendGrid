import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";

const STATUS_ENDPOINT = "/api/agent/status";

const FALLBACK_STATUS = {
  treasuryHealth: 82,
  runwayDays: 46,
  burnRate: 128.4,
  aiDecision: {
    recommendation: "HOLD",
    riskLevel: "LOW",
    explanation:
      "AI Sentry detected stable runway and sufficient QUSDC coverage. No swap is required before the next payment cycle.",
  },
  swaps: [
    {
      tokenIn: "WQIE",
      tokenOut: "QUSDC",
      txHash: "0x92b7c51aa9db42a1e4f3282b5d2f17394b812f49",
      status: "confirmed",
      timestamp: "2026-06-15T00:04:12.000Z",
    },
  ],
  payments: [
    {
      recipient: "0x19B3...74d1",
      amount: "250.00 QUSDC",
      status: "confirmed",
      timestamp: "2026-06-15T00:06:22.000Z",
    },
    {
      recipient: "0x8C41...b9A2",
      amount: "75.00 QUSDC",
      status: "queued",
      timestamp: "2026-06-15T00:11:45.000Z",
    },
  ],
  history: [
    {
      type: "ai_decision",
      label: "AI decision",
      status: "HOLD",
      timestamp: "2026-06-15T00:02:10.000Z",
      detail: "Treasury health remained above protocol threshold.",
    },
    {
      type: "swap",
      label: "Swap check",
      status: "NO_ACTION",
      timestamp: "2026-06-15T00:03:00.000Z",
      detail: "Liquidity route available, swap skipped by AI Sentry.",
    },
    {
      type: "payment",
      label: "Payment execution",
      status: "CONFIRMED",
      timestamp: "2026-06-15T00:06:22.000Z",
      detail: "SpendController approved payment against active stream.",
    },
  ],
};

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeNumber(value, fallback = 0) {
  const parsed = typeof value === "string"
    ? Number(value.replace(/,/g, "").match(/-?\d+(\.\d+)?/)?.[0])
    : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatNumber(value, options = {}) {
  return normalizeNumber(value).toLocaleString(undefined, {
    maximumFractionDigits: 2,
    ...options,
  });
}

function formatTimestamp(value) {
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

function shortHash(value) {
  if (!value) return "Pending";
  if (value.length <= 18) return value;
  return `${value.slice(0, 10)}...${value.slice(-6)}`;
}

function normalizeStatus(payload) {
  const source = payload && typeof payload === "object" ? payload : FALLBACK_STATUS;
  const fallbackDecision = FALLBACK_STATUS.aiDecision;

  return {
    treasuryHealth: normalizeNumber(source.treasuryHealth, FALLBACK_STATUS.treasuryHealth),
    runwayDays: normalizeNumber(source.runwayDays, FALLBACK_STATUS.runwayDays),
    burnRate: normalizeNumber(source.burnRate, FALLBACK_STATUS.burnRate),
    aiDecision: {
      recommendation: source.aiDecision?.recommendation || fallbackDecision.recommendation,
      riskLevel: source.aiDecision?.riskLevel || fallbackDecision.riskLevel,
      explanation: source.aiDecision?.explanation || fallbackDecision.explanation,
    },
    swaps: normalizeArray(source.swaps),
    payments: normalizeArray(source.payments),
    history: normalizeArray(source.history),
  };
}

function buildTimeline(status) {
  const historyEvents = status.history.map((event, index) => ({
    id: `history-${index}`,
    label: event.label || event.type || "Agent event",
    status: event.status || event.recommendation || "recorded",
    timestamp: event.timestamp,
    detail: event.detail || event.explanation || event.reason || "Cycle event recorded.",
  }));

  const swapEvents = status.swaps.map((swap, index) => ({
    id: `swap-${index}`,
    label: "Liquidity swap",
    status: swap.status || "unknown",
    timestamp: swap.timestamp,
    detail: `${swap.tokenIn || "WQIE"} to ${swap.tokenOut || "QUSDC"} ${swap.txHash ? shortHash(swap.txHash) : "without tx hash"}`,
  }));

  const paymentEvents = status.payments.map((payment, index) => ({
    id: `payment-${index}`,
    label: "Payment execution",
    status: payment.status || "unknown",
    timestamp: payment.timestamp,
    detail: `${payment.amount || "0 QUSDC"} to ${payment.recipient || "recipient unavailable"}`,
  }));

  return [...historyEvents, ...swapEvents, ...paymentEvents]
    .filter((event) => event.timestamp)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

function statusTone(status) {
  const value = String(status || "").toLowerCase();
  if (["confirmed", "success", "hold", "low"].includes(value)) return "text-ink-0 bg-surface-4 border-surface-5";
  if (["queued", "partial", "warning", "medium", "swap_preparation"].includes(value)) {
    return "text-ink-1 bg-surface-3 border-surface-5";
  }
  if (["failed", "critical", "high", "reduce_spend"].includes(value)) return "text-ink-0 bg-surface-2 border-ink-3";
  return "text-ink-2 bg-surface-3 border-surface-5";
}

function Panel({ children, className = "" }) {
  return (
    <motion.section
      whileHover={{ scale: 1.01 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
      className={`card-dark p-5 md:p-6 ${className}`}
    >
      {children}
    </motion.section>
  );
}

function PanelHeader({ label, title, aside }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-5">
      <div>
        <p className="stat-label mb-2">{label}</p>
        <h2 className="text-xl md:text-2xl font-medium text-ink-0">{title}</h2>
      </div>
      {aside}
    </div>
  );
}

function StatusPill({ children, tone }) {
  return (
    <span className={`inline-flex w-fit items-center border rounded-sm px-2.5 py-1 font-mono text-label uppercase ${tone}`}>
      {children}
    </span>
  );
}

function TreasuryOverview({ status }) {
  const health = Math.max(0, Math.min(100, status.treasuryHealth));

  return (
    <Panel>
      <PanelHeader
        label="Treasury overview"
        title="Protocol reserve state"
        aside={<StatusPill tone={statusTone(status.aiDecision.riskLevel)}>{status.aiDecision.riskLevel}</StatusPill>}
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2 bg-surface-1 border border-wire rounded-sm p-4">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="stat-label mb-2">Treasury health</p>
              <p className="font-mono text-4xl md:text-5xl text-ink-0 tabular-nums">{formatNumber(health)}%</p>
            </div>
            <div className="font-mono text-body-sm text-ink-3">0-100</div>
          </div>
          <div className="mt-5 h-2 bg-surface-4 rounded-sm overflow-hidden">
            <div className="h-full bg-ink-1" style={{ width: `${health}%` }} />
          </div>
        </div>
        <div className="bg-surface-1 border border-wire rounded-sm p-4">
          <p className="stat-label mb-2">Runway days</p>
          <p className="font-mono text-2xl text-ink-0 tabular-nums">{formatNumber(status.runwayDays)}</p>
        </div>
        <div className="bg-surface-1 border border-wire rounded-sm p-4">
          <p className="stat-label mb-2">Burn rate</p>
          <p className="font-mono text-2xl text-ink-0 tabular-nums">{formatNumber(status.burnRate)} QUSDC/day</p>
        </div>
      </div>
    </Panel>
  );
}

function AiDecisionPanel({ decision }) {
  return (
    <Panel>
      <PanelHeader
        label="AI Sentry"
        title="Decision output"
        aside={<StatusPill tone={statusTone(decision.recommendation)}>{decision.recommendation}</StatusPill>}
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
        <div className="bg-surface-1 border border-wire rounded-sm p-4">
          <p className="stat-label mb-2">Recommendation</p>
          <p className="font-mono text-body-md text-ink-0 break-words">{decision.recommendation}</p>
        </div>
        <div className="bg-surface-1 border border-wire rounded-sm p-4">
          <p className="stat-label mb-2">Risk level</p>
          <p className="font-mono text-body-md text-ink-0">{decision.riskLevel}</p>
        </div>
      </div>
      <p className="text-body-sm md:text-body-md text-ink-2 leading-relaxed">{decision.explanation}</p>
    </Panel>
  );
}

function ActivityTimeline({ items }) {
  return (
    <Panel>
      <PanelHeader label="Agent loop" title="Activity timeline" />
      <div className="space-y-3">
        {items.length === 0 ? (
          <EmptyState label="No agent events recorded" />
        ) : (
          items.map((item) => (
            <div key={item.id} className="border border-wire bg-surface-1 rounded-sm p-4 hover:bg-surface-2 transition-colors">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-mono text-mono-sm text-ink-0">{item.label}</p>
                  <p className="text-body-sm text-ink-3 mt-1">{formatTimestamp(item.timestamp)}</p>
                </div>
                <StatusPill tone={statusTone(item.status)}>{item.status}</StatusPill>
              </div>
              <p className="mt-3 text-body-sm text-ink-2 break-words">{item.detail}</p>
            </div>
          ))
        )}
      </div>
    </Panel>
  );
}

function SwapFeed({ swaps }) {
  return (
    <Panel>
      <PanelHeader label="Liquidity engine" title="Swap feed" />
      <div className="space-y-3">
        {swaps.length === 0 ? (
          <EmptyState label="No swaps recorded" />
        ) : (
          swaps.map((swap, index) => (
            <div key={`${swap.txHash || "swap"}-${index}`} className="border border-wire bg-surface-1 rounded-sm p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-mono text-mono-sm text-ink-0">
                    {swap.tokenIn || "WQIE"} <span className="text-ink-3">to</span> {swap.tokenOut || "QUSDC"}
                  </p>
                  <p className="font-mono text-mono-sm text-ink-3 mt-1 break-all">{shortHash(swap.txHash)}</p>
                </div>
                <StatusPill tone={statusTone(swap.status)}>{swap.status || "unknown"}</StatusPill>
              </div>
            </div>
          ))
        )}
      </div>
    </Panel>
  );
}

function PaymentFeed({ payments }) {
  return (
    <Panel>
      <PanelHeader label="SpendController" title="Payment feed" />
      <div className="space-y-3">
        {payments.length === 0 ? (
          <EmptyState label="No payments recorded" />
        ) : (
          payments.map((payment, index) => (
            <div key={`${payment.timestamp || "payment"}-${index}`} className="border border-wire bg-surface-1 rounded-sm p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-mono text-mono-sm text-ink-0 break-all">{payment.recipient || "Recipient unavailable"}</p>
                  <p className="text-body-sm text-ink-3 mt-1">{formatTimestamp(payment.timestamp)}</p>
                </div>
                <div className="flex flex-col gap-2 sm:items-end">
                  <p className="font-mono text-mono-sm text-ink-1">{payment.amount || "0 QUSDC"}</p>
                  <StatusPill tone={statusTone(payment.status)}>{payment.status || "unknown"}</StatusPill>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </Panel>
  );
}

function EmptyState({ label }) {
  return (
    <div className="border border-dashed border-surface-5 bg-surface-1 rounded-sm p-4">
      <p className="font-mono text-mono-sm text-ink-3">{label}</p>
    </div>
  );
}

export default function Dashboard() {
  const [status, setStatus] = useState(() => normalizeStatus(FALLBACK_STATUS));
  const [source, setSource] = useState("fallback");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const baseUrl = process.env.REACT_APP_API_URL || "";

    async function loadStatus() {
      try {
        const response = await fetch(`${baseUrl}${STATUS_ENDPOINT}`);
        if (!response.ok) {
          throw new Error(`Status endpoint returned ${response.status}`);
        }
        const payload = await response.json();
        if (!cancelled) {
          setStatus(normalizeStatus(payload));
          setSource("backend");
          setError("");
        }
      } catch (err) {
        if (!cancelled) {
          setStatus(normalizeStatus(FALLBACK_STATUS));
          setSource("fallback");
          setError(err.message);
        }
      }
    }

    loadStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  const timeline = useMemo(() => buildTimeline(status), [status]);

  return (
    <main className="min-h-screen bg-surface-0 text-ink-1 pt-20 pb-12">
      <div className="container-grid">
        <header className="mb-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="tag mb-4">Command center</p>
              <h1 className="text-3xl md:text-5xl font-medium text-ink-0">SpendGrid Dashboard</h1>
              <p className="text-body-md text-ink-2 mt-4 max-w-2xl">
                Treasury intelligence, liquidity actions, and payment execution logs in one operator view.
              </p>
            </div>
            <div className="text-left md:text-right">
              <StatusPill tone={source === "backend" ? statusTone("confirmed") : statusTone("warning")}>
                {source === "backend" ? "Live API" : "Fallback data"}
              </StatusPill>
              {error && <p className="font-mono text-label text-ink-3 mt-3 max-w-xs break-words">{error}</p>}
            </div>
          </div>
        </header>

        <div className="space-y-5">
          <TreasuryOverview status={status} />
          <AiDecisionPanel decision={status.aiDecision} />
          <ActivityTimeline items={timeline} />
          <SwapFeed swaps={status.swaps} />
          <PaymentFeed payments={status.payments} />
        </div>
      </div>
    </main>
  );
}
