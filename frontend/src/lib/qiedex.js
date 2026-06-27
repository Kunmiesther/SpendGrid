import { ethers } from "ethers";

export const QIEDEX_ROUTER_ADDRESS = "0x08cd2e72e156D8563B4351eb4065C262A9f553Ef";
export const QIEDEX_FACTORY_ADDRESS = "0x8E23128a5511223bE6c0d64106e2D4508C08398C";
export const WQIE_ADDRESS = "0x0087904D95BEe9E5F24dc8852804b547981A9139";
export const QUSDC_ADDRESS = "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5";

export const DEFAULT_SLIPPAGE_BPS = 100n;
export const BPS_DENOMINATOR = 10_000n;

export const ERC20_ABI = [
  "function approve(address spender,uint256 amount) external returns (bool)",
  "function allowance(address owner,address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)"
];

export const WQIE_ABI = [
  ...ERC20_ABI,
  "function deposit() external payable",
  "function withdraw(uint256 amount) external"
];

export const QIEDEX_ROUTER_ABI = [
  "function factory() external view returns (address)",
  "function WETH() external view returns (address)",
  "function getAmountOut(uint256 amountIn,address input,address output) external view returns (uint256 amountOut)",
  "function getAmountsOut(uint256 amountIn,address[] calldata path) external view returns (uint256[] memory amounts)",
  "function swapExactTokensForTokens(uint256 amountIn,uint256 amountOutMin,address[] calldata path,address to,uint256 deadline) external returns (uint256[] memory amounts)",
  "error Expired()",
  "error InvalidPath()",
  "error PairMissing(address tokenA,address tokenB)",
  "error InsufficientOutputAmount()",
  "error TransferFailed()"
];

export const QIEDEX_FACTORY_ABI = [
  "function getPair(address tokenA,address tokenB) external view returns (address pair)"
];

export const QIEDEX_PAIR_ABI = [
  "function getReserves() external view returns (uint112 reserve0,uint112 reserve1,uint32 blockTimestampLast)",
  "function token0() external view returns (address)",
  "function token1() external view returns (address)"
];

const ZERO_ADDRESS = ethers.ZeroAddress.toLowerCase();

function errorText(error) {
  return [
    error?.shortMessage,
    error?.reason,
    error?.info?.error?.message,
    error?.error?.message,
    error?.message
  ].filter(Boolean)[0] || String(error);
}

function errorData(error) {
  return error?.data
    || error?.info?.error?.data
    || error?.error?.data
    || error?.revert?.data
    || null;
}

function formatRouterError(error) {
  const data = errorData(error);
  if (data) {
    try {
      const parsed = new ethers.Interface(QIEDEX_ROUTER_ABI).parseError(data);
      if (parsed?.name === "PairMissing") {
        return `QIEDex pair is missing for ${parsed.args.tokenA} -> ${parsed.args.tokenB}.`;
      }
      if (parsed?.name === "InsufficientOutputAmount") {
        return "QIEDex router rejected the swap because the quoted output is below the selected slippage limit.";
      }
      if (parsed?.name === "TransferFailed") {
        return "QIEDex router could not transfer the input token. Check WQIE balance and router allowance.";
      }
      if (parsed?.name === "Expired") {
        return "QIEDex router rejected the swap because the quote deadline expired.";
      }
      if (parsed?.name === "InvalidPath") {
        return "QIEDex router rejected the swap path.";
      }
    } catch (_parseError) {
      // Fall through to the wallet/provider error text.
    }
  }

  const text = errorText(error);
  if (/insufficient funds/i.test(text)) {
    return "Insufficient QIE balance for the swap amount and gas.";
  }
  if (/user rejected|user denied|rejected by user/i.test(text)) {
    return "Swap was rejected in the wallet.";
  }
  if (/missing revert data|execution reverted|call exception/i.test(text)) {
    return `QIEDex router reverted the swap. ${text}`;
  }

  return text;
}

function stageFailure(stage, error) {
  if (stage === "estimating") {
    return `QIEDex swap estimate failed: ${formatRouterError(error)}`;
  }
  if (stage === "swapping") {
    return `QIEDex swap failed: ${formatRouterError(error)}`;
  }
  if (stage === "approving") {
    return `QIEDex router approval failed: ${formatRouterError(error)}`;
  }
  if (stage === "wrapping") {
    return `Unable to prepare native QIE for QIEDex: ${formatRouterError(error)}`;
  }

  return formatRouterError(error);
}

async function waitForSuccess(tx, label) {
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) {
    throw new Error(`${label} failed: ${tx.hash}`);
  }

  return receipt;
}

async function unwrapNativeInput({ signer, owner, amount }) {
  const wqie = new ethers.Contract(WQIE_ADDRESS, WQIE_ABI, signer);
  const balance = BigInt(await wqie.balanceOf(owner));
  const unwrapAmount = balance < amount ? balance : amount;
  if (unwrapAmount <= 0n) {
    return {
      unwrapped: false,
      amount: "0",
      reason: "No WQIE balance was available to unwrap."
    };
  }

  const tx = await wqie.withdraw(unwrapAmount);
  const receipt = await waitForSuccess(tx, "WQIE unwrap");
  return {
    unwrapped: true,
    amount: unwrapAmount.toString(),
    hash: tx.hash,
    blockNumber: receipt.blockNumber
  };
}

export function makeSwapTokens(addresses = {}) {
  return [
    {
      id: "QIE",
      symbol: "QIE",
      label: "QIE",
      address: WQIE_ADDRESS,
      native: true,
      decimals: 18
    },
    {
      id: "WQIE",
      symbol: "WQIE",
      label: "WQIE",
      address: addresses.wqie || WQIE_ADDRESS,
      decimals: 18
    },
    {
      id: "WETH",
      symbol: "WETH",
      label: "WETH",
      address: addresses.wrappedETH,
      decimals: 18
    },
    {
      id: "wUSDC",
      symbol: "wUSDC",
      label: "wUSDC",
      address: addresses.wrappedUSDC,
      decimals: 6
    },
    {
      id: "wUSDT",
      symbol: "wUSDT",
      label: "wUSDT",
      address: addresses.wrappedUSDT,
      decimals: 6
    }
  ].filter((token) => token.native || ethers.isAddress(token.address || ""));
}

export function formatTokenAmount(value, decimals = 18, maxFractionDigits = 6) {
  try {
    const formatted = ethers.formatUnits(BigInt(value || 0), decimals);
    const [whole, fraction = ""] = formatted.split(".");
    const trimmedFraction = fraction.slice(0, maxFractionDigits).replace(/0+$/, "");
    return trimmedFraction ? `${whole}.${trimmedFraction}` : whole;
  } catch (_error) {
    return "0";
  }
}

export function parseTokenInput(value, decimals) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return 0n;
  }

  return ethers.parseUnits(String(value).trim(), decimals);
}

export function applySlippage(amountOut, slippageBps = DEFAULT_SLIPPAGE_BPS) {
  const amount = BigInt(amountOut || 0);
  const bps = BigInt(slippageBps);
  return (amount * (BPS_DENOMINATOR - bps)) / BPS_DENOMINATOR;
}

export function priceImpactBps({ amountIn, amountOut, reserveIn, reserveOut }) {
  const input = BigInt(amountIn || 0);
  const output = BigInt(amountOut || 0);
  const inReserve = BigInt(reserveIn || 0);
  const outReserve = BigInt(reserveOut || 0);
  if (input <= 0n || output <= 0n || inReserve <= 0n || outReserve <= 0n) {
    return null;
  }

  const spotOut = (input * outReserve) / inReserve;
  if (spotOut <= 0n || spotOut <= output) {
    return 0n;
  }

  return ((spotOut - output) * BPS_DENOMINATOR) / spotOut;
}

export async function tokenBalance(provider, token, owner) {
  if (!provider || !owner) return 0n;
  if (token.native) {
    return provider.getBalance(owner);
  }

  const contract = new ethers.Contract(token.address, ERC20_ABI, provider);
  return contract.balanceOf(owner);
}

export async function tokenAllowance(provider, token, owner, spender) {
  if (!provider || !owner || token.native) return ethers.MaxUint256;
  const contract = new ethers.Contract(token.address, ERC20_ABI, provider);
  return contract.allowance(owner, spender);
}

export async function fetchQiedexQuote({ provider, token, amountIn, qusdcAddress = QUSDC_ADDRESS, slippageBps = DEFAULT_SLIPPAGE_BPS }) {
  if (!provider) throw new Error("Connect a wallet to quote QIEDex.");
  const input = BigInt(amountIn || 0);
  if (input <= 0n) throw new Error("Enter an amount to quote.");
  if (!token?.address || !ethers.isAddress(token.address)) throw new Error("Select a valid input token.");
  if (token.address.toLowerCase() === qusdcAddress.toLowerCase()) throw new Error("Input token must differ from QUSDC.");

  const router = new ethers.Contract(QIEDEX_ROUTER_ADDRESS, QIEDEX_ROUTER_ABI, provider);
  const factory = new ethers.Contract(QIEDEX_FACTORY_ADDRESS, QIEDEX_FACTORY_ABI, provider);
  const pairAddress = await factory.getPair(token.address, qusdcAddress);
  if (!pairAddress || pairAddress.toLowerCase() === ZERO_ADDRESS) {
    throw new Error(`No QIEDex pool found for ${token.symbol}/QUSDC.`);
  }

  const path = [token.address, qusdcAddress];
  let amountOut = 0n;
  let quoteSource = "router.getAmountsOut";
  try {
    const amounts = await router.getAmountsOut(input, path);
    amountOut = BigInt(amounts[amounts.length - 1] || 0);
  } catch (_getAmountsOutError) {
    quoteSource = "router.getAmountOut";
    try {
      amountOut = BigInt(await router.getAmountOut(input, token.address, qusdcAddress));
    } catch (_getAmountOutError) {
      quoteSource = "reserve_math";
    }
  }
  const pair = new ethers.Contract(pairAddress, QIEDEX_PAIR_ABI, provider);
  const [reserves, token0] = await Promise.all([
    pair.getReserves(),
    pair.token0()
  ]);
  const inputIsToken0 = token0.toLowerCase() === token.address.toLowerCase();
  const reserveIn = inputIsToken0 ? BigInt(reserves.reserve0) : BigInt(reserves.reserve1);
  const reserveOut = inputIsToken0 ? BigInt(reserves.reserve1) : BigInt(reserves.reserve0);
  if (amountOut <= 0n && quoteSource === "reserve_math") {
    const amountInWithFee = input * 997n;
    amountOut = (amountInWithFee * reserveOut) / ((reserveIn * 1000n) + amountInWithFee);
  }
  if (amountOut <= 0n) {
    throw new Error(`QIEDex quote returned zero output for ${token.symbol}/QUSDC.`);
  }

  let estimatedGas = null;
  try {
    const signer = typeof provider.getSigner === "function" ? await provider.getSigner().catch(() => null) : null;
    if (signer) {
      const owner = await signer.getAddress();
      const feeData = await provider.getFeeData().catch(() => null);
      const gasPrice = feeData?.gasPrice || feeData?.maxFeePerGas || feeData?.lastBaseFeePerGas || null;
      const routerWithSigner = new ethers.Contract(QIEDEX_ROUTER_ADDRESS, QIEDEX_ROUTER_ABI, signer);
      const tokenWithSigner = token.native
        ? null
        : new ethers.Contract(token.address, ERC20_ABI, signer);
      const deadline = Math.floor(Date.now() / 1000) + 300;
      let totalGas = 0n;
      if (tokenWithSigner) {
        try {
          const allowance = BigInt(await tokenWithSigner.allowance(owner, QIEDEX_ROUTER_ADDRESS));
          if (allowance < input) {
            totalGas += BigInt(await tokenWithSigner.approve.estimateGas(QIEDEX_ROUTER_ADDRESS, input));
          }
        } catch (_approvalEstimateError) {
          // Approval estimation is best-effort only.
        }
      }
      totalGas += BigInt(await routerWithSigner.swapExactTokensForTokens.estimateGas(input, applySlippage(amountOut, slippageBps), path, owner, deadline));
      if (gasPrice && totalGas > 0n) {
        const feeWei = totalGas * BigInt(gasPrice);
        estimatedGas = {
          gasUsed: totalGas.toString(),
          gasPrice: gasPrice.toString(),
          feeWei: feeWei.toString(),
          feeQie: ethers.formatUnits(feeWei, 18)
        };
      }
    }
  } catch (_estimateError) {
    estimatedGas = null;
  }

  return {
    amountIn: input.toString(),
    amountOut: amountOut.toString(),
    minReceived: applySlippage(amountOut, slippageBps).toString(),
    pairAddress,
    path,
    priceImpactBps: priceImpactBps({ amountIn: input, amountOut, reserveIn, reserveOut })?.toString() || null,
    quoteSource,
    reserveIn: reserveIn.toString(),
    reserveOut: reserveOut.toString(),
    slippageBps: BigInt(slippageBps).toString(),
    estimatedGas
  };
}

export async function executeQiedexSwap({ provider, signer, token, amountIn, minReceived, recipient, qusdcAddress = QUSDC_ADDRESS }) {
  if (!provider || !signer) throw new Error("Connect a wallet before swapping.");
  const owner = await signer.getAddress();
  const to = ethers.getAddress(recipient || owner);
  const input = BigInt(amountIn || 0);
  const minOut = BigInt(minReceived || 0);
  if (input <= 0n) throw new Error("Enter an amount before swapping.");
  if (minOut <= 0n) throw new Error("Quote expired. Refresh the quote before swapping.");

  const txs = {
    wrap: null,
    approval: null,
    swap: null,
    unwrap: null
  };

  let swapToken = token;
  const nativeInput = Boolean(token.native);
  let wrappedNative = false;
  let stage = "preparing";

  try {
    if (nativeInput) {
      stage = "wrapping";
      const wqie = new ethers.Contract(WQIE_ADDRESS, WQIE_ABI, signer);
      const balance = BigInt(await provider.getBalance(owner));
      if (balance <= input) {
        throw new Error("Native QIE balance is too low for the swap amount and gas.");
      }
      const wrapTx = await wqie.deposit({ value: input });
      txs.wrap = wrapTx.hash;
      await waitForSuccess(wrapTx, "Native QIE wrap");
      wrappedNative = true;
      swapToken = {
        ...token,
        native: false,
        address: WQIE_ADDRESS,
        symbol: "WQIE"
      };
    }

    stage = "approving";
    const tokenContract = new ethers.Contract(swapToken.address, ERC20_ABI, signer);
    const allowance = BigInt(await tokenContract.allowance(owner, QIEDEX_ROUTER_ADDRESS));
    if (allowance < input) {
      const approvalTx = await tokenContract.approve(QIEDEX_ROUTER_ADDRESS, input);
      txs.approval = approvalTx.hash;
      await waitForSuccess(approvalTx, "QIEDex router approval");
    }

    const router = new ethers.Contract(QIEDEX_ROUTER_ADDRESS, QIEDEX_ROUTER_ABI, signer);
    const deadline = Math.floor(Date.now() / 1000) + 300;
    const path = [swapToken.address, qusdcAddress];

    stage = "estimating";
    await router.swapExactTokensForTokens.estimateGas(input, minOut, path, to, deadline);

    stage = "swapping";
    const swapTx = await router.swapExactTokensForTokens(input, minOut, path, to, deadline);
    txs.swap = swapTx.hash;
    const receipt = await waitForSuccess(swapTx, "QIEDex swap");

    return {
      ...txs,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed?.toString?.() || null,
      path
    };
  } catch (error) {
    let rollback = null;
    if (nativeInput && wrappedNative) {
      try {
        rollback = await unwrapNativeInput({ signer, owner, amount: input });
        txs.unwrap = rollback.hash || null;
      } catch (unwrapError) {
        rollback = {
          unwrapped: false,
          reason: `Unable to unwrap WQIE back to QIE: ${formatRouterError(unwrapError)}`
        };
      }
    }

    const message = stageFailure(stage, error);
    const rollbackMessage = rollback
      ? rollback.unwrapped
        ? " Wrapped QIE was returned to native QIE."
        : ` ${rollback.reason}`
      : "";
    const wrappedError = new Error(`${message}${rollbackMessage}`);
    wrappedError.cause = error;
    wrappedError.transactions = txs;
    wrappedError.rollback = rollback;
    throw wrappedError;
  }
}
