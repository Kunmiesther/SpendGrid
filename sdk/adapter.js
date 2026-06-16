import { ethers } from "ethers";
import { SpendGridSDK } from "./client.js";
import { CACHE_KEYS, createSpendGridCache } from "./cache.js";
import { SpendGridError, assertAddress, parseTokenAmount, stringifyBigInts } from "./utils.js";

/**
 * Creates a zero-config SpendGrid adapter for a connected wallet/provider.
 *
 * The adapter never needs manual agentId input. It resolves the connected wallet,
 * maps it to an agent, optionally registers that agent through the user's signer,
 * and delegates execution to the existing SDK payment path.
 */
export function createSpendGridAdapter(provider, options = {}) {
  const cache = options.cache || createSpendGridCache({ ttlMs: options.cacheTtlMs });
  const providerOptions = normalizeProviderOptions(provider, options);
  const sdk = options.sdk || new SpendGridSDK({
    ...options,
    ...providerOptions,
    cache,
    adapterMode: true
  });

  return new SpendGridAdapter(sdk, {
    ...options,
    provider,
    cache
  });
}

export class SpendGridAdapter {
  constructor(sdk, options = {}) {
    this.sdk = sdk;
    this.cache = options.cache || sdk.cache || createSpendGridCache({ ttlMs: options.cacheTtlMs });
    this.autoCreateAgent = Boolean(options.autoCreateAgent);
    this.autoConfigureAgent = Boolean(options.autoConfigureAgent);
    this.defaultDailyLimitWei = options.defaultDailyLimitWei ?? null;
    this.defaultDailyLimit = options.defaultDailyLimit ?? null;
    this.qiePassId = options.qiePassId || null;
    this.defaultMetadata = options.metadata || null;
  }

  async pay(input = {}) {
    const receiver = assertAddress(input.receiver, "receiver");
    const amountWei = input.amountWei !== undefined
      ? BigInt(input.amountWei)
      : parseTokenAmount(input.amount, this.sdk.tokenDecimals);
    const agent = await this.getAgent();
    const limits = await this.getLimits();

    if (limits.budget.paused || !limits.vaultWhitelisted || amountWei > BigInt(limits.safeSpendLimitWei || "0")) {
      throw new SpendGridError("SpendGrid limits block this payment", "SPEND_BLOCKED", {
        agentId: agent.agentId,
        amountWei: amountWei.toString(),
        limits
      });
    }

    const vault = await this.getVault();
    if (input.streamId) {
      await this.assertVaultOwnership(input.streamId, agent.agentId);
    }

    const receipt = await this.sdk.pay({
      ...input,
      receiver,
      amountWei,
      agentId: agent.agentId,
      metadata: input.metadata || this.defaultMetadata
    });
    this.invalidateResolvedState(await this.getWalletAddress(), agent.agentId);

    return stringifyBigInts({
      ...receipt,
      agentId: agent.agentId,
      vaultAddress: vault.vaultAddress || this.sdk.addresses.streamVault
    });
  }

  invalidateResolvedState(wallet, agentId) {
    this.sdk.invalidateAgentCache(wallet, agentId);
    this.cache.delete(CACHE_KEYS.agent, ["wallet", wallet]);
    this.cache.delete(CACHE_KEYS.vault, String(agentId));
    this.cache.delete(CACHE_KEYS.safeSpendLimit, ["adapter", String(agentId)]);
  }

  async getAgent() {
    const wallet = await this.getWalletAddress();

    return this.cache.remember(CACHE_KEYS.agent, ["wallet", wallet], async () => {
      let agentId = await this.sdk.getAgentIdForWallet(wallet);

      if (!agentId && this.autoCreateAgent) {
        if (this.resolveDailyLimit() === null) {
          throw new SpendGridError(
            "autoCreateAgent requires defaultDailyLimit or defaultDailyLimitWei",
            "AUTO_CREATE_LIMIT_REQUIRED",
            { wallet }
          );
        }
        const created = await this.sdk.registerAgent({
          agentWallet: wallet,
          qiePassId: this.qiePassId || ethers.id(`spendgrid:adapter:${wallet.toLowerCase()}`)
        });
        agentId = String(created.agentId);
        await this.configureAgent(agentId);
      }

      if (!agentId) {
        throw new SpendGridError("connected wallet is not registered as a SpendGrid agent", "AGENT_NOT_REGISTERED", {
          wallet,
          autoCreateAgent: this.autoCreateAgent
        });
      }

      this.sdk.agentId = BigInt(agentId);
      const agent = await this.sdk.assertAgentActive(agentId);
      return {
        ...agent,
        agentId: String(agentId),
        wallet
      };
    });
  }

  async getVault() {
    const agent = await this.getAgent();

    return this.cache.remember(CACHE_KEYS.vault, agent.agentId, async () => {
      const vault = await this.sdk.getVault({ agentId: agent.agentId });
      return {
        ...vault,
        agentId: agent.agentId,
        vaultAddress: this.sdk.addresses.streamVault
      };
    });
  }

  async getLimits() {
    const agent = await this.getAgent();

    return this.cache.remember(CACHE_KEYS.safeSpendLimit, ["adapter", agent.agentId], async () => {
      const [budget, safeSpend] = await Promise.all([
        this.sdk.getBudget(agent.agentId),
        this.sdk.getSafeSpendLimit(agent.agentId)
      ]);
      const whitelisted = await this.sdk.contracts.controller.isServiceWhitelisted(
        BigInt(agent.agentId),
        this.sdk.addresses.streamVault
      );

      return stringifyBigInts({
        agentId: agent.agentId,
        budget,
        vaultWhitelisted: Boolean(whitelisted),
        paused: Boolean(budget.paused),
        safeSpendLimitWei: safeSpend.safeSpendLimitWei,
        configuredSafeSpendLimitWei: safeSpend.configuredSafeSpendLimitWei,
        vaultAddress: this.sdk.addresses.streamVault
      });
    });
  }

  async getWalletAddress() {
    return this.cache.remember(CACHE_KEYS.walletAgent, "connectedWallet", async () => {
      const signer = await this.sdk.requireSigner();
      return assertAddress(await signer.getAddress(), "wallet");
    });
  }

  async configureAgent(agentId) {
    if (!this.autoConfigureAgent) {
      return { agentId: String(agentId), updates: [] };
    }

    const dailyLimit = this.resolveDailyLimit();
    if (dailyLimit === null) {
      return { agentId: String(agentId), updates: [] };
    }

    return this.sdk.ensureControllerConfig({
      agentId,
      dailyLimit,
      whitelistVault: true
    });
  }

  async assertVaultOwnership(streamId, agentId) {
    const stream = await this.sdk.contracts.vault.getStream(BigInt(streamId));
    if (BigInt(stream.agentId) !== BigInt(agentId)) {
      throw new SpendGridError("stream does not belong to resolved agent", "STREAM_AGENT_MISMATCH", {
        streamId: String(streamId),
        agentId: String(agentId)
      });
    }

    return stream;
  }

  resolveDailyLimit() {
    if (this.defaultDailyLimitWei !== null && this.defaultDailyLimitWei !== undefined) {
      return BigInt(this.defaultDailyLimitWei);
    }
    if (this.defaultDailyLimit !== null && this.defaultDailyLimit !== undefined) {
      return parseTokenAmount(this.defaultDailyLimit, this.sdk.tokenDecimals);
    }
    if (this.sdk.safeSpendLimitWei !== null) {
      return this.sdk.safeSpendLimitWei;
    }

    return null;
  }
}

function normalizeProviderOptions(provider, options) {
  if (options.provider || options.signer || options.rpcUrl) {
    return {
      provider: options.provider,
      signer: options.signer
    };
  }

  if (provider && typeof provider.getAddress === "function") {
    return { signer: provider };
  }

  return {
    provider,
    signer: provider
  };
}
