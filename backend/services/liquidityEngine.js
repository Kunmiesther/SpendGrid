const { ethers } = require("ethers");

const ZERO_ADDRESS = ethers.ZeroAddress.toLowerCase();

const ERC20_ABI = [
  "function approve(address spender,uint256 amount) external returns (bool)",
  "function allowance(address owner,address spender) external view returns (uint256)"
];

const FACTORY_ABI = [
  "function getPair(address tokenA,address tokenB) external view returns (address pair)"
];

const ROUTER_ABI = [
  "function swapExactTokensForTokens(uint256 amountIn,uint256 amountOutMin,address[] calldata path,address to,uint256 deadline) external returns (uint256[] memory amounts)"
];

function normalizeAddress(label, value) {
  if (!value || !ethers.isAddress(value) || value.toLowerCase() === ZERO_ADDRESS) {
    throw new Error(`${label} is required`);
  }

  return ethers.getAddress(value);
}

function normalizeAddressSafe(label, value) {
  try {
    return normalizeAddress(label, value);
  } catch (error) {
    logFailure("qiedex_address_validation_failed", error, { label, value });
    return null;
  }
}

function isContract(value) {
  return value && typeof value === "object" && typeof value.getAddress === "function";
}

function errorReason(error) {
  return error?.shortMessage || error?.reason || error?.message || String(error);
}

function logFailure(eventType, error, fields = {}) {
  const record = {
    eventType,
    status: "failed",
    reason: errorReason(error),
    ...fields
  };

  console.warn(JSON.stringify(record));
  return record;
}

async function contractAddress(contract) {
  if (!contract) {
    throw new Error("contract is required");
  }
  if (typeof contract.getAddress === "function") {
    return contract.getAddress();
  }
  if (contract.target) {
    return contract.target;
  }
  if (contract.address) {
    return contract.address;
  }

  throw new Error("contract address is unavailable");
}

function safeReceipt(receipt) {
  if (!receipt) {
    return null;
  }

  return {
    hash: receipt.hash || receipt.transactionHash || null,
    status: receipt.status ?? null,
    blockNumber: receipt.blockNumber ?? null,
    gasUsed: receipt.gasUsed?.toString?.() || null
  };
}

function makeSwapLog(fields) {
  return {
    eventType: "qiedex_swap",
    inputToken: fields.inputToken,
    outputToken: fields.outputToken,
    amountIn: fields.amountIn?.toString?.() || String(fields.amountIn || "0"),
    txHash: fields.txHash || null,
    status: fields.status,
    reason: fields.reason || null,
    pair: fields.pair || null,
    recipient: fields.recipient || null
  };
}

async function getPair(factory, tokenA, tokenB) {
  const normalizedTokenA = normalizeAddressSafe("tokenA", tokenA);
  const normalizedTokenB = normalizeAddressSafe("tokenB", tokenB);
  if (!factory || !normalizedTokenA || !normalizedTokenB) {
    return null;
  }

  try {
    const pair = await factory.getPair(normalizedTokenA, normalizedTokenB);
    if (!pair || pair.toLowerCase() === ZERO_ADDRESS) {
      return null;
    }

    return ethers.getAddress(pair);
  } catch (error) {
    logFailure("qiedex_get_pair_failed", error, {
      tokenA: normalizedTokenA,
      tokenB: normalizedTokenB
    });
    return null;
  }
}

async function hasLiquidity(factory, tokenA, tokenB) {
  const pair = await getPair(factory, tokenA, tokenB);
  if (!pair) {
    return false;
  }

  const provider = factory?.runner?.provider || factory?.provider;
  if (!provider || typeof provider.getCode !== "function") {
    return true;
  }

  try {
    const code = await provider.getCode(pair);
    return Boolean(code && code !== "0x");
  } catch (error) {
    logFailure("qiedex_pair_validation_failed", error, { pair, tokenA, tokenB });
    return false;
  }
}

async function approveToken(token, spender, amount) {
  const signer = token.runner;
  const owner = await signer.getAddress();
  const required = BigInt(amount);
  const allowance = BigInt(await token.allowance(owner, spender));

  if (allowance >= required) {
    return {
      approved: false,
      allowance: allowance.toString(),
      txHash: null
    };
  }

  const tx = await token.approve(spender, required);
  const receipt = await tx.wait();

  return {
    approved: true,
    allowance: required.toString(),
    txHash: tx.hash,
    status: receipt.status === 1 ? "confirmed" : "failed"
  };
}

function normalizeSwapArgs(routerOrOptions, signer, amountIn, amountOutMin, path) {
  if (routerOrOptions && typeof routerOrOptions === "object" && routerOrOptions.router) {
    return {
      ...routerOrOptions,
      inputTokenContract: routerOrOptions.inputTokenContract || (
        isContract(routerOrOptions.inputToken) ? routerOrOptions.inputToken : null
      ),
      signer: routerOrOptions.signer || routerOrOptions.inputToken?.runner || routerOrOptions.router?.runner
    };
  }

  return { router: routerOrOptions, signer, amountIn, amountOutMin, path };
}

async function swapTokens(routerOrOptions, signer, amountIn, amountOutMin, path) {
  const options = normalizeSwapArgs(routerOrOptions, signer, amountIn, amountOutMin, path);

  try {
    const { router } = options;
    if (!router) {
      throw new Error("router is required");
    }
    if (!Array.isArray(options.path) || options.path.length < 2) {
      throw new Error("swap path must contain at least two tokens");
    }

    const normalizedPath = options.path.map((token, index) => normalizeAddress(`path[${index}]`, token));
    const amount = BigInt(options.amountIn);
    const minOut = BigInt(options.amountOutMin || 0);
    const swapSigner = options.signer || router.runner;
    if (!swapSigner || typeof swapSigner.getAddress !== "function") {
      throw new Error("signer is required for QIEDEX swap execution");
    }
    if (amount <= 0n) {
      throw new Error("amountIn must be greater than zero");
    }

    const to = normalizeAddress("recipient", options.recipient || await swapSigner.getAddress());
    const routerAddress = normalizeAddress("router", await contractAddress(router));
    const inputToken = options.inputTokenContract
      ? options.inputTokenContract.connect?.(swapSigner) || options.inputTokenContract
      : new ethers.Contract(normalizedPath[0], ERC20_ABI, swapSigner);
    const routerWithSigner = router.connect?.(swapSigner) || router;

    const approval = await approveToken(inputToken, routerAddress, amount);
    if (approval.approved && approval.status !== "confirmed") {
      throw new Error("router approval failed");
    }

    const deadline = Math.floor(Date.now() / 1000) + 300;
    const tx = await routerWithSigner.swapExactTokensForTokens(amount, minOut, normalizedPath, to, deadline);
    const receipt = await tx.wait();
    const status = receipt.status === 1 ? "confirmed" : "failed";

    return {
      ok: status === "confirmed",
      txHash: tx.hash,
      receipt: safeReceipt(receipt),
      status,
      gasUsed: receipt.gasUsed?.toString?.() || null,
      blockNumber: receipt.blockNumber,
      deadline,
      path: normalizedPath
    };
  } catch (error) {
    logFailure("qiedex_swap_failed", error, {
      amountIn: options.amountIn?.toString?.() || String(options.amountIn || "0"),
      amountOutMin: options.amountOutMin?.toString?.() || String(options.amountOutMin || "0"),
      path: Array.isArray(options.path) ? options.path : null
    });

    return {
      ok: false,
      txHash: null,
      receipt: null,
      status: "failed",
      reason: errorReason(error),
      path: Array.isArray(options.path) ? options.path : null
    };
  }
}

class LiquidityEngine {
  constructor(options = {}) {
    this.factory = options.factory;
    this.router = options.router;
    this.wqie = normalizeAddress("WQIE", options.wqie);
    this.qusdc = normalizeAddress("QUSDC", options.qusdc);
    this.ledger = options.ledger || null;

    if (!this.factory) throw new Error("LiquidityEngine requires factory");
    if (!this.router) throw new Error("LiquidityEngine requires router");
  }

  async checkPairExists(tokenA = this.wqie, tokenB = this.qusdc) {
    return getPair(this.factory, tokenA, tokenB);
  }

  async hasLiquidity(tokenA = this.wqie, tokenB = this.qusdc) {
    return hasLiquidity(this.factory, tokenA, tokenB);
  }

  async ensureQusdcBalance({ tokenIn, tokenOut, inputTokenContract, owner, requiredAmount, amountIn }) {
    try {
      const inputToken = normalizeAddress("inputToken", tokenIn);
      const outputToken = normalizeAddress("outputToken", tokenOut);
      const pair = await this.checkPairExists(inputToken, outputToken);

      if (!pair) {
        const log = makeSwapLog({
          inputToken,
          outputToken,
          amountIn,
          status: "skipped",
          reason: "NO_LIQUIDITY_SKIP_SWAP",
          recipient: owner
        });
        this.ledger?.append?.(log);
        return { swapped: false, reason: "NO_LIQUIDITY_SKIP_SWAP", pair: null, log };
      }

      const result = await swapTokens({
        router: this.router,
        inputTokenContract,
        amountIn,
        amountOutMin: 0n,
        path: [inputToken, outputToken],
        recipient: owner
      });
      const swapped = result.status === "confirmed";
      const log = makeSwapLog({
        inputToken,
        outputToken,
        amountIn,
        txHash: result.txHash,
        status: result.status,
        reason: swapped ? "SWAP_SUCCESS" : result.reason || "SWAP_FAILED",
        pair,
        recipient: owner
      });
      this.ledger?.append?.({ ...log, requiredAmount: requiredAmount?.toString?.() || null });
      return { swapped, reason: swapped ? "SWAP_SUCCESS" : log.reason, pair, result, log };
    } catch (error) {
      const log = makeSwapLog({
        inputToken: tokenIn,
        outputToken: tokenOut,
        amountIn,
        status: "failed",
        reason: errorReason(error),
        recipient: owner
      });
      logFailure("qiedex_ensure_balance_failed", error, log);
      this.ledger?.append?.({ ...log, requiredAmount: requiredAmount?.toString?.() || null });
      return { swapped: false, reason: log.reason, pair: null, log };
    }
  }
}

module.exports = {
  ERC20_ABI,
  FACTORY_ABI,
  ROUTER_ABI,
  LiquidityEngine,
  approveToken,
  getPair,
  hasLiquidity,
  swapTokens
};
