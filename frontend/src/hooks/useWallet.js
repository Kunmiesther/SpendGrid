import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  clearStoredWallet,
  connectWallet,
  copyAddress,
  getStoredWalletId,
  getWalletProviders,
  openFaucet,
  QIE_MAINNET,
  shortenAddress,
  switchToQieMainnet,
} from "../lib/wallet";

const INITIAL_STATE = {
  address: null,
  shortAddress: null,
  chainId: null,
  connected: false,
  loading: false,
  error: null,
  walletId: null,
  walletLabel: null,
  providers: [],
  rawProvider: null,
  provider: null,
  signer: null,
  copied: false,
};

const WalletContext = createContext(null);

function useWalletController() {
  const [state, setState] = useState(INITIAL_STATE);

  const refreshProviders = useCallback(() => {
    const providers = getWalletProviders();
    setState((s) => ({ ...s, providers }));
    return providers;
  }, []);

  useEffect(() => {
    const providers = refreshProviders();
    const storedWalletId = getStoredWalletId();
    if (storedWalletId && !providers.some((provider) => provider.id === storedWalletId)) {
      clearStoredWallet();
    }
  }, [refreshProviders]);

  const disconnect = useCallback(() => {
    clearStoredWallet();
    setState((s) => ({
      ...INITIAL_STATE,
      providers: s.providers,
    }));
  }, []);

  useEffect(() => {
    if (!state.rawProvider) return undefined;

    const handleAccountsChanged = (accounts) => {
      const nextAddress = accounts?.[0] || null;
      if (!nextAddress) {
        disconnect();
        return;
      }
      setState((s) => ({
        ...s,
        address: nextAddress,
        shortAddress: shortenAddress(nextAddress),
        connected: true,
      }));
    };

    const handleChainChanged = (chainId) => {
      setState((s) => ({ ...s, chainId: Number.parseInt(chainId, 16) }));
    };

    state.rawProvider.on?.("accountsChanged", handleAccountsChanged);
    state.rawProvider.on?.("chainChanged", handleChainChanged);

    return () => {
      state.rawProvider.removeListener?.("accountsChanged", handleAccountsChanged);
      state.rawProvider.removeListener?.("chainChanged", handleChainChanged);
    };
  }, [disconnect, state.rawProvider]);

  const connect = useCallback(async (walletId) => {
    setState((s) => ({ ...s, loading: true, error: null, copied: false }));
    try {
      const result = await connectWallet(walletId);
      setState((s) => ({
        ...s,
        address: result.address,
        shortAddress: shortenAddress(result.address),
        chainId: result.chainId,
        connected: true,
        loading: false,
        error: null,
        walletId: result.walletId,
        walletLabel: result.walletLabel,
        rawProvider: result.rawProvider,
        provider: result.provider,
        signer: result.signer,
      }));
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err.message }));
      throw err;
    }
  }, []);

  const switchNetwork = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      await switchToQieMainnet(state.rawProvider);
      setState((s) => ({ ...s, chainId: QIE_MAINNET.chainId, loading: false }));
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err.message }));
      throw err;
    }
  }, [state.rawProvider]);

  const copy = useCallback(async () => {
    await copyAddress(state.address);
    setState((s) => ({ ...s, copied: true }));
    window.setTimeout(() => setState((s) => ({ ...s, copied: false })), 1200);
  }, [state.address]);

  return useMemo(() => ({
    ...state,
    isQieMainnet: state.chainId === QIE_MAINNET.chainId,
    connect,
    copy,
    disconnect,
    openFaucet,
    refreshProviders,
    switchNetwork,
  }), [
    state,
    connect,
    copy,
    disconnect,
    refreshProviders,
    switchNetwork,
  ]);
}

export function WalletProvider({ children }) {
  const wallet = useWalletController();
  return (
    <WalletContext.Provider value={wallet}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const wallet = useContext(WalletContext);
  if (!wallet) {
    throw new Error("useWallet must be used within WalletProvider");
  }

  return wallet;
}
