import { ethers } from "ethers";
import {
  AGENT_REGISTRY_ABI,
  ERC20_ABI,
  QIE_MAINNET_CHAIN_ID,
  SPEND_CONTROLLER_ABI,
  STREAM_VAULT_ABI,
  normalizeDeployment,
  resolveNetworkConfig
} from "./contracts.js";
import { createVault, executePayment, getVault, createStream } from "./vault.js";
import { pay } from "./pay.js";
import { emergencyPauseVault, routeRemainingFundsToSafeVault, detectAnomalyFlags } from "./killSwitch.js";
import { CACHE_KEYS, createSpendGridCache } from "./cache.js";
import {
  SpendGridError,
  assertAddress,
  assertPositiveAgentId,
  fetchJson,
  stringifyBigInts
} from "./utils.js";

function isEip1193Provider(value) {
  return value && typeof value.request === "function";
}

function hasSignerShape(value) {
  return value && typeof value.getAddress === "function";
}

/**
 * SpendGrid protocol client for external dApps.
 *
 * @param {object} options
 * @param {number|string|bigint} [options.agentId] Default agent ID for calls.
 * @param {import("ethers").Signer|import("ethers").Provider|object} [options.signer] ethers signer or EIP-1193 provider.
 * @param {import("ethers").Provider|object} [options.provider] ethers provider or EIP-1193 provider.
 * @param {string} [options.rpcUrl] JSON-RPC URL used when no provider is injected.
 * @param {string|object} [options.network] SpendGrid network config. Defaults to qieMainnet.
 * @param {object} [options.deployment] Deployment artifact or address override.
 * @param {string} [options.backendUrl] Optional SpendGrid backend URL for status/anomaly helpers.
 * @param {string|bigint} [options.safeSpendLimit] Optional client max spend in token units.
 * @param {string|bigint} [options.safeSpendLimitWei] Optional client max spend in base units.
 * @param {number} [options.tokenDecimals] Payment token decimals. Defaults to 18.
 * @param {import("./cache.js").SpendGridCache} [options.cache] Shared SDK cache.
 * @param {boolean} [options.adapterMode] Enables zero-config adapter semantics.
 */
export class SpendGridSDK {
  constructor(options = {}) {
    this.agentId = options.agentId === undefined ? null : assertPositiveAgentId(options.agentId);
    this.backendUrl = options.backendUrl || options.apiUrl || null;
    this.safeVault = options.safeVault || options.safeVaultAddress || null;
    this.adapterMode = Boolean(options.adapterMode);
    this.cache = options.cache || createSpendGridCache({ ttlMs: options.cacheTtlMs });
    this.tokenDecimals = Number.isInteger(options.tokenDecimals) ? options.tokenDecimals : 18;
    this.network = resolveNetworkConfig(options.network || "qieMainnet");
    const deployment = options.deployment || {};
    const topLevelDeploymentAddresses = {
      agentRegistry: deployment.agentRegistry || deployment.registry,
      spendController: deployment.spendController || deployment.controller,
      streamVault: deployment.streamVault || deployment.vault,
      qusdc: deployment.qusdc || deployment.qieStablecoin || deployment.stable
    };

    this.deployment = normalizeDeployment({
      ...deployment,
      network: deployment.network || this.network.name,
      chainId: deployment.chainId || this.network.chainId,
      addresses: {
        ...this.network.addresses,
        ...Object.fromEntries(
          Object.entries(topLevelDeploymentAddresses).filter(([, value]) => value)
        ),
        ...(deployment.addresses || {})
      }
    });
    this.addresses = this._normalizeAddresses(this.deployment.addresses);
    this.provider = this._resolveProvider(options);
    this.signer = this._resolveSigner(options);
    this.contracts = this.provider && this._hasProtocolAddresses() ? this._makeContracts() : null;
    this.safeSpendLimitWei = this._resolveSafeSpendLimit(options);
  }

  /**
   * Creates a new stream for an agent and returns its vault record.
   */
  createVault(options = {}) {
    return createVault(this, options);
  }

  /**
   * Returns a stream by ID, or agent vault summary when no streamId is supplied.
   */
  getVault(options = {}) {
    return getVault(this, options);
  }

  /**
   * Executes an existing stream payment.
   */
  executePayment(options = {}) {
    return executePayment(this, options);
  }

  /**
   * Creates a stream without executing payment.
   */
  createStream(options = {}) {
    return createStream(this, options);
  }

  /**
   * Executes an instant or stream SpendGrid payment.
   */
  pay(options = {}) {
    return pay(this, options);
  }

  /**
   * Submits a payment intent to the SpendGrid backend validation and execution flow.
   */
  submitPaymentIntent(intent = {}) {
    if (!this.backendUrl) {
      throw new SpendGridError("backendUrl is required to submit payment intents", "BACKEND_URL_REQUIRED");
    }

    return this.requestBackend("/payment-intents", {
      method: "POST",
      body: stringifyBigInts(intent)
    }).catch((error) => {
      const body = error?.details?.body;
      if (body?.intentId && ["rejected", "failed"].includes(body.status)) {
        return body;
      }
      throw error;
    });
  }

  /**
   * Subscribe to backend agent history or contract events.
   */
  subscribe(options = {}) {
    return subscribe(this, options);
  }

  emergencyPauseVault(options = {}) {
    return emergencyPauseVault(this, options);
  }

  routeRemainingFundsToSafeVault(options = {}) {
    return routeRemainingFundsToSafeVault(this, options);
  }

  detectAnomalyFlags(options = {}) {
    return detectAnomalyFlags(this, options);
  }

  async getAgent(agentId = this.agentId) {
    this._requireContracts();
    const resolvedAgentId = assertPositiveAgentId(agentId);

    return this.cache.remember(CACHE_KEYS.agent, resolvedAgentId.toString(), async () => {
      try {
        const agent = await this.contracts.registry.getAgent(resolvedAgentId);
        return stringifyBigInts({
          agentId: resolvedAgentId,
          owner: agent.owner,
          agentWallet: agent.agentWallet,
          qiePassId: agent.qiePassId,
          active: agent.active,
          createdAt: agent.createdAt
        });
      } catch (error) {
        throw new SpendGridError("agentId is not registered", "AGENT_NOT_REGISTERED", {
          agentId: resolvedAgentId.toString(),
          cause: error.shortMessage || error.message
        });
      }
    });
  }

  async getAgentIdForWallet(walletAddress) {
    this._requireContracts();
    const wallet = assertAddress(walletAddress, "wallet");

    return this.cache.remember(CACHE_KEYS.walletAgent, wallet, async () => {
      const [ownerAgentId, executionAgentId] = await Promise.all([
        this.contracts.registry.ownerAgentId(wallet),
        this.contracts.registry.executionWalletAgentId(wallet)
      ]);
      const resolved = BigInt(ownerAgentId || 0n) > 0n ? BigInt(ownerAgentId) : BigInt(executionAgentId || 0n);
      return resolved > 0n ? resolved.toString() : null;
    });
  }

  async registerAgent({ agentWallet, qiePassId } = {}) {
    this._requireContracts();
    const signer = await this.requireSigner();
    const wallet = assertAddress(agentWallet || await signer.getAddress(), "agentWallet");
    const identity = qiePassId || ethers.id(`spendgrid:qie-mainnet:${wallet.toLowerCase()}`);
    if (!ethers.isHexString(identity, 32)) {
      throw new SpendGridError("qiePassId must be bytes32", "INVALID_QIE_PASS_ID", { qiePassId: identity });
    }

    await this.assertNetwork();
    const registry = this.contracts.registry.connect(signer);
    const tx = await registry.registerAgent(wallet, identity);
    const receipt = await tx.wait();
    this.cache.delete(CACHE_KEYS.walletAgent, wallet);
    const agentId = await this.getAgentIdForWallet(wallet);
    if (!agentId) {
      this.invalidateAgentCache(wallet);
      throw new SpendGridError("agent registration transaction completed but agentId was not resolved", "AGENT_RESOLUTION_FAILED", {
        wallet,
        txHash: tx.hash
      });
    }

    this.cache.set(CACHE_KEYS.walletAgent, wallet, agentId);
    this.cache.delete(CACHE_KEYS.agent, agentId);

    return stringifyBigInts({
      agentId,
      agentWallet: wallet,
      qiePassId: identity,
      txHash: tx.hash,
      status: receipt.status === 1 ? "confirmed" : "failed",
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed
    });
  }

  async ensureControllerConfig({ agentId = this.agentId, dailyLimit, whitelistVault = true } = {}) {
    this._requireContracts();
    const resolvedAgentId = assertPositiveAgentId(agentId);
    const signer = await this.requireSigner();
    const controller = this.contracts.controller.connect(signer);
    const updates = [];

    await this.assertNetwork();
    if (dailyLimit !== undefined && dailyLimit !== null) {
      const tx = await controller.setBudget(resolvedAgentId, BigInt(dailyLimit));
      const receipt = await tx.wait();
      updates.push({
        type: "setBudget",
        txHash: tx.hash,
        status: receipt.status === 1 ? "confirmed" : "failed",
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed?.toString?.() || null
      });
    }

    if (whitelistVault) {
      const whitelisted = await this.contracts.controller.isServiceWhitelisted(
        resolvedAgentId,
        this.addresses.streamVault
      );
      if (!whitelisted) {
        const tx = await controller.setServiceWhitelist(resolvedAgentId, this.addresses.streamVault, true);
        const receipt = await tx.wait();
        updates.push({
          type: "setServiceWhitelist",
          txHash: tx.hash,
          status: receipt.status === 1 ? "confirmed" : "failed",
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed?.toString?.() || null
        });
      }
    }

    this.invalidateAgentCache(null, resolvedAgentId);
    return { agentId: resolvedAgentId.toString(), updates };
  }

  async assertAgentActive(agentId = this.agentId) {
    const agent = await this.getAgent(agentId);
    if (!agent.active) {
      throw new SpendGridError("agent is inactive", "AGENT_INACTIVE", { agentId: String(agent.agentId) });
    }

    return agent;
  }

  async getBudget(agentId = this.agentId) {
    this._requireContracts();
    const resolvedAgentId = assertPositiveAgentId(agentId);
    return this.cache.remember(CACHE_KEYS.controller, resolvedAgentId.toString(), async () => {
      const budget = await this.contracts.controller.getBudget(resolvedAgentId);

      return stringifyBigInts({
        agentId: resolvedAgentId,
        dailyLimit: budget.dailyLimit,
        spentToday: budget.spentToday,
        lastResetTimestamp: budget.lastResetTimestamp,
        nextResetTimestamp: budget.nextResetTimestamp,
        paused: budget.paused,
        remainingWei: BigInt(budget.dailyLimit || 0n) > BigInt(budget.spentToday || 0n)
          ? BigInt(budget.dailyLimit) - BigInt(budget.spentToday)
          : 0n
      });
    });
  }

  async getSafeSpendLimit(agentId = this.agentId) {
    const resolvedAgentId = assertPositiveAgentId(agentId);

    return this.cache.remember(CACHE_KEYS.safeSpendLimit, [
      resolvedAgentId.toString(),
      this.safeSpendLimitWei?.toString?.() || "controller"
    ], async () => {
      const budget = await this.getBudget(resolvedAgentId);
      const remaining = BigInt(budget.remainingWei || "0");
      const configuredLimit = this.safeSpendLimitWei;
      const safeSpendLimitWei = configuredLimit === null
        ? remaining
        : (remaining < configuredLimit ? remaining : configuredLimit);

      return stringifyBigInts({
        agentId: resolvedAgentId,
        safeSpendLimitWei,
        remainingWei: remaining,
        configuredSafeSpendLimitWei: configuredLimit,
        paused: budget.paused
      });
    });
  }

  async assertSpendAllowed({ agentId = this.agentId, amountWei, service = this.addresses.streamVault }) {
    this._requireContracts();
    const resolvedAgentId = assertPositiveAgentId(agentId);
    const amount = BigInt(amountWei);
    if (amount <= 0n) {
      throw new SpendGridError("payment amount must be greater than zero", "INVALID_AMOUNT", {
        amountWei: amount.toString()
      });
    }

    const [agent, budget, vaultWhitelisted, canSpendFor] = await Promise.all([
      this.assertAgentActive(resolvedAgentId),
      this.getBudget(resolvedAgentId),
      this.contracts.controller.isServiceWhitelisted(resolvedAgentId, service),
      this.contracts.controller.canSpendFor(resolvedAgentId, service, amount)
    ]);

    const dailyLimit = BigInt(budget.dailyLimit || "0");
    const spentToday = BigInt(budget.spentToday || "0");
    const remainingWei = dailyLimit > spentToday ? dailyLimit - spentToday : 0n;
    const configuredSafeLimit = this.safeSpendLimitWei;
    const effectiveSafeLimit = configuredSafeLimit === null
      ? remainingWei
      : (remainingWei < configuredSafeLimit ? remainingWei : configuredSafeLimit);
    const checks = {
      paused: Boolean(budget.paused),
      dailyLimitExceeded: dailyLimit === 0n || spentToday + amount > dailyLimit,
      notWhitelisted: !Boolean(vaultWhitelisted),
      exceedsSafeSpendLimit: amount > effectiveSafeLimit,
      controllerRejected: !Boolean(canSpendFor)
    };

    if (
      checks.paused ||
      checks.dailyLimitExceeded ||
      checks.notWhitelisted ||
      checks.exceedsSafeSpendLimit ||
      checks.controllerRejected
    ) {
      throw new SpendGridError("SpendController rejected payment preflight", "SPEND_BLOCKED", {
        agent,
        budget,
        checks,
        service,
        amountWei: amount.toString(),
        safeSpendLimitWei: effectiveSafeLimit.toString(),
        configuredSafeSpendLimitWei: configuredSafeLimit?.toString?.() || null
      });
    }

    return stringifyBigInts({
      agent,
      budget,
      checks,
      service,
      amountWei: amount,
      safeSpendLimitWei: effectiveSafeLimit,
      configuredSafeSpendLimitWei: configuredSafeLimit
    });
  }

  async assertAgentOperator(agentId = this.agentId, extraOperators = []) {
    const [signer, agent] = await Promise.all([
      this.requireSigner(),
      this.assertAgentActive(agentId)
    ]);
    const signerAddress = ethers.getAddress(await signer.getAddress());
    const allowed = [agent.owner, agent.agentWallet, ...extraOperators]
      .filter(Boolean)
      .map((address) => ethers.getAddress(address));

    if (!allowed.includes(signerAddress)) {
      throw new SpendGridError("connected signer is not authorized for this agent", "UNAUTHORIZED_AGENT_OPERATOR", {
        agentId: String(agent.agentId),
        signer: signerAddress,
        allowedOperators: allowed
      });
    }

    return {
      signer,
      signerAddress,
      agent
    };
  }

  async assertTokenAllowance({ owner, amountWei, spender = this.addresses.streamVault }) {
    this._requireContracts();
    const tokenOwner = assertAddress(owner, "owner");
    const amount = BigInt(amountWei);
    const allowance = await this.contracts.qusdc.allowance(tokenOwner, spender);

    if (BigInt(allowance) < amount) {
      throw new SpendGridError("QUSDC allowance is below payment amount", "INSUFFICIENT_ALLOWANCE", {
        owner: tokenOwner,
        spender,
        allowance: allowance.toString(),
        amountWei: amount.toString()
      });
    }

    return stringifyBigInts({
      owner: tokenOwner,
      spender,
      allowance,
      amountWei: amount
    });
  }

  invalidateAgentCache(walletAddress, agentId = this.agentId) {
    if (walletAddress) {
      this.cache.delete(CACHE_KEYS.walletAgent, assertAddress(walletAddress, "wallet"));
    }
    if (agentId) {
      const normalizedAgentId = assertPositiveAgentId(agentId).toString();
      this.cache.delete(CACHE_KEYS.agent, normalizedAgentId);
      this.cache.delete(CACHE_KEYS.vault, normalizedAgentId);
      this.cache.delete(CACHE_KEYS.controller, normalizedAgentId);
      this.cache.delete(CACHE_KEYS.safeSpendLimit, [
        normalizedAgentId,
        this.safeSpendLimitWei?.toString?.() || "controller"
      ]);
    }
  }

  async assertNetwork() {
    const network = await this.provider.getNetwork();
    if (network.chainId !== BigInt(this.deployment.chainId || QIE_MAINNET_CHAIN_ID)) {
      throw new SpendGridError("connected wallet is on the wrong network", "NETWORK_MISMATCH", {
        expectedChainId: Number(this.deployment.chainId || QIE_MAINNET_CHAIN_ID),
        actualChainId: network.chainId.toString()
      });
    }

    return network;
  }

  async requireSigner() {
    if (this.signer && hasSignerShape(this.signer)) {
      return this.signer;
    }

    if (this.provider && typeof this.provider.getSigner === "function") {
      const signer = await this.provider.getSigner();
      if (hasSignerShape(signer)) {
        this.signer = signer;
        return signer;
      }
    }

    if (!this.signer || !hasSignerShape(this.signer)) {
      throw new SpendGridError("a signer is required for SpendGrid transactions", "SIGNER_REQUIRED");
    }

    return this.signer;
  }

  async requestBackend(path, options = {}) {
    return fetchJson(this.backendUrl, path, options);
  }

  async loadBackendStatus(agentId = this.agentId) {
    if (!this.backendUrl) {
      return null;
    }

    return this.requestBackend(`/status/${assertPositiveAgentId(agentId).toString()}`);
  }

  _normalizeAddresses(addresses) {
    return {
      agentRegistry: addresses.agentRegistry ? assertAddress(addresses.agentRegistry, "AgentRegistry") : null,
      spendController: addresses.spendController ? assertAddress(addresses.spendController, "SpendController") : null,
      streamVault: addresses.streamVault ? assertAddress(addresses.streamVault, "StreamVault") : null,
      qusdc: assertAddress(addresses.qusdc, "QUSDC")
    };
  }

  _hasProtocolAddresses() {
    return Boolean(this.addresses.agentRegistry && this.addresses.spendController && this.addresses.streamVault);
  }

  _requireContracts() {
    if (!this.contracts) {
      throw new SpendGridError(
        "SpendGrid protocol contract addresses are required for direct contract operations",
        "CONTRACT_ADDRESSES_REQUIRED",
        { chainId: this.deployment.chainId, network: this.deployment.network }
      );
    }
  }

  _resolveProvider(options) {
    if (options.provider) {
      return isEip1193Provider(options.provider)
        ? new ethers.BrowserProvider(options.provider)
        : options.provider;
    }

    if (options.signer && !hasSignerShape(options.signer) && isEip1193Provider(options.signer)) {
      return new ethers.BrowserProvider(options.signer);
    }

    if (options.signer?.provider) {
      return options.signer.provider;
    }

    if (options.rpcUrl) {
      return new ethers.JsonRpcProvider(options.rpcUrl, this.network.chainId);
    }

    if (typeof globalThis !== "undefined" && globalThis.ethereum) {
      return new ethers.BrowserProvider(globalThis.ethereum);
    }

    if (this.backendUrl) {
      return null;
    }

    throw new SpendGridError("provider, signer, rpcUrl, or window.ethereum is required", "PROVIDER_REQUIRED");
  }

  _resolveSigner(options) {
    if (hasSignerShape(options.signer)) {
      return options.signer;
    }

    return null;
  }

  _makeContracts() {
    const readRunner = this.provider;
    const contractsKey = [
      this.addresses.agentRegistry,
      this.addresses.spendController,
      this.addresses.streamVault,
      this.addresses.qusdc
    ];
    const cached = this.cache.get(CACHE_KEYS.contracts, contractsKey);
    if (cached) {
      return cached;
    }

    return this.cache.set(CACHE_KEYS.contracts, contractsKey, {
      registry: new ethers.Contract(this.addresses.agentRegistry, AGENT_REGISTRY_ABI, readRunner),
      controller: new ethers.Contract(this.addresses.spendController, SPEND_CONTROLLER_ABI, readRunner),
      vault: new ethers.Contract(this.addresses.streamVault, STREAM_VAULT_ABI, readRunner),
      qusdc: new ethers.Contract(this.addresses.qusdc, ERC20_ABI, readRunner)
    }, { ttlMs: 0 });
  }

  _resolveSafeSpendLimit(options) {
    if (options.safeSpendLimitWei !== undefined && options.safeSpendLimitWei !== null) {
      return BigInt(options.safeSpendLimitWei);
    }
    if (options.safeSpendLimit !== undefined && options.safeSpendLimit !== null) {
      return ethers.parseUnits(String(options.safeSpendLimit), this.tokenDecimals);
    }

    return null;
  }
}

export function subscribe(sdk, options = {}) {
  const event = options.event || "PaymentExecuted";
  const onEvent = typeof options.onEvent === "function" ? options.onEvent : options.callback;
  if (typeof onEvent !== "function") {
    throw new SpendGridError("subscribe requires onEvent callback", "INVALID_SUBSCRIPTION");
  }

  if (options.source === "backend") {
    let stopped = false;
    let timer = null;
    const intervalMs = Math.max(Number(options.intervalMs || 10000), 1000);
    const seen = new Set();

    const poll = async () => {
      if (stopped) return;
      try {
        const history = await sdk.requestBackend("/agent/history");
        const records = history?.records || history?.history || [];
        for (const record of records.reverse()) {
          const key = record.txHash || record.transaction?.executePayment?.txHash || record.runId || JSON.stringify(record);
          if (!seen.has(key)) {
            seen.add(key);
            onEvent(record);
          }
        }
      } catch (error) {
        options.onError?.(error);
      } finally {
        if (!stopped) {
          timer = setTimeout(poll, intervalMs);
        }
      }
    };

    poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }

  const filterArgs = [];
  if (options.streamId !== undefined) {
    filterArgs[0] = BigInt(options.streamId);
  }
  if (options.agentId !== undefined) {
    filterArgs[1] = BigInt(options.agentId);
  }

  const filter = sdk.contracts.vault.filters[event]
    ? sdk.contracts.vault.filters[event](...filterArgs)
    : event;

  const listener = (...args) => {
    const payload = args.at(-1);
    onEvent(stringifyBigInts({ args: args.slice(0, -1), event: payload }));
  };

  sdk.contracts.vault.on(filter, listener);
  return () => sdk.contracts.vault.off(filter, listener);
}
