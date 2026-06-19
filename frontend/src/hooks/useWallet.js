import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  clearWalletSession,
  clearStoredWallet,
  connectWallet,
  copyAddress,
  getStoredWalletId,
  getWalletProviders,
  openFaucet,
  QIE_MAINNET,
  requestWalletProviderDiscovery,
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

function normalizeChainId(chainId) {
  if (typeof chainId === "number") return chainId;
  if (typeof chainId === "bigint") return Number(chainId);
  if (typeof chainId === "string") {
    return Number.parseInt(chainId, chainId.startsWith("0x") ? 16 : 10);
  }

  return null;
}

function providerSignature(providers) {
  return providers.map((provider) => provider.id).join("|");
}

function useWalletController() {
  const [state, setState] = useState(INITIAL_STATE);

  const refreshProviders = useCallback(() => {
    const providers = getWalletProviders();
    setState((s) => (
      providerSignature(s.providers) === providerSignature(providers)
        ? s
        : { ...s, providers }
    ));
    return providers;
  }, []);

  useEffect(() => {
    const providers = refreshProviders();
    const storedWalletId = getStoredWalletId();
    if (storedWalletId && !providers.some((provider) => provider.id === storedWalletId)) {
      clearStoredWallet();
    }
  }, [refreshProviders]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const handleProviderAnnounced = () => refreshProviders();
    window.addEventListener?.("eip6963:announceProvider", handleProviderAnnounced);
    return () => {
      window.removeEventListener?.("eip6963:announceProvider", handleProviderAnnounced);
    };
  }, [refreshProviders]);

  const discoverProviders = useCallback(() => {
    const providers = refreshProviders();
    requestWalletProviderDiscovery();
    window.setTimeout(() => refreshProviders(), 300);
    return providers;
  }, [refreshProviders]);

  const disconnect = useCallback(async () => {
    const rawProvider = state.rawProvider;
    setState((s) => ({
      ...INITIAL_STATE,
      providers: s.providers,
    }));
    await clearWalletSession(rawProvider);
  }, [state.rawProvider]);

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
      setState((s) => ({ ...s, chainId: normalizeChainId(chainId) }));
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
    discoverProviders,
    refreshProviders,
    switchNetwork,
  }), [
    state,
    connect,
    copy,
    disconnect,
    discoverProviders,
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
