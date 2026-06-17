const { ethers } = require("ethers");

const DEFAULT_CONFIRMATIONS = 1;

function bigintJson(value) {
  return JSON.parse(
    JSON.stringify(value, (_key, innerValue) => (typeof innerValue === "bigint" ? innerValue.toString() : innerValue))
  );
}

function normalizeAddress(value, label = "address") {
  if (!value || !ethers.isAddress(value)) {
    throw new Error(`${label} must be a valid address`);
  }

  return ethers.getAddress(value);
}

function sameAddress(left, right) {
  try {
    return ethers.getAddress(left) === ethers.getAddress(right);
  } catch (_error) {
    return false;
  }
}

function contractAddress(contract, fallback) {
  const candidate = fallback || contract?.target || contract?.address;
  return candidate ? normalizeAddress(candidate, "token") : null;
}

function parsePositiveUint(value, label) {
  const parsed = BigInt(value);
  if (parsed <= 0n) {
    throw new Error(`${label} must be greater than zero`);
  }
  return parsed;
}

function resolveApprovalPolicy(options = {}) {
  const configuredAmount = options.approvalAmountWei || process.env.QUSDC_APPROVAL_AMOUNT_WEI;
  const rawPolicy = options.approvalPolicy || process.env.QUSDC_APPROVAL_POLICY || (configuredAmount ? "configured" : "max");
  const policy = String(rawPolicy || "max").trim().toLowerCase();

  if (["max", "max_uint256", "maxuint256", "unlimited", "infinite"].includes(policy)) {
    return {
      policy: "max",
      approvalAmount: ethers.MaxUint256,
      configuredAmount: configuredAmount ? parsePositiveUint(configuredAmount, "QUSDC_APPROVAL_AMOUNT_WEI") : null
    };
  }

  if (["exact", "required", "request"].includes(policy)) {
    return {
      policy: "exact",
      approvalAmount: null,
      configuredAmount: null
    };
  }

  if (["configured", "fixed", "amount"].includes(policy)) {
    if (!configuredAmount) {
      throw new Error("QUSDC_APPROVAL_AMOUNT_WEI is required when QUSDC_APPROVAL_POLICY=configured");
    }
    return {
      policy: "configured",
      approvalAmount: parsePositiveUint(configuredAmount, "QUSDC_APPROVAL_AMOUNT_WEI"),
      configuredAmount: parsePositiveUint(configuredAmount, "QUSDC_APPROVAL_AMOUNT_WEI")
    };
  }

  throw new Error(`Unsupported QUSDC_APPROVAL_POLICY "${rawPolicy}"`);
}

function makeApprovalError(message, diagnostics, cause) {
  const error = new Error(message);
  error.code = "APPROVAL_FAILED";
  error.statusCode = 502;
  error.details = bigintJson({
    status: "failed",
    reason: "APPROVAL_FAILED",
    message,
    diagnostics,
    cause: cause
      ? {
          code: cause.code || null,
          reason: cause.reason || null,
          shortMessage: cause.shortMessage || null,
          message: cause.message || String(cause)
        }
      : null
  });
  return error;
}

class AllowanceManager {
  constructor(options = {}) {
    this.cache = options.cache || new Map();
    this.inFlight = new Map();
    this.confirmations = Number(
      options.confirmations || process.env.QUSDC_APPROVAL_CONFIRMATIONS || DEFAULT_CONFIRMATIONS
    );
    this.approvalPolicy = options.approvalPolicy;
    this.approvalAmountWei = options.approvalAmountWei;
  }

  async ensureAllowance(options = {}) {
    const token = options.token;
    const signer = options.signer || token?.runner;
    const ledger = options.ledger || null;
    const requiredAmount = parsePositiveUint(options.amount, "allowance amount");
    const spender = normalizeAddress(options.spender, "spender");
    const owner = normalizeAddress(options.owner, "owner");
    const signerAddress = signer && typeof signer.getAddress === "function"
      ? normalizeAddress(await signer.getAddress(), "signer")
      : null;
    const tokenAddress = contractAddress(token, options.tokenAddress);
    const chainId = String(options.chainId || "");
    const cacheKey = [chainId, tokenAddress || "unknown-token", owner, spender].join(":").toLowerCase();
    const cached = this.cache.get(cacheKey) || null;
    const beforeAllowance = BigInt(await token.allowance(owner, spender));

    ledger?.append?.({
      eventType: "erc20_allowance_check",
      status: beforeAllowance >= requiredAmount ? "sufficient" : "insufficient",
      token: tokenAddress,
      owner,
      spender,
      signer: signerAddress,
      requiredAmount,
      allowance: beforeAllowance,
      cacheHit: Boolean(cached && BigInt(cached.allowance || 0) >= requiredAmount),
      ...bigintJson(options.metadata || {})
    });

    if (beforeAllowance >= requiredAmount) {
      const result = {
        approved: false,
        status: "sufficient",
        token: tokenAddress,
        owner,
        spender,
        signer: signerAddress,
        requiredAmount: requiredAmount.toString(),
        beforeAllowance: beforeAllowance.toString(),
        afterAllowance: beforeAllowance.toString(),
        txHash: null,
        cacheKey,
        cacheHit: Boolean(cached)
      };
      this.cache.set(cacheKey, {
        allowance: beforeAllowance.toString(),
        owner,
        spender,
        token: tokenAddress,
        updatedAt: new Date().toISOString(),
        txHash: cached?.txHash || null
      });
      return result;
    }

    if (!signerAddress || !sameAddress(owner, signerAddress)) {
      throw makeApprovalError("Cannot approve StreamVault from a wallet that is not controlled by the backend signer", {
        token: tokenAddress,
        owner,
        signer: signerAddress,
        spender,
        requiredAmount: requiredAmount.toString(),
        beforeAllowance: beforeAllowance.toString(),
        signerControlled: false
      });
    }

    const pending = this.inFlight.get(cacheKey);
    if (pending) {
      await pending;
      const afterPendingAllowance = BigInt(await token.allowance(owner, spender));
      if (afterPendingAllowance >= requiredAmount) {
        this.cache.set(cacheKey, {
          allowance: afterPendingAllowance.toString(),
          owner,
          spender,
          token: tokenAddress,
          updatedAt: new Date().toISOString(),
          txHash: this.cache.get(cacheKey)?.txHash || null
        });
        return {
          approved: false,
          status: "sufficient_after_pending_approval",
          token: tokenAddress,
          owner,
          spender,
          signer: signerAddress,
          requiredAmount: requiredAmount.toString(),
          beforeAllowance: beforeAllowance.toString(),
          afterAllowance: afterPendingAllowance.toString(),
          txHash: this.cache.get(cacheKey)?.txHash || null,
          cacheKey,
          cacheHit: true
        };
      }
    }

    const approval = this._approve({
      token,
      signer,
      ledger,
      owner,
      spender,
      signerAddress,
      tokenAddress,
      requiredAmount,
      beforeAllowance,
      cacheKey,
      metadata: options.metadata || {}
    });
    this.inFlight.set(cacheKey, approval);

    try {
      return await approval;
    } finally {
      this.inFlight.delete(cacheKey);
    }
  }

  async _approve(input) {
    const {
      token,
      signer,
      ledger,
      owner,
      spender,
      signerAddress,
      tokenAddress,
      requiredAmount,
      beforeAllowance,
      cacheKey,
      metadata
    } = input;

    let policy;
    let approvalAmount;
    try {
      policy = resolveApprovalPolicy({
        approvalPolicy: this.approvalPolicy,
        approvalAmountWei: this.approvalAmountWei
      });
      approvalAmount = policy.policy === "exact" ? requiredAmount : BigInt(policy.approvalAmount);
      if (approvalAmount < requiredAmount) {
        throw new Error(
          `Configured approval amount ${approvalAmount.toString()} is below required amount ${requiredAmount.toString()}`
        );
      }
    } catch (error) {
      throw makeApprovalError("QUSDC approval policy configuration is invalid", {
        token: tokenAddress,
        owner,
        signer: signerAddress,
        spender,
        requiredAmount: requiredAmount.toString(),
        beforeAllowance: beforeAllowance.toString()
      }, error);
    }

    const tokenWithSigner = token.connect ? token.connect(signer) : token;
    let tx = null;
    let receipt = null;

    try {
      tx = await tokenWithSigner.approve(spender, approvalAmount);
      ledger?.append?.({
        eventType: "erc20_approval",
        status: "submitted",
        token: tokenAddress,
        owner,
        spender,
        signer: signerAddress,
        requiredAmount,
        beforeAllowance,
        approvalAmount,
        approvalPolicy: policy.policy,
        txHash: tx.hash,
        ...bigintJson(metadata)
      });

      receipt = await tx.wait(this.confirmations);
      if (!receipt || receipt.status !== 1) {
        throw new Error(`approval transaction ${tx.hash} was not confirmed successfully`);
      }

      const afterAllowance = BigInt(await token.allowance(owner, spender));
      if (afterAllowance < requiredAmount) {
        throw new Error(
          `allowance remained below required amount after approval: ${afterAllowance.toString()} < ${requiredAmount.toString()}`
        );
      }

      const result = {
        approved: true,
        status: "confirmed",
        token: tokenAddress,
        owner,
        spender,
        signer: signerAddress,
        requiredAmount: requiredAmount.toString(),
        beforeAllowance: beforeAllowance.toString(),
        afterAllowance: afterAllowance.toString(),
        approvalAmount: approvalAmount.toString(),
        approvalPolicy: policy.policy,
        txHash: tx.hash,
        gasUsed: receipt.gasUsed?.toString?.() || null,
        blockNumber: receipt.blockNumber,
        cacheKey,
        cacheHit: false
      };

      this.cache.set(cacheKey, {
        allowance: afterAllowance.toString(),
        owner,
        spender,
        token: tokenAddress,
        updatedAt: new Date().toISOString(),
        txHash: tx.hash
      });

      ledger?.append?.({
        eventType: "erc20_approval",
        status: "confirmed",
        token: tokenAddress,
        owner,
        spender,
        signer: signerAddress,
        requiredAmount,
        beforeAllowance,
        afterAllowance,
        approvalAmount,
        approvalPolicy: policy.policy,
        txHash: tx.hash,
        gasUsed: receipt.gasUsed,
        blockNumber: receipt.blockNumber,
        ...bigintJson(metadata)
      });

      return result;
    } catch (error) {
      const diagnostics = {
        token: tokenAddress,
        owner,
        signer: signerAddress,
        spender,
        requiredAmount: requiredAmount.toString(),
        beforeAllowance: beforeAllowance.toString(),
        approvalAmount: approvalAmount?.toString?.() || null,
        approvalPolicy: policy?.policy || null,
        txHash: tx?.hash || null,
        receiptStatus: receipt?.status ?? null,
        blockNumber: receipt?.blockNumber || null,
        signerControlled: sameAddress(owner, signerAddress),
        cacheKey
      };

      ledger?.append?.({
        eventType: "erc20_approval",
        status: "failed",
        ...diagnostics,
        error: error.shortMessage || error.reason || error.message || String(error),
        ...bigintJson(metadata)
      });

      throw makeApprovalError("QUSDC approval failed before StreamVault execution", diagnostics, error);
    }
  }
}

module.exports = {
  AllowanceManager,
  makeApprovalError,
  resolveApprovalPolicy
};
