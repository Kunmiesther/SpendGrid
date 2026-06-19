import React, { useState } from "react";
import { motion } from "framer-motion";
import { useInView } from "../hooks/useInView";
import { useAgentRuntime } from "../hooks/useAgentRuntime";
import { useQiedexSwap } from "../hooks/useQiedexSwap";
import { useWallet } from "../hooks/useWallet";
import { formatTokenAmount } from "../lib/qiedex";

const QIE_TX_EXPLORER_URL = "https://mainnet.qie.digital/tx/";

function statusTone(kind) {
  if (kind === "ok") return "text-green-400 bg-green-900/20 border-green-900/40";
  if (kind === "warn") return "text-amber-500 bg-amber-900/20 border-amber-900/40";
  if (kind === "bad") return "text-red-400 bg-red-950/20 border-red-900/40";
  return "text-ink-2 bg-surface-3 border-surface-5";
}

function StatusPill({ children, tone = "neutral" }) {
  return (
    <span className={`inline-flex w-fit items-center border rounded-sm px-2.5 py-1 font-mono text-label uppercase ${statusTone(tone)}`}>
      {children}
    </span>
  );
}

function shortHash(value) {
  if (!value) return "";
  return `${value.slice(0, 10)}...${value.slice(-6)}`;
}

function TxLink({ hash }) {
  if (!hash) return null;
  return (
    <a
      href={`${QIE_TX_EXPLORER_URL}${hash}`}
      target="_blank"
      rel="noopener noreferrer"
      className="font-mono text-label uppercase tracking-widest text-ink-2 underline decoration-wire underline-offset-4 hover:text-ink-0 transition-colors"
    >
      {shortHash(hash)}
    </a>
  );
}

function QuoteStat({ label, value }) {
  return (
    <div className="border border-wire bg-surface-1 rounded-sm p-3">
      <p className="stat-label mb-2">{label}</p>
      <p className="font-mono text-body-sm text-ink-0 break-words">{value}</p>
    </div>
  );
}

function formatBps(value) {
  if (value === null || value === undefined) return "n/a";
  return `${(Number(value) / 100).toFixed(2)}%`;
}

function Toggle({ enabled }) {
  return (
    <button
      role="switch"
      aria-checked={enabled}
      disabled
      className={`relative w-9 h-5 rounded-sm transition-colors duration-200 focus:outline-none flex-shrink-0 ${
        enabled ? "bg-ink-1" : "bg-surface-5"
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-sm bg-ink-0 transition-transform duration-200 ${
          enabled ? "translate-x-4" : "translate-x-0"
        }`}
      />
    </button>
  );
}

export default function BudgetControl() {
  const [ref, inView] = useInView(0.1);
  const wallet = useWallet();
  const { deployment, loopStatus, paymentIntent, running, snapshot, submitIntent, stopAgent } = useAgentRuntime();
  const swap = useQiedexSwap({
    wallet,
    deployment,
    requiredAmountWei: paymentIntent.amountWei
  });
  const [intentNotice, setIntentNotice] = useState(null);
  const agentRunning = Boolean(loopStatus?.running);
  const statusLabel = snapshot.runtime?.status === "executing_intent"
    ? "Executing intent"
    : snapshot.runtime?.status === "validating_intent"
      ? "Validating intent"
      : agentRunning
        ? "Compatibility loop"
        : "Intent-ready";
  const budget = snapshot.budget || {};
  const agentLabel = `AGT-${String(snapshot.agentId || "1").padStart(3, "0")}`;
  const services = [
    { id: "vault", label: "StreamVault payments", enabled: Boolean(budget.vaultWhitelisted) },
    { id: "qie-pass", label: "QIE Pass verified", enabled: Boolean(snapshot.qiePass?.verified) },
    { id: "budget", label: "Daily budget available", enabled: Number(budget.remaining || 0) > 0 },
  ];
  const walletReady = wallet.connected && wallet.isQieMainnet;
  const intentReady = walletReady && swap.hasRequiredQusdc;
  const selectedBalance = swap.balances[swap.selectedToken?.id]?.formatted || "0";
  const qusdcBalance = swap.balances.QUSDC?.formatted || "0";
  const submitLabel = running
    ? "Working..."
    : !wallet.connected
      ? "Connect wallet first"
      : !wallet.isQieMainnet
        ? "Switch to QIE Mainnet"
        : swap.loadingBalances
          ? "Checking balance..."
          : intentReady
            ? "Submit Payment Intent"
            : "Insufficient QUSDC";

  const handleSubmitIntent = async () => {
    if (!intentReady || running) return;
    setIntentNotice(null);
    try {
      const result = await submitIntent();
      await swap.refreshBalances();
      setIntentNotice({
        tone: result?.ok ? "ok" : "bad",
        text: result?.ok ? "Payment intent executed successfully." : result?.error || "Payment intent was rejected."
      });
    } catch (error) {
      setIntentNotice({
        tone: "bad",
        text: error.message || "Payment intent failed."
      });
    }
  };

  const handleConnect = async (walletId) => {
    setIntentNotice(null);
    await wallet.connect(walletId).catch(() => {});
  };

  return (
    <section className="bg-surface-0 border-t border-wire py-section">
      <div className="container-grid">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          ref={ref}
          className="mb-16"
        >
          <p className="tag mb-6">Budget control</p>
          <h2 className="text-display-md font-sans font-medium text-ink-0 max-w-xl text-balance">
            Spending policy enforced at the protocol level.
          </h2>
          <p className="text-body-md text-ink-2 max-w-md mt-4">
            Limits shown here are read from SpendController state and applied when payment intents are validated.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-8">
          {/* Main control panel */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="card-dark overflow-hidden"
          >
            {/* Panel header */}
            <div className="flex items-center justify-between px-8 py-5 border-b border-wire">
              <div className="flex items-center gap-3">
                <span
                  className={`w-2 h-2 rounded-sm ${agentRunning ? "bg-green-500" : "bg-amber-500"}`}
                />
                <span className="font-mono text-label uppercase tracking-widest text-ink-2">
                  Agent {agentLabel} - {statusLabel}
                </span>
              </div>
              <button
                onClick={intentReady ? handleSubmitIntent : () => {}}
                disabled={!intentReady || running}
                className="btn-secondary text-xs px-4 py-2"
              >
                {submitLabel}
              </button>
            </div>

            {/* Limits */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-wire">
              <div className="bg-surface-2 px-8 py-7">
                <label className="stat-label block mb-3">Daily limit (QUSDC)</label>
                <input
                  readOnly
                  value={budget.dailyLimit || "0"}
                  className="w-full bg-surface-3 border border-wire text-ink-0 font-mono text-body-md px-4 py-2 rounded-sm focus:outline-none focus:border-ink-3 transition-colors"
                />
              </div>
              <div className="bg-surface-2 px-8 py-7">
                <label className="stat-label block mb-3">Safe spend cap (QUSDC)</label>
                <input
                  readOnly
                  value={budget.safeSpendLimit || "0"}
                  className="w-full bg-surface-3 border border-wire text-ink-0 font-mono text-body-md px-4 py-2 rounded-sm focus:outline-none focus:border-ink-3 transition-colors"
                />
              </div>
            </div>

            {/* Wallet balance + swap flow */}
            <div className="px-8 py-6 border-t border-wire">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between mb-5">
                <div>
                  <p className="stat-label mb-2">Wallet funding</p>
                  <h3 className="text-xl md:text-2xl font-medium text-ink-0">QUSDC readiness</h3>
                </div>
                <div className="flex flex-wrap gap-2">
                  <StatusPill tone={wallet.connected ? "ok" : "warn"}>
                    {wallet.connected ? wallet.shortAddress : "Wallet offline"}
                  </StatusPill>
                  {wallet.connected && (
                    <StatusPill tone={wallet.isQieMainnet ? "ok" : "bad"}>
                      {wallet.isQieMainnet ? "QIE Mainnet" : "Wrong network"}
                    </StatusPill>
                  )}
                  {walletReady && (
                    <StatusPill tone={swap.hasRequiredQusdc ? "ok" : "warn"}>
                      {swap.hasRequiredQusdc ? "QUSDC ready" : "Insufficient QUSDC"}
                    </StatusPill>
                  )}
                </div>
              </div>

              {!wallet.connected && (
                <div className="border border-wire bg-surface-1 rounded-sm p-4">
                  <p className="text-body-sm text-ink-2 mb-4">
                    Connect a wallet to check QUSDC balance and continue the payment intent flow.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {wallet.providers.map((provider) => (
                      <button
                        key={provider.id}
                        onClick={() => handleConnect(provider.id)}
                        disabled={wallet.loading}
                        className="btn-secondary justify-center"
                      >
                        {wallet.loading ? "Connecting..." : provider.label}
                      </button>
                    ))}
                  </div>
                  {wallet.error && (
                    <p className="mt-3 text-body-sm text-red-400 break-words">{wallet.error}</p>
                  )}
                </div>
              )}

              {wallet.connected && !wallet.isQieMainnet && (
                <div className="border border-amber-900/40 bg-amber-950/10 rounded-sm p-4">
                  <p className="text-body-sm text-amber-500 mb-4">
                    Switch your wallet to QIE Mainnet before checking balances or using QIEDex.
                  </p>
                  <button
                    onClick={() => wallet.switchNetwork().catch(() => {})}
                    disabled={wallet.loading}
                    className="btn-secondary"
                  >
                    {wallet.loading ? "Switching..." : "Switch Network"}
                  </button>
                </div>
              )}

              {walletReady && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
                  <QuoteStat label="Payment amount" value={`${paymentIntent.amount} QUSDC`} />
                  <QuoteStat label="Wallet QUSDC" value={`${qusdcBalance} QUSDC`} />
                  <QuoteStat label="QIEDex router" value={shortHash(swap.qiedexRouter)} />
                </div>
              )}

              {walletReady && swap.hasRequiredQusdc && (
                <div className="border border-green-900/40 bg-green-950/10 rounded-sm p-4">
                  <p className="text-body-sm text-green-400">
                    QUSDC balance is sufficient. You can submit the payment intent without swapping.
                  </p>
                </div>
              )}

              {walletReady && !swap.hasRequiredQusdc && (
                <div className="border border-wire bg-surface-1 rounded-sm overflow-hidden">
                  <div className="px-5 py-4 border-b border-wire">
                    <p className="font-mono text-label text-amber-500 uppercase tracking-widest mb-2">
                      Insufficient QUSDC
                    </p>
                    <h4 className="text-xl font-medium text-ink-0">Swap using QIEDex</h4>
                  </div>

                  <div className="p-5 space-y-5">
                    <div>
                      <label className="stat-label block mb-3">Select token</label>
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                        {swap.tokens.map((token) => (
                          <button
                            key={token.id}
                            type="button"
                            onClick={() => swap.setSelectedTokenId(token.id)}
                            className={`border rounded-sm px-3 py-2 font-mono text-label uppercase transition-colors ${
                              swap.selectedTokenId === token.id
                                ? "border-ink-1 text-ink-0 bg-surface-3"
                                : "border-wire text-ink-2 bg-surface-2 hover:text-ink-0"
                            }`}
                          >
                            {token.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-[1fr_170px] gap-3">
                      <div>
                        <label className="stat-label block mb-3">Amount in</label>
                        <input
                          value={swap.inputAmount}
                          onChange={(event) => swap.setInputAmount(event.target.value)}
                          placeholder="0.00"
                          inputMode="decimal"
                          className="w-full bg-surface-3 border border-wire text-ink-0 font-mono text-body-md px-4 py-3 rounded-sm focus:outline-none focus:border-ink-3 transition-colors"
                        />
                        <p className="mt-2 font-mono text-label uppercase tracking-widest text-ink-3">
                          Balance: {selectedBalance} {swap.selectedToken?.symbol}
                        </p>
                      </div>
                      <div>
                        <label className="stat-label block mb-3">Slippage</label>
                        <div className="grid grid-cols-3 gap-2">
                          {[50, 100, 200].map((bps) => (
                            <button
                              key={bps}
                              type="button"
                              onClick={() => swap.setSlippageBps(bps)}
                              className={`border rounded-sm px-2 py-3 font-mono text-label uppercase transition-colors ${
                                Number(swap.slippageBps) === bps
                                  ? "border-ink-1 text-ink-0 bg-surface-3"
                                  : "border-wire text-ink-2 bg-surface-2 hover:text-ink-0"
                              }`}
                            >
                              {(bps / 100).toFixed(bps === 100 ? 0 : 1)}%
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                      <QuoteStat
                        label="Estimated output"
                        value={swap.quote ? `${formatTokenAmount(swap.quote.amountOut, 6)} QUSDC` : swap.quoting ? "Fetching..." : "No quote"}
                      />
                      <QuoteStat
                        label="Price impact"
                        value={swap.quote ? formatBps(swap.quote.priceImpactBps) : "n/a"}
                      />
                      <QuoteStat
                        label="Slippage"
                        value={formatBps(swap.slippageBps)}
                      />
                      <QuoteStat
                        label="Minimum received"
                        value={swap.quote ? `${formatTokenAmount(swap.quote.minReceived, 6)} QUSDC` : "n/a"}
                      />
                    </div>

                    {(swap.error || swap.success) && (
                      <div className={`border rounded-sm p-4 ${
                        swap.success ? "border-green-900/40 bg-green-950/10" : "border-red-900/40 bg-red-950/10"
                      }`}>
                        <p className={`text-body-sm ${swap.success ? "text-green-400" : "text-red-400"} break-words`}>
                          {swap.success?.message || swap.error}
                        </p>
                        {swap.success?.swap && (
                          <div className="mt-3 flex flex-wrap gap-3">
                            {swap.success.wrap && <TxLink hash={swap.success.wrap} />}
                            {swap.success.approval && <TxLink hash={swap.success.approval} />}
                            <TxLink hash={swap.success.swap} />
                          </div>
                        )}
                      </div>
                    )}

                    <button
                      onClick={() => swap.swap().catch(() => {})}
                      disabled={!swap.quote || swap.quoting || swap.swapping || !swap.inputAmount}
                      className="btn-primary w-full justify-center disabled:opacity-50 disabled:hover:scale-100 disabled:cursor-not-allowed"
                    >
                      {swap.swapping ? "Swapping..." : swap.quoting ? "Loading quote..." : "Swap"}
                    </button>
                  </div>
                </div>
              )}

              {intentNotice && (
                <div className={`mt-4 border rounded-sm p-4 ${intentNotice.tone === "ok" ? "border-green-900/40 bg-green-950/10" : "border-red-900/40 bg-red-950/10"}`}>
                  <p className={`text-body-sm ${intentNotice.tone === "ok" ? "text-green-400" : "text-red-400"}`}>
                    {intentNotice.text}
                  </p>
                </div>
              )}
            </div>

            {/* Policy row */}
            <div className="px-8 py-6 border-t border-wire">
              <p className="stat-label mb-4">Spending policy</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  `Remaining: ${budget.remaining || "0"} QUSDC`,
                  `Spent today: ${budget.spentToday || "0"} QUSDC`,
                  `Limiter: ${budget.limitingConstraint || "unknown"}`,
                  budget.paused ? "Agent is paused" : "Agent is unpaused",
                ].map((rule) => (
                  <div key={rule} className="flex items-start gap-3">
                    <svg width="14" height="14" viewBox="0 0 14 14" className="text-ink-2 mt-0.5 flex-shrink-0" fill="none">
                      <rect width="14" height="14" rx="1" fill="currentColor" fillOpacity={0.08} />
                      <path d="M3.5 7L6 9.5L10.5 5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span className="text-body-sm text-ink-2">{rule}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Apply */}
            <div className="px-8 py-5 border-t border-wire flex gap-3">
              <button
                className="btn-primary disabled:opacity-50 disabled:hover:scale-100 disabled:cursor-not-allowed"
                onClick={handleSubmitIntent}
                disabled={!intentReady || running}
              >
                {submitLabel}
              </button>
              <button className="btn-secondary" onClick={() => stopAgent().catch(() => {})} disabled={running || !agentRunning}>
                Stop Compatibility Loop
              </button>
            </div>
          </motion.div>

          {/* Right column */}
          <div className="flex flex-col gap-6">
            {/* Service whitelist */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.55, delay: 0.15 }}
              className="card-dark overflow-hidden"
            >
              <div className="px-6 py-4 border-b border-wire">
                <p className="stat-label">Allowed services</p>
              </div>
              <div className="divide-y divide-wire">
                {services.map((s) => (
                  <div key={s.id} className="flex items-center justify-between px-6 py-4">
                    <span className="text-body-sm text-ink-1">{s.label}</span>
                    <Toggle enabled={s.enabled} />
                  </div>
                ))}
              </div>
            </motion.div>

            {/* Runtime stop */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.55, delay: 0.22 }}
              className="card-dark border-red-900/40 overflow-hidden"
            >
              <div className="px-6 py-5 border-b border-red-900/40">
                <p className="font-mono text-label text-red-400 uppercase tracking-widest mb-1">Runtime stop</p>
                <p className="text-body-sm text-ink-3">
                  Stops the legacy queued-task loop. Normal SpendGrid execution waits for explicit payment intents.
                </p>
              </div>
              <div className="px-6 py-5">
                <button
                  onClick={() => stopAgent().catch(() => {})}
                  disabled={running || !agentRunning}
                  className="w-full border border-red-800/50 bg-red-950/20 text-red-400 font-medium text-body-sm px-5 py-3 rounded-sm transition-transform duration-150 hover:scale-95 hover:bg-red-950/30"
                >
                  Stop compatibility loop
                </button>
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
}
