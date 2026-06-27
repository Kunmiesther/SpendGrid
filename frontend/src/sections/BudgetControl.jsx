import React, { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { motion } from "framer-motion";
import { api } from "../lib/api";
import { useInView } from "../hooks/useInView";
import { useAgentRuntime } from "../hooks/useAgentRuntime";
import { useQiedexSwap } from "../hooks/useQiedexSwap";
import { useWallet } from "../hooks/useWallet";
import { formatTokenAmount } from "../lib/qiedex";
import { getQieTxExplorerUrl } from "../lib/explorer";
import {
  formatWhitelistInput,
  loadIntentPolicy,
  loadIntentTemplates,
  normalizeWhitelistInput,
  saveIntentPolicy,
  saveIntentTemplates
} from "../lib/intentWorkspace";

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

function TxLink({ hash, network }) {
  if (!hash) return null;
  return (
    <a
      href={getQieTxExplorerUrl(network, hash)}
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

function fieldTone(value) {
  return value ? "text-ink-0" : "text-ink-3";
}

function formatPreviewValue(value, fallback = "Unavailable") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

function buildPolicyPayload(policyDraft) {
  const toWei = (value) => {
    if (value === undefined || value === null || String(value).trim() === "") return null;
    try {
      return ethers.parseUnits(String(value).trim(), 6).toString();
    } catch (_error) {
      return String(value).trim();
    }
  };

  return {
    manualApprovalEnabled: Boolean(policyDraft.manualApprovalEnabled),
    manualApprovalThresholdWei: toWei(policyDraft.manualApprovalThresholdWei),
    maxPaymentAmountWei: toWei(policyDraft.maxPaymentAmountWei),
    maxPaymentsPerDay: policyDraft.maxPaymentsPerDay || null,
    whitelistRecipients: normalizeWhitelistInput(policyDraft.whitelistRecipients)
  };
}

function formatQusdcInput(value) {
  if (value === undefined || value === null || value === "") return "";
  try {
    return ethers.formatUnits(String(value).trim(), 6);
  } catch (_error) {
    return String(value);
  }
}

function buildIntentOverrides(draft) {
  return {
    recipient: draft.recipient,
    amount: draft.amount,
    metadata: {
      task: draft.description || draft.category || "Payment intent",
      source: "dashboard",
      category: draft.category || null,
      description: draft.description || null,
      templateId: draft.templateId || null
    },
    policy: buildPolicyPayload(draft)
  };
}

export default function BudgetControl() {
  const [ref, inView] = useInView(0.1);
  const wallet = useWallet();
  const { deployment, loopStatus, paymentIntent, previewIntent, refresh, running, snapshot, submitIntent, stopAgent } = useAgentRuntime();
  const swap = useQiedexSwap({
    wallet,
    deployment,
    requiredAmountWei: paymentIntent.amountWei
  });
  const [intentNotice, setIntentNotice] = useState(null);
  const [templates, setTemplates] = useState(() => loadIntentTemplates());
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [draft, setDraft] = useState(() => {
    const storedPolicy = loadIntentPolicy();
    return {
      recipient: "",
      amount: paymentIntent.amount,
      category: "",
      description: "",
      templateId: "",
      manualApprovalEnabled: Boolean(storedPolicy.manualApprovalEnabled),
      manualApprovalThresholdWei: formatQusdcInput(storedPolicy.manualApprovalThresholdWei),
      maxPaymentAmountWei: formatQusdcInput(storedPolicy.maxPaymentAmountWei),
      maxPaymentsPerDay: storedPolicy.maxPaymentsPerDay || "",
      whitelistRecipients: formatWhitelistInput(storedPolicy.whitelistRecipients)
    };
  });
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [pauseBusy, setPauseBusy] = useState(false);
  const agentRunning = Boolean(loopStatus?.running);
  const statusLabel = snapshot.runtime?.status === "executing_intent"
    ? "Executing intent"
    : snapshot.runtime?.status === "validating_intent"
      ? "Validating intent"
      : agentRunning
        ? "Compatibility loop"
        : "Intent-ready";
  const budget = snapshot.budget || {};
  const network = snapshot.network || {};
  const agentLabel = `AGT-${String(snapshot.agentId || "1").padStart(3, "0")}`;
  const services = [
    { id: "vault", label: "StreamVault payments", enabled: Boolean(budget.vaultWhitelisted) },
    { id: "qie-pass", label: "QIE Pass verified", enabled: Boolean(snapshot.qiePass?.verified) },
    { id: "budget", label: "Daily budget available", enabled: Number(budget.remaining || 0) > 0 },
  ];
  const walletReady = wallet.connected && wallet.isQieMainnet;
  const intentReady = walletReady && swap.hasRequiredQusdc && Boolean(draft.recipient) && Boolean(draft.amount);
  const swapBusy = swap.loadingBalances || swap.quoting || swap.swapping;
  const selectedBalance = swap.balances[swap.selectedToken?.id]?.formatted || "0";
  const qusdcBalance = swap.balances.QUSDC?.formatted || "0";
  const policyPayload = useMemo(() => buildPolicyPayload(draft), [draft]);
  const intentOverrides = useMemo(() => buildIntentOverrides(draft), [draft]);
  const previewStageLabel = useMemo(() => {
    if (previewLoading) return "Loading preview...";
    if (!preview) return "Preview unavailable";
    return preview.executionReadiness || preview.policyStatus || "Preview ready";
  }, [preview, previewLoading]);
  const submitLabel = running
    ? "Working..."
    : swap.swapping
      ? "QIEDex swap in progress..."
      : swap.loadingBalances
        ? "Refreshing balances..."
        : !wallet.connected
          ? "Connect wallet first"
          : !wallet.isQieMainnet
            ? "Switch to QIE Mainnet"
            : intentReady
              ? "Submit Payment Intent"
              : !draft.recipient || !draft.amount
                ? "Enter recipient and amount"
                : "Insufficient QUSDC";

  useEffect(() => {
    saveIntentPolicy(policyPayload);
  }, [policyPayload]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!walletReady || !draft.recipient || !draft.amount) {
        setPreview(null);
        setPreviewError(null);
        setPreviewLoading(false);
        return;
      }

      setPreviewLoading(true);
      setPreviewError(null);
      (async () => {
        try {
          const response = await previewIntent(intentOverrides);
          setPreview(response);
        } catch (error) {
          setPreview(null);
          setPreviewError(error.message || "Preview unavailable");
        } finally {
          setPreviewLoading(false);
        }
      })();
    }, 450);

    return () => window.clearTimeout(timer);
  }, [draft.amount, draft.category, draft.description, draft.recipient, intentOverrides, previewIntent, walletReady]);

  useEffect(() => {
    saveIntentTemplates(templates);
  }, [templates]);

  useEffect(() => {
    if (!selectedTemplateId) {
      setDraft((current) => ({
        ...current,
        templateId: ""
      }));
      return;
    }
    const template = templates.find((item) => item.id === selectedTemplateId);
    if (!template) return;
    setDraft((current) => ({
      ...current,
      recipient: template.recipient || current.recipient,
      amount: template.amount || current.amount,
      category: template.category || current.category,
      description: template.description || current.description,
      templateId: template.id
    }));
  }, [selectedTemplateId, templates]);

  const handleSubmitIntent = async () => {
    if (!intentReady || running || swapBusy) return;
    setIntentNotice(null);
    try {
      const result = await submitIntent(intentOverrides);
      await refresh();
      await swap.refreshBalances();
      setIntentNotice({
        tone: result?.duplicate ? "warn" : result?.status === "pending_approval" ? "warn" : result?.ok ? "ok" : "bad",
        text: result?.duplicate
          ? result?.message || "Duplicate payment intent ignored."
          : result?.status === "pending_approval"
          ? "Payment intent is pending human approval."
          : result?.ok
            ? "Payment intent executed successfully."
            : result?.error || "Payment intent was rejected."
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

  const handleSwap = async () => {
    if (swapBusy) return;
    setIntentNotice(null);
    await swap.swap();
    await refresh();
  };

  const updateDraft = (key, value) => {
    setDraft((current) => ({
      ...current,
      [key]: value
    }));
  };

  const handleSaveTemplate = () => {
    const nextTemplate = {
      id: selectedTemplateId || `template-${Date.now()}`,
      label: draft.category || draft.description || `Template ${templates.length + 1}`,
      recipient: draft.recipient,
      amount: draft.amount,
      category: draft.category,
      description: draft.description,
      createdAt: new Date().toISOString()
    };
    setTemplates((current) => {
      const withoutCurrent = current.filter((item) => item.id !== nextTemplate.id);
      return [nextTemplate, ...withoutCurrent].slice(0, 20);
    });
    setSelectedTemplateId(nextTemplate.id);
    setIntentNotice({
      tone: "ok",
      text: "Template saved locally in this browser."
    });
  };

  const handleApplyTemplate = (templateId) => {
    setSelectedTemplateId(templateId);
  };

  const handleDeleteTemplate = (templateId) => {
    setTemplates((current) => current.filter((item) => item.id !== templateId));
    if (selectedTemplateId === templateId) {
      setSelectedTemplateId("");
    }
  };

  const handleIntentApproval = async (action) => {
    const pendingIntentId = snapshot.pendingApprovals?.[0]?.intentId || snapshot.pendingApprovals?.[0]?.id;
    if (!pendingIntentId) return;
    setApprovalBusy(true);
    setIntentNotice(null);
    try {
      const result = action === "approve"
        ? await api.approvePaymentIntent(pendingIntentId, { reason: "Approved from dashboard" })
        : await api.rejectPaymentIntent(pendingIntentId, { reason: "Rejected from dashboard" });
      await refresh();
      setIntentNotice({
        tone: result?.status === "executed" ? "ok" : "warn",
        text: result?.status === "executed" ? "Pending intent approved and executed." : "Pending intent rejected."
      });
    } catch (error) {
      setIntentNotice({
        tone: "bad",
        text: error.message || "Approval update failed."
      });
    } finally {
      setApprovalBusy(false);
    }
  };

  const handlePauseToggle = async () => {
    setPauseBusy(true);
    setIntentNotice(null);
    try {
      if (budget.paused) {
        await api.unpauseAgent(snapshot.agentId);
      } else {
        await api.pauseAgent(snapshot.agentId);
      }
      await refresh();
    } catch (error) {
      setIntentNotice({
        tone: "bad",
        text: error.message || "Pause control failed."
      });
    } finally {
      setPauseBusy(false);
    }
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
                disabled={!intentReady || running || swapBusy}
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

              {walletReady && (
                <div className="border border-wire bg-surface-1 rounded-sm overflow-hidden">
                  <div className="px-5 py-4 border-b border-wire">
                    <p className="font-mono text-label text-amber-500 uppercase tracking-widest mb-2">
                      {swap.hasRequiredQusdc ? "QUSDC ready" : "Insufficient QUSDC"}
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

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                      <QuoteStat
                        label="Estimated received"
                        value={swap.quote ? `${formatTokenAmount(swap.quote.amountOut, 6)} QUSDC` : swap.quoting ? "Fetching..." : "No quote"}
                      />
                      <QuoteStat
                        label="Swap route"
                        value={swap.quote ? [swap.selectedToken?.symbol || "Token", "QUSDC"].join(" -> ") : "n/a"}
                      />
                      <QuoteStat
                        label="Estimated gas"
                        value={swap.quote?.estimatedGas?.feeQie ? `${swap.quote.estimatedGas.feeQie} QIE` : swap.quoting ? "Estimating..." : "Unavailable"}
                      />
                      <QuoteStat
                        label="Minimum received"
                        value={swap.quote ? `${formatTokenAmount(swap.quote.minReceived, 6)} QUSDC` : "n/a"}
                      />
                      <QuoteStat
                        label="Price impact"
                        value={swap.quote ? formatBps(swap.quote.priceImpactBps) : "n/a"}
                      />
                      <QuoteStat
                        label="Slippage"
                        value={formatBps(swap.slippageBps)}
                      />
                    </div>

                    {swap.stage !== "idle" && (
                      <div className={`border rounded-sm p-4 ${swap.stage === "failed" ? "border-red-900/40 bg-red-950/10" : "border-wire bg-surface-2"}`}>
                        <p className={`text-body-sm ${swap.stage === "failed" ? "text-red-400" : "text-ink-2"}`}>
                          {swap.stage === "quoting"
                            ? "Fetching the best route and gas estimate."
                            : swap.stage === "preparing"
                              ? "Preparing the wallet and quote."
                              : swap.stage === "submitting"
                                ? "Submitting the swap transaction."
                                : swap.stage === "confirming"
                                  ? "Waiting for confirmations and updated balances."
                                  : swap.stage === "failed"
                                    ? swap.error || "Swap failed."
                            : "Swap in progress."}
                        </p>
                      </div>
                    )}

                    {swap.loadingBalances && !swap.swapping && (
                      <div className="border border-wire bg-surface-2 rounded-sm p-4">
                        <p className="text-body-sm text-ink-2">
                          Refreshing wallet balances from QIE Mainnet.
                        </p>
                      </div>
                    )}

                    {(swap.error || swap.success) && (
                      <div className={`border rounded-sm p-4 ${
                        swap.success ? "border-green-900/40 bg-green-950/10" : "border-red-900/40 bg-red-950/10"
                      }`}>
                        <p className={`text-body-sm ${swap.success ? "text-green-400" : "text-red-400"} break-words`}>
                          {swap.success?.message || swap.error}
                        </p>
                        {swap.success?.swap && (
                          <div className="mt-3 flex flex-wrap gap-3">
                            <TxLink hash={swap.success.swap} network={network} />
                            {swap.success?.approval && <TxLink hash={swap.success.approval} network={network} />}
                            {swap.success?.wrap && <TxLink hash={swap.success.wrap} network={network} />}
                          </div>
                        )}
                        {swap.success?.routeLabel && (
                          <p className="mt-3 text-body-sm text-ink-2 break-words">
                            Route: {swap.success.routeLabel} · Received: {swap.success.estimatedReceived} QUSDC · Minimum: {swap.success.minimumReceived} QUSDC
                          </p>
                        )}
                        {swap.success?.balanceAfterSwap && (
                          <p className="mt-2 text-body-sm text-ink-2 break-words">
                            QUSDC balance after swap: {swap.success.balanceAfterSwap} QUSDC
                          </p>
                        )}
                        {swap.success?.estimatedGas?.label && (
                          <p className="mt-2 text-body-sm text-ink-2 break-words">
                            Estimated gas: {swap.success.estimatedGas.label}
                          </p>
                        )}
                      </div>
                    )}

                    <button
                      onClick={() => handleSwap().catch(() => {})}
                      disabled={!swap.quote || swapBusy || !swap.inputAmount}
                      className="btn-primary w-full justify-center disabled:opacity-50 disabled:hover:scale-100 disabled:cursor-not-allowed"
                    >
                      {swap.swapping && swap.selectedTokenId === "QIE"
                        ? "Swapping QIE to QUSDC..."
                        : swap.swapping
                          ? "Swapping..."
                          : swap.loadingBalances
                            ? "Refreshing balances..."
                            : swap.quoting
                              ? "Loading quote..."
                              : "Swap"}
                    </button>
                  </div>
                </div>
              )}

              <div className="border-t border-wire mt-6 pt-6">
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between mb-5">
                  <div>
                    <p className="stat-label mb-2">Intent editor</p>
                    <h3 className="text-xl md:text-2xl font-medium text-ink-0">Prepare the payment intent</h3>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <StatusPill tone={walletReady ? "ok" : "warn"}>{walletReady ? "Wallet ready" : "Wallet needed"}</StatusPill>
                    <StatusPill tone={preview?.approvalRequired ? "warn" : preview?.available ? "ok" : "neutral"}>
                      {previewStageLabel}
                    </StatusPill>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="stat-label block mb-3">Recipient</label>
                    <input
                      value={draft.recipient}
                      onChange={(event) => updateDraft("recipient", event.target.value)}
                      placeholder="0x..."
                      className="w-full bg-surface-3 border border-wire text-ink-0 font-mono text-body-md px-4 py-3 rounded-sm focus:outline-none focus:border-ink-3 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="stat-label block mb-3">Amount (QUSDC)</label>
                    <input
                      value={draft.amount}
                      onChange={(event) => updateDraft("amount", event.target.value)}
                      placeholder="0.05"
                      inputMode="decimal"
                      className="w-full bg-surface-3 border border-wire text-ink-0 font-mono text-body-md px-4 py-3 rounded-sm focus:outline-none focus:border-ink-3 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="stat-label block mb-3">Category</label>
                    <input
                      value={draft.category}
                      onChange={(event) => updateDraft("category", event.target.value)}
                      placeholder="Inference Provider"
                      className="w-full bg-surface-3 border border-wire text-ink-0 font-mono text-body-md px-4 py-3 rounded-sm focus:outline-none focus:border-ink-3 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="stat-label block mb-3">Description</label>
                    <input
                      value={draft.description}
                      onChange={(event) => updateDraft("description", event.target.value)}
                      placeholder="Short task description"
                      className="w-full bg-surface-3 border border-wire text-ink-0 font-mono text-body-md px-4 py-3 rounded-sm focus:outline-none focus:border-ink-3 transition-colors"
                    />
                  </div>
                </div>

                <div className="mt-5 grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-4">
                  <div className="border border-wire bg-surface-1 rounded-sm p-4">
                    <div className="flex items-center justify-between gap-3 mb-4">
                      <div>
                        <p className="stat-label mb-2">Templates</p>
                        <h4 className="text-lg font-medium text-ink-0">Local intent presets</h4>
                      </div>
                      <button className="btn-secondary text-xs px-4 py-2" onClick={handleSaveTemplate}>
                        Save Template
                      </button>
                    </div>
                    <div className="space-y-3">
                      <select
                        value={selectedTemplateId}
                        onChange={(event) => handleApplyTemplate(event.target.value)}
                        className="w-full bg-surface-3 border border-wire text-ink-0 font-mono text-body-sm px-4 py-3 rounded-sm focus:outline-none focus:border-ink-3 transition-colors"
                      >
                        <option value="">Select saved template</option>
                        {templates.map((template) => (
                          <option key={template.id} value={template.id}>
                            {template.label || template.id}
                          </option>
                        ))}
                      </select>
                      <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                        {templates.length ? templates.map((template) => (
                          <div key={template.id} className="flex items-center justify-between gap-3 border border-wire bg-surface-2 rounded-sm px-3 py-2">
                            <button
                              type="button"
                              onClick={() => handleApplyTemplate(template.id)}
                              className="text-left"
                            >
                              <p className="font-mono text-label uppercase text-ink-0">{template.label || template.id}</p>
                              <p className="text-body-sm text-ink-3 break-words">{shortHash(template.recipient)} - {template.amount} QUSDC</p>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteTemplate(template.id)}
                              className="font-mono text-label uppercase text-red-400"
                            >
                              Remove
                            </button>
                          </div>
                        )) : (
                          <p className="text-body-sm text-ink-3">No saved templates yet.</p>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="border border-wire bg-surface-1 rounded-sm p-4">
                    <div className="flex items-center justify-between gap-3 mb-4">
                      <div>
                        <p className="stat-label mb-2">Advanced policy rules</p>
                        <h4 className="text-lg font-medium text-ink-0">Manual approval and limits</h4>
                      </div>
                      <button
                        type="button"
                        onClick={() => updateDraft("manualApprovalEnabled", !draft.manualApprovalEnabled)}
                        className={`relative w-11 h-6 rounded-sm transition-colors duration-200 ${
                          draft.manualApprovalEnabled ? "bg-ink-1" : "bg-surface-5"
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-sm bg-ink-0 transition-transform duration-200 ${
                            draft.manualApprovalEnabled ? "translate-x-5" : "translate-x-0"
                          }`}
                        />
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="stat-label block mb-2">Maximum payment amount (QUSDC)</label>
                        <input
                          value={draft.maxPaymentAmountWei}
                          onChange={(event) => updateDraft("maxPaymentAmountWei", event.target.value)}
                          placeholder="5"
                          className="w-full bg-surface-3 border border-wire text-ink-0 font-mono text-body-sm px-4 py-3 rounded-sm focus:outline-none focus:border-ink-3 transition-colors"
                        />
                      </div>
                      <div>
                        <label className="stat-label block mb-2">Manual approval above (QUSDC)</label>
                        <input
                          value={draft.manualApprovalThresholdWei}
                          onChange={(event) => updateDraft("manualApprovalThresholdWei", event.target.value)}
                          placeholder="2"
                          className="w-full bg-surface-3 border border-wire text-ink-0 font-mono text-body-sm px-4 py-3 rounded-sm focus:outline-none focus:border-ink-3 transition-colors"
                        />
                      </div>
                      <div>
                        <label className="stat-label block mb-2">Maximum payments per day</label>
                        <input
                          value={draft.maxPaymentsPerDay}
                          onChange={(event) => updateDraft("maxPaymentsPerDay", event.target.value)}
                          placeholder="3"
                          inputMode="numeric"
                          className="w-full bg-surface-3 border border-wire text-ink-0 font-mono text-body-sm px-4 py-3 rounded-sm focus:outline-none focus:border-ink-3 transition-colors"
                        />
                      </div>
                      <div>
                        <label className="stat-label block mb-2">Allowed recipients</label>
                        <textarea
                          value={draft.whitelistRecipients}
                          onChange={(event) => updateDraft("whitelistRecipients", event.target.value)}
                          placeholder={"0x...\n0x..."}
                          rows={4}
                          className="w-full bg-surface-3 border border-wire text-ink-0 font-mono text-body-sm px-4 py-3 rounded-sm focus:outline-none focus:border-ink-3 transition-colors resize-none"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-5 grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-4">
                  <div className="border border-wire bg-surface-1 rounded-sm p-4">
                    <div className="flex items-center justify-between gap-3 mb-4">
                      <div>
                        <p className="stat-label mb-2">Intent Preview</p>
                        <h4 className="text-lg font-medium text-ink-0">Execution readiness</h4>
                      </div>
                      <StatusPill tone={preview?.approvalRequired ? "warn" : preview?.available ? "ok" : "bad"}>
                        {preview?.approvalRequired ? "Pending approval" : preview?.available ? "Ready" : "Blocked"}
                      </StatusPill>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <QuoteStat label="Recipient" value={shortHash(preview?.recipient || draft.recipient)} />
                      <QuoteStat label="Amount" value={preview ? `${preview.amount || draft.amount} QUSDC` : `${draft.amount || "0"} QUSDC`} />
                      <QuoteStat label="Token" value={preview?.token || "QUSDC"} />
                      <QuoteStat label="Estimated gas" value={(preview?.estimatedGas?.label || previewLoading) ? (preview?.estimatedGas?.label || "Estimating...") : "Unavailable"} />
                      <QuoteStat label="Budget remaining after payment" value={preview?.budgetRemainingAfterPayment !== undefined && preview?.budgetRemainingAfterPayment !== null ? `${preview.budgetRemainingAfterPayment} QUSDC` : "Unavailable"} />
                      <QuoteStat label="Daily spending remaining" value={preview?.dailySpendingRemaining !== undefined && preview?.dailySpendingRemaining !== null ? `${preview.dailySpendingRemaining} QUSDC` : "Unavailable"} />
                      <QuoteStat label="Policy" value={preview?.policyStatus || "Unavailable"} />
                      <QuoteStat label="Risk" value={preview?.riskLevel || "Unavailable"} />
                      <QuoteStat label="Execution" value={preview?.executionReadiness || "Unavailable"} />
                      <QuoteStat label="Preview state" value={previewError || previewStageLabel} />
                    </div>
                    <p className="mt-4 text-body-sm text-ink-2 break-words">
                      {preview?.details || previewError || "The preview is computed from the live snapshot, policy rules, and on-chain budget."}
                    </p>
                    {preview?.reasons?.length ? (
                      <p className="mt-3 text-body-sm text-ink-3 break-words">
                        Reasons: {preview.reasons.join(", ")}
                      </p>
                    ) : null}
                  </div>

                  <div className="border border-wire bg-surface-1 rounded-sm p-4">
                    <div className="flex items-center justify-between gap-3 mb-4">
                      <div>
                        <p className="stat-label mb-2">Operational controls</p>
                        <h4 className="text-lg font-medium text-ink-0">Emergency pause</h4>
                      </div>
                      <StatusPill tone={budget.paused ? "bad" : "ok"}>{budget.paused ? "Paused" : "Active"}</StatusPill>
                    </div>
                    <p className="text-body-sm text-ink-2 mb-4">
                      Pause the agent to block payment execution at the controller level. Validation will return a paused state until resumed.
                    </p>
                    <button
                      className={`w-full font-medium text-body-sm px-5 py-3 rounded-sm transition-transform duration-150 hover:scale-95 ${
                        budget.paused
                          ? "border border-green-800/50 bg-green-950/20 text-green-300"
                          : "border border-red-800/50 bg-red-950/20 text-red-400"
                      }`}
                      onClick={() => handlePauseToggle().catch(() => {})}
                      disabled={pauseBusy}
                    >
                      {pauseBusy ? "Updating..." : budget.paused ? "Resume Agent" : "Pause Agent"}
                    </button>
                  </div>
                </div>

                {intentNotice && (
                  <div className={`mt-5 border rounded-sm p-4 ${intentNotice.tone === "ok" ? "border-green-900/40 bg-green-950/10" : intentNotice.tone === "warn" ? "border-amber-900/40 bg-amber-950/10" : "border-red-900/40 bg-red-950/10"}`}>
                    <p className={`text-body-sm ${intentNotice.tone === "ok" ? "text-green-400" : intentNotice.tone === "warn" ? "text-amber-500" : "text-red-400"}`}>
                      {intentNotice.text}
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="px-8 py-6 border-t border-wire">
              <p className="stat-label mb-4">Spending policy</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  `Remaining: ${budget.remaining || "0"} QUSDC`,
                  `Spent today: ${budget.spentToday || "0"} QUSDC`,
                  `Limiter: ${budget.limitingConstraint || "unknown"}`,
                  budget.paused ? "Agent is paused" : "Agent is unpaused",
                  `Manual approval: ${draft.manualApprovalEnabled ? "enabled" : "disabled"}`,
                  `Whitelist entries: ${normalizeWhitelistInput(draft.whitelistRecipients).length || 0}`
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

            <div className="px-8 py-5 border-t border-wire flex flex-col gap-3 md:flex-row">
              <button
                className="btn-primary disabled:opacity-50 disabled:hover:scale-100 disabled:cursor-not-allowed"
                onClick={handleSubmitIntent}
                disabled={!intentReady || running || swapBusy}
              >
                {submitLabel}
              </button>
              <button className="btn-secondary" onClick={() => stopAgent().catch(() => {})} disabled={running || !agentRunning}>
                Stop Compatibility Loop
              </button>
              {snapshot.pendingApprovals?.length ? (
                <>
                  <button
                    className="btn-secondary"
                    onClick={() => handleIntentApproval("approve").catch(() => {})}
                    disabled={approvalBusy || running}
                  >
                    {approvalBusy ? "Processing..." : "Approve Pending"}
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={() => handleIntentApproval("reject").catch(() => {})}
                    disabled={approvalBusy || running}
                  >
                    Reject Pending
                  </button>
                </>
              ) : null}
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
