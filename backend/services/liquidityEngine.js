const { ethers } = require("ethers");
const { MOCK_QUSDC_BYPASS_REASON, getMockQusdcAddress, isMockQusdcMode } = require("../src/qusdcMode");

const ZERO_ADDRESS = ethers.ZeroAddress.toLowerCase();
const MOCK_QUSDC_FAKE_BALANCE = ethers.MaxUint256.toString();

const ERC20_ABI = [
  "function approve(address spender,uint256 amount) external returns (bool)",
  "function allowance(address owner,address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)"
];

const WQIE_ABI = [
  ...ERC20_ABI,
  "function deposit() external payable",
  "function withdraw(uint256 amount) external"
];

const FACTORY_ABI = [
  "function getPair(address tokenA,address tokenB) external view returns (address pair)"
];

const PAIR_ABI = [
  "function getReserves() external view returns (uint112 reserve0,uint112 reserve1,uint32 blockTimestampLast)",
  "function token0() external view returns (address)",
  "function token1() external view returns (address)"
];

const ROUTER_ABI = [
  "function swapExactTokensForTokens(uint256 amountIn,uint256 amountOutMin,address[] calldata path,address to,uint256 deadline) external returns (uint256[] memory amounts)"
];

const REASONS = {
  FACTORY_MISSING: "QIEDEX_FACTORY_MISSING",
  ROUTER_MISSING: "QIEDEX_ROUTER_MISSING",
  TOKEN_MISSING: "QIEDEX_TOKEN_MISSING",
  PAIR_MISSING: "QIEDEX_PAIR_MISSING",
  PAIR_CONTRACT_MISSING: "QIEDEX_PAIR_MISSING",
  PAIR_EMPTY: "QIEDEX_NO_LIQUIDITY",
  GET_PAIR_FAILED: "QIEDEX_GET_PAIR_CALL_FAILED",
  CODE_CHECK_FAILED: "QIEDEX_CONTRACT_CODE_CHECK_FAILED",
  RESERVE_CHECK_FAILED: "QIEDEX_PAIR_RESERVE_CHECK_FAILED"
};
REASONS.INPUT_BALANCE_LOW = "QIEDEX_INPUT_TOKEN_BALANCE_LOW";
REASONS.WRAP_NATIVE_FAILED = "QIEDEX_WRAP_NATIVE_FAILED";
REASONS.NATIVE_BALANCE_LOW = "QIEDEX_NATIVE_BALANCE_LOW";
REASONS.QUOTE_FAILED = "QIEDEX_QUOTE_FAILED";

function normalizeAddress(label, value) {
  if (!value || !ethers.isAddress(value) || value.toLowerCase() === ZERO_ADDRESS) {
    throw new Error(`${label} is required`);
  }

  return ethers.getAddress(value);
}

function normalizeOptionalAddress(value) {
  if (!value || !ethers.isAddress(value)) {
    return ethers.ZeroAddress;
  }

  return ethers.getAddress(value);
}

function mockLiquidityResult() {
  return {
    hasLiquidity: true,
    pair: null,
    reason: MOCK_QUSDC_BYPASS_REASON,
    bypassed: true
  };
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

function logDiagnostic(eventType, fields = {}) {
  const record = {
    eventType,
    ...fields
  };

  console.warn(JSON.stringify(record));
  return record;
}

function providerFromContract(contract) {
  return contract?.runner?.provider || contract?.provider || null;
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

async function verifyContractCode(provider, label, address, reason, fields = {}) {
  if (!provider || typeof provider.getCode !== "function") {
    return { ok: true, checked: false, reason: null };
  }

  try {
    const code = await provider.getCode(address);
    if (code && code !== "0x") {
      return { ok: true, checked: true, reason: null };
    }

    const diagnostic = logDiagnostic("qiedex_contract_missing", {
      status: "failed",
      reason,
      label,
      address,
      ...fields
    });
    return { ok: false, checked: true, reason, diagnostic };
  } catch (error) {
    const diagnostic = logFailure("qiedex_contract_code_check_failed", error, {
      reason: REASONS.CODE_CHECK_FAILED,
      label,
      address,
      ...fields
    });
    return { ok: false, checked: true, reason: REASONS.CODE_CHECK_FAILED, diagnostic };
  }
}

async function assertContractCode(provider, label, address, reason, fields = {}) {
  const result = await verifyContractCode(provider, label, address, reason, fields);
  if (!result.ok) {
    const error = new Error(`${label} is not deployed at ${address}: ${result.reason}`);
    error.code = result.reason;
    error.details = result;
    throw error;
  }

  return result;
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

async function ensureInputBalance({ tokenAddress, tokenContract, owner, requiredAmount, wqie }) {
  const signer = tokenContract?.runner;
  const token = tokenContract || new ethers.Contract(tokenAddress, ERC20_ABI, signer);
  const currentBalance = BigInt(await token.balanceOf(owner));
  const required = BigInt(requiredAmount);

  if (currentBalance >= required) {
    return { ok: true, balance: currentBalance.toString(), wrapped: false };
  }

  if (!wqie || normalizeAddress("tokenAddress", tokenAddress) !== normalizeAddress("WQIE", wqie)) {
    return {
      ok: false,
      reason: REASONS.INPUT_BALANCE_LOW,
      balance: currentBalance.toString(),
      requiredAmount: required.toString()
    };
  }
  if (!signer || typeof signer.getAddress !== "function") {
    return {
      ok: false,
      reason: REASONS.INPUT_BALANCE_LOW,
      balance: currentBalance.toString(),
      requiredAmount: required.toString()
    };
  }

  const missing = required - currentBalance;
  const provider = signer.provider || token.runner?.provider;
  const nativeBalance = provider && typeof provider.getBalance === "function"
    ? BigInt(await provider.getBalance(owner))
    : 0n;
  if (nativeBalance <= missing) {
    return {
      ok: false,
      reason: REASONS.NATIVE_BALANCE_LOW,
      balance: currentBalance.toString(),
      nativeBalance: nativeBalance.toString(),
      requiredAmount: required.toString(),
      missing: missing.toString()
    };
  }

  try {
    const wrapper = new ethers.Contract(tokenAddress, WQIE_ABI, signer);
    const tx = await wrapper.deposit({ value: missing });
    const receipt = await tx.wait();
    if (receipt.status !== 1) {
      return {
        ok: false,
        reason: REASONS.WRAP_NATIVE_FAILED,
        txHash: tx.hash,
        requiredAmount: required.toString()
      };
    }

    return {
      ok: true,
      balance: required.toString(),
      wrapped: true,
      wrappedAmount: missing.toString(),
      txHash: tx.hash
    };
  } catch (error) {
    return {
      ok: false,
      reason: REASONS.WRAP_NATIVE_FAILED,
      error: errorReason(error),
      requiredAmount: required.toString()
    };
  }
}

async function quoteInputForOutput(pairAddress, provider, tokenIn, tokenOut, requiredOutput, slippageBps = 100n) {
  try {
    const pair = new ethers.Contract(pairAddress, PAIR_ABI, provider);
    const [reserves, token0] = await Promise.all([
      pair.getReserves(),
      pair.token0()
    ]);
    const reserve0 = BigInt(reserves.reserve0 ?? reserves[0]);
    const reserve1 = BigInt(reserves.reserve1 ?? reserves[1]);
    const inputIsToken0 = normalizeAddress("tokenIn", tokenIn) === normalizeAddress("token0", token0);
    const reserveIn = inputIsToken0 ? reserve0 : reserve1;
    const reserveOut = inputIsToken0 ? reserve1 : reserve0;
    const amountOut = BigInt(requiredOutput);

    if (reserveIn <= 0n || reserveOut <= 0n || amountOut >= reserveOut) {
      return { ok: false, reason: REASONS.PAIR_EMPTY };
    }

    const baseInput = ((reserveIn * amountOut * 1000n) / ((reserveOut - amountOut) * 997n)) + 1n;
    const inputWithSlippage = (baseInput * (10_000n + BigInt(slippageBps))) / 10_000n + 1n;
    return {
      ok: true,
      amountIn: inputWithSlippage,
      baseInput,
      reserveIn,
      reserveOut,
      slippageBps: BigInt(slippageBps)
    };
  } catch (error) {
    return { ok: false, reason: REASONS.QUOTE_FAILED, error: errorReason(error) };
  }
}

async function getPair(factory, tokenA, tokenB) {
  const result = await inspectPair(factory, tokenA, tokenB);
  return result.pair;
}

async function inspectPair(factory, tokenA, tokenB) {
  if (isMockQusdcMode()) {
    return { pair: null, reason: MOCK_QUSDC_BYPASS_REASON, bypassed: true };
  }

  const normalizedTokenA = normalizeAddressSafe("tokenA", tokenA);
  const normalizedTokenB = normalizeAddressSafe("tokenB", tokenB);
  if (!factory || !normalizedTokenA || !normalizedTokenB) {
    return { pair: null, reason: "QIEDEX_INVALID_PAIR_INPUT" };
  }

  const provider = providerFromContract(factory);
  const factoryAddress = normalizeAddressSafe("QIEDEX Factory", await contractAddress(factory));
  if (!factoryAddress) {
    return { pair: null, reason: "QIEDEX_FACTORY_ADDRESS_INVALID" };
  }

  const factoryCode = await verifyContractCode(provider, "QIEDEX Factory", factoryAddress, REASONS.FACTORY_MISSING, {
    tokenA: normalizedTokenA,
    tokenB: normalizedTokenB
  });
  if (!factoryCode.ok) {
    return { pair: null, reason: factoryCode.reason, diagnostic: factoryCode.diagnostic };
  }

  const tokenACode = await verifyContractCode(provider, "input token", normalizedTokenA, REASONS.TOKEN_MISSING, {
    tokenRole: "tokenA",
    tokenA: normalizedTokenA,
    tokenB: normalizedTokenB
  });
  if (!tokenACode.ok) {
    return { pair: null, reason: tokenACode.reason, diagnostic: tokenACode.diagnostic };
  }

  const tokenBCode = await verifyContractCode(provider, "output token", normalizedTokenB, REASONS.TOKEN_MISSING, {
    tokenRole: "tokenB",
    tokenA: normalizedTokenA,
    tokenB: normalizedTokenB
  });
  if (!tokenBCode.ok) {
    return { pair: null, reason: tokenBCode.reason, diagnostic: tokenBCode.diagnostic };
  }

  try {
    const pair = await factory.getPair(normalizedTokenA, normalizedTokenB);
    if (!pair || pair.toLowerCase() === ZERO_ADDRESS) {
      const diagnostic = logDiagnostic("qiedex_pair_missing", {
        status: "failed",
        reason: REASONS.PAIR_MISSING,
        factory: factoryAddress,
        tokenA: normalizedTokenA,
        tokenB: normalizedTokenB
      });
      return { pair: null, reason: REASONS.PAIR_MISSING, diagnostic };
    }

    return { pair: ethers.getAddress(pair), reason: null, factory: factoryAddress };
  } catch (error) {
    const diagnostic = logFailure("qiedex_get_pair_failed", error, {
      reason: REASONS.GET_PAIR_FAILED,
      factory: factoryAddress,
      tokenA: normalizedTokenA,
      tokenB: normalizedTokenB
    });
    return { pair: null, reason: REASONS.GET_PAIR_FAILED, diagnostic };
  }
}

async function hasLiquidity(factory, tokenA, tokenB) {
  if (isMockQusdcMode()) {
    return true;
  }

  const result = await inspectLiquidity(factory, tokenA, tokenB);
  return result.hasLiquidity;
}

async function inspectLiquidity(factory, tokenA, tokenB) {
  if (isMockQusdcMode()) {
    return mockLiquidityResult();
  }

  const pairResult = await inspectPair(factory, tokenA, tokenB);
  if (!pairResult.pair) {
    return { hasLiquidity: false, pair: null, reason: pairResult.reason, diagnostic: pairResult.diagnostic };
  }

  const pair = pairResult.pair;
  const provider = factory?.runner?.provider || factory?.provider;
  if (!provider || typeof provider.getCode !== "function") {
    return { hasLiquidity: true, pair, reason: null };
  }

  try {
    const code = await provider.getCode(pair);
    if (!code || code === "0x") {
      const diagnostic = logDiagnostic("qiedex_pair_contract_missing", {
        status: "failed",
        reason: REASONS.PAIR_CONTRACT_MISSING,
        pair,
        tokenA,
        tokenB
      });
      return { hasLiquidity: false, pair, reason: REASONS.PAIR_CONTRACT_MISSING, diagnostic };
    }
  } catch (error) {
    const diagnostic = logFailure("qiedex_pair_validation_failed", error, {
      reason: REASONS.CODE_CHECK_FAILED,
      pair,
      tokenA,
      tokenB
    });
    return { hasLiquidity: false, pair, reason: REASONS.CODE_CHECK_FAILED, diagnostic };
  }

  try {
    const pairContract = new ethers.Contract(pair, PAIR_ABI, provider);
    const reserves = await pairContract.getReserves();
    const reserve0 = BigInt(reserves.reserve0 ?? reserves[0]);
    const reserve1 = BigInt(reserves.reserve1 ?? reserves[1]);
    if (reserve0 === 0n || reserve1 === 0n) {
      const diagnostic = logDiagnostic("qiedex_pair_no_reserves", {
        status: "failed",
        reason: REASONS.PAIR_EMPTY,
        pair,
        tokenA,
        tokenB,
        reserve0: reserve0.toString(),
        reserve1: reserve1.toString()
      });
      return { hasLiquidity: false, pair, reason: REASONS.PAIR_EMPTY, diagnostic };
    }

    return {
      hasLiquidity: true,
      pair,
      reason: null,
      reserves: {
        reserve0: reserve0.toString(),
        reserve1: reserve1.toString()
      }
    };
  } catch (error) {
    const diagnostic = logFailure("qiedex_pair_reserve_check_failed", error, {
      reason: REASONS.RESERVE_CHECK_FAILED,
      pair,
      tokenA,
      tokenB
    });
    return { hasLiquidity: false, pair, reason: REASONS.RESERVE_CHECK_FAILED, diagnostic };
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

  if (isMockQusdcMode()) {
    return {
      ok: true,
      txHash: null,
      receipt: null,
      status: "mock-bypassed",
      reason: MOCK_QUSDC_BYPASS_REASON,
      balance: MOCK_QUSDC_FAKE_BALANCE,
      path: Array.isArray(options.path) ? options.path : null,
      mocked: true
    };
  }

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
    this.mockMode = isMockQusdcMode();
    this.factory = options.factory;
    this.router = options.router;
    this.wqie = this.mockMode ? normalizeOptionalAddress(options.wqie) : normalizeAddress("WQIE", options.wqie);
    this.qusdc = this.mockMode
      ? normalizeOptionalAddress(options.qusdc || getMockQusdcAddress())
      : normalizeAddress("QUSDC", options.qusdc);
    this.ledger = options.ledger || null;
    this.lastLiquidityDiagnostic = null;

    if (!this.mockMode && !this.factory) throw new Error("LiquidityEngine requires factory");
    if (!this.mockMode && !this.router) throw new Error("LiquidityEngine requires router");
  }

  async checkPairExists(tokenA = this.wqie, tokenB = this.qusdc) {
    if (this.mockMode) {
      this.lastLiquidityDiagnostic = { reason: MOCK_QUSDC_BYPASS_REASON, bypassed: true };
      return null;
    }

    const result = await inspectPair(this.factory, tokenA, tokenB);
    this.lastLiquidityDiagnostic = result.reason ? result : null;
    return result.pair;
  }

  async hasLiquidity(tokenA = this.wqie, tokenB = this.qusdc) {
    if (this.mockMode) {
      this.lastLiquidityDiagnostic = { reason: MOCK_QUSDC_BYPASS_REASON, bypassed: true };
      return true;
    }

    const result = await inspectLiquidity(this.factory, tokenA, tokenB);
    this.lastLiquidityDiagnostic = result.reason ? result : null;
    return result.hasLiquidity;
  }

  async inspectLiquidity(tokenA = this.wqie, tokenB = this.qusdc) {
    if (this.mockMode) {
      const result = mockLiquidityResult();
      this.lastLiquidityDiagnostic = result;
      return result;
    }

    const result = await inspectLiquidity(this.factory, tokenA, tokenB);
    this.lastLiquidityDiagnostic = result.reason ? result : null;
    return result;
  }

  getLastDiagnostic() {
    return this.lastLiquidityDiagnostic;
  }

  async ensureQusdcBalance({ tokenIn, tokenOut, inputTokenContract, owner, requiredAmount, amountIn }) {
    if (isMockQusdcMode()) {
      return {
        sufficient: true,
        balance: MOCK_QUSDC_FAKE_BALANCE,
        swap: null,
        reason: MOCK_QUSDC_BYPASS_REASON,
        mocked: true,
        note: "mock mode bypass"
      };
    }

    try {
      const inputToken = normalizeAddress("inputToken", tokenIn);
    const outputToken = normalizeAddress("outputToken", tokenOut);
    const routerAddress = normalizeAddress("router", await contractAddress(this.router));
      const routerCode = await verifyContractCode(
        providerFromContract(this.router),
        "QIEDEX Router",
        routerAddress,
        REASONS.ROUTER_MISSING,
        { inputToken, outputToken }
      );
      if (!routerCode.ok) {
        this.lastLiquidityDiagnostic = routerCode;
        const log = makeSwapLog({
          inputToken,
          outputToken,
          amountIn,
          status: "skipped",
          reason: routerCode.reason,
          recipient: owner
        });
        this.ledger?.append?.({ ...log, requiredAmount: requiredAmount?.toString?.() || null });
        return { swapped: false, reason: routerCode.reason, pair: null, log };
      }

      const factoryAddress = normalizeAddress("factory", await contractAddress(this.factory));
      const factoryCode = await verifyContractCode(
        providerFromContract(this.factory),
        "QIEDEX Factory",
        factoryAddress,
        REASONS.FACTORY_MISSING,
        { inputToken, outputToken }
      );
      if (!factoryCode.ok) {
        this.lastLiquidityDiagnostic = factoryCode;
        const log = makeSwapLog({
          inputToken,
          outputToken,
          amountIn,
          status: "failed",
          reason: factoryCode.reason,
          recipient: owner
        });
        this.ledger?.append?.({ ...log, requiredAmount: requiredAmount?.toString?.() || null });
        return { swapped: false, reason: factoryCode.reason, pair: null, log };
      }

      const liquidity = await this.inspectLiquidity(inputToken, outputToken);
      const pair = liquidity.pair;

      if (!liquidity.hasLiquidity) {
        const reason = liquidity.reason || REASONS.PAIR_EMPTY;
        const log = makeSwapLog({
          inputToken,
          outputToken,
          amountIn,
          status: "failed",
          reason,
          pair,
          recipient: owner
        });
        this.ledger?.append?.({ ...log, requiredAmount: requiredAmount?.toString?.() || null });
        return { swapped: false, reason, pair, log, diagnostic: liquidity };
      }

      const provider = providerFromContract(this.factory) || providerFromContract(this.router);
      const quote = await quoteInputForOutput(
        pair,
        provider,
        inputToken,
        outputToken,
        requiredAmount,
        process.env.QIEDEX_SWAP_SLIPPAGE_BPS || 100
      );
      if (!quote.ok) {
        const log = makeSwapLog({
          inputToken,
          outputToken,
          amountIn,
          status: "failed",
          reason: quote.reason,
          pair,
          recipient: owner
        });
        this.ledger?.append?.({ ...log, requiredAmount: requiredAmount?.toString?.() || null, quote });
        return { swapped: false, reason: quote.reason, pair, log, quote };
      }

      const swapAmountIn = quote.amountIn;
      const inputBalance = await ensureInputBalance({
        tokenAddress: inputToken,
        tokenContract: inputTokenContract,
        owner,
        requiredAmount: swapAmountIn,
        wqie: this.wqie
      });
      if (!inputBalance.ok) {
        const log = makeSwapLog({
          inputToken,
          outputToken,
          amountIn: swapAmountIn,
          status: "failed",
          reason: inputBalance.reason,
          pair,
          recipient: owner
        });
        this.ledger?.append?.({ ...log, requiredAmount: requiredAmount?.toString?.() || null, inputBalance });
        return { swapped: false, reason: inputBalance.reason, pair, log, inputBalance, quote };
      }

      const result = await swapTokens({
        router: this.router,
        inputTokenContract,
        amountIn: swapAmountIn,
        amountOutMin: BigInt(requiredAmount || 0),
        path: [inputToken, outputToken],
        recipient: owner
      });
      const swapped = result.status === "confirmed";
      const outputTokenContract = new ethers.Contract(outputToken, ERC20_ABI, providerFromContract(this.router));
      const outputBalance = BigInt(await outputTokenContract.balanceOf(owner));
      const sufficient = outputBalance >= BigInt(requiredAmount || 0);
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
      return {
        swapped,
        sufficient,
        balance: outputBalance.toString(),
        requiredAmount: requiredAmount?.toString?.() || null,
        reason: swapped ? "SWAP_SUCCESS" : log.reason,
        pair,
        result,
        log
      };
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
  PAIR_ABI,
  ROUTER_ABI,
  REASONS,
  LiquidityEngine,
  approveToken,
  assertContractCode,
  getPair,
  hasLiquidity,
  inspectLiquidity,
  inspectPair,
  swapTokens
};
