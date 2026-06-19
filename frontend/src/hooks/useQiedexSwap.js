import { useCallback, useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { QIE_MAINNET } from "../lib/wallet";
import {
  DEFAULT_SLIPPAGE_BPS,
  ERC20_ABI,
  QIEDEX_ROUTER_ADDRESS,
  QUSDC_ADDRESS,
  executeQiedexSwap,
  fetchQiedexQuote,
  formatTokenAmount,
  makeSwapTokens,
  parseTokenInput,
  tokenBalance
} from "../lib/qiedex";

const QUSDC_DECIMALS = Number(process.env.REACT_APP_QUSDC_DECIMALS || "6");

function browserProvider(rawProvider) {
  return rawProvider ? new ethers.BrowserProvider(rawProvider) : null;
}

function normalizeError(error) {
  return error?.shortMessage || error?.reason || error?.message || String(error);
}

export function useQiedexSwap({ wallet, deployment, requiredAmountWei }) {
  const [selectedTokenId, setSelectedTokenId] = useState("QIE");
  const [inputAmount, setInputAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(Number(DEFAULT_SLIPPAGE_BPS));
  const [balances, setBalances] = useState({});
  const [quote, setQuote] = useState(null);
  const [loadingBalances, setLoadingBalances] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const tokens = useMemo(
    () => makeSwapTokens(deployment?.addresses || {}),
    [deployment]
  );
  const selectedToken = useMemo(
    () => tokens.find((token) => token.id === selectedTokenId) || tokens[0] || null,
    [selectedTokenId, tokens]
  );
  const provider = useMemo(
    () => browserProvider(wallet?.rawProvider),
    [wallet?.rawProvider]
  );

  const required = useMemo(() => {
    try {
      return BigInt(requiredAmountWei || 0);
    } catch (_error) {
      return 0n;
    }
  }, [requiredAmountWei]);

  const qusdcBalance = BigInt(balances.QUSDC?.raw || "0");
  const hasRequiredQusdc = wallet?.connected && wallet?.isQieMainnet && required > 0n && qusdcBalance >= required;
  const canQuote = Boolean(wallet?.connected && wallet?.isQieMainnet && provider && selectedToken && inputAmount);

  const refreshBalances = useCallback(async () => {
    if (!wallet?.connected || !wallet?.isQieMainnet || !provider || !wallet?.address) {
      setBalances({});
      return {};
    }

    setLoadingBalances(true);
    setError(null);
    try {
      const qusdcToken = {
        id: "QUSDC",
        symbol: "QUSDC",
        address: QUSDC_ADDRESS,
        decimals: QUSDC_DECIMALS
      };
      const nextBalances = {};
      const balanceRows = await Promise.all([
        tokenBalance(provider, qusdcToken, wallet.address).then((value) => [qusdcToken, value]),
        ...tokens.map((token) => tokenBalance(provider, token, wallet.address).then((value) => [token, value]).catch(() => [token, 0n]))
      ]);

      balanceRows.forEach(([token, raw]) => {
        nextBalances[token.id] = {
          raw: BigInt(raw || 0).toString(),
          formatted: formatTokenAmount(raw || 0n, token.decimals)
        };
      });
      setBalances(nextBalances);
      return nextBalances;
    } catch (err) {
      setError(normalizeError(err));
      return {};
    } finally {
      setLoadingBalances(false);
    }
  }, [provider, tokens, wallet?.address, wallet?.connected, wallet?.isQieMainnet]);

  const loadQuote = useCallback(async () => {
    if (!canQuote) {
      setQuote(null);
      return null;
    }

    setQuoting(true);
    setError(null);
    try {
      const amountIn = parseTokenInput(inputAmount, selectedToken.decimals);
      const nextQuote = await fetchQiedexQuote({
        provider,
        token: selectedToken,
        amountIn,
        slippageBps: BigInt(slippageBps)
      });
      setQuote(nextQuote);
      return nextQuote;
    } catch (err) {
      setQuote(null);
      setError(normalizeError(err));
      return null;
    } finally {
      setQuoting(false);
    }
  }, [canQuote, inputAmount, provider, selectedToken, slippageBps]);

  const swap = useCallback(async () => {
    if (!wallet?.connected) {
      throw new Error("Connect a wallet before swapping.");
    }
    if (!wallet.isQieMainnet) {
      await wallet.switchNetwork();
    }
    if (!provider || !selectedToken) {
      throw new Error("Wallet provider is unavailable.");
    }

    setSwapping(true);
    setError(null);
    setSuccess(null);
    try {
      const signer = await provider.getSigner();
      const activeQuote = quote || await loadQuote();
      if (!activeQuote) {
        throw new Error("Quote is required before swapping.");
      }
      const amountIn = parseTokenInput(inputAmount, selectedToken.decimals);
      const selectedBalance = BigInt(balances[selectedToken.id]?.raw || "0");
      if (!selectedToken.native && selectedBalance < amountIn) {
        throw new Error(`Insufficient ${selectedToken.symbol} balance.`);
      }

      const result = await executeQiedexSwap({
        provider,
        signer,
        token: selectedToken,
        amountIn,
        minReceived: activeQuote.minReceived,
        recipient: wallet.address
      });
      await refreshBalances();

      const qusdc = new ethers.Contract(QUSDC_ADDRESS, ERC20_ABI, provider);
      const freshQusdc = await qusdc.balanceOf(wallet.address);
      const sufficient = BigInt(freshQusdc) >= required;
      const message = sufficient
        ? "Swap confirmed. QUSDC balance is ready for payment intent."
        : "Swap confirmed. Add more QUSDC to meet the payment amount.";

      setSuccess({
        ...result,
        message,
        sufficient,
        output: formatTokenAmount(activeQuote.amountOut, QUSDC_DECIMALS)
      });
      setQuote(null);
      return result;
    } catch (err) {
      const message = normalizeError(err);
      setError(message);
      throw err;
    } finally {
      setSwapping(false);
    }
  }, [
    balances,
    inputAmount,
    loadQuote,
    provider,
    quote,
    refreshBalances,
    required,
    selectedToken,
    wallet
  ]);

  useEffect(() => {
    refreshBalances();
  }, [refreshBalances]);

  useEffect(() => {
    if (!canQuote) {
      setQuote(null);
      return undefined;
    }

    const timer = window.setTimeout(() => {
      loadQuote();
    }, 350);

    return () => window.clearTimeout(timer);
  }, [canQuote, loadQuote]);

  useEffect(() => {
    setQuote(null);
    setError(null);
    setSuccess(null);
  }, [selectedTokenId]);

  return {
    balances,
    canQuote,
    error,
    hasRequiredQusdc,
    inputAmount,
    loadingBalances,
    provider,
    qieMainnet: QIE_MAINNET,
    qiedexRouter: QIEDEX_ROUTER_ADDRESS,
    quote,
    qusdcBalance,
    refreshBalances,
    requiredAmountWei: required.toString(),
    selectedToken,
    selectedTokenId,
    setInputAmount,
    setSelectedTokenId,
    setSlippageBps,
    slippageBps,
    success,
    swap,
    swapping,
    quoting,
    tokens
  };
}
