import { useState, useCallback } from "react";
import { connectWallet, shortenAddress } from "../lib/wallet";

export function useWallet() {
  const [state, setState] = useState({
    address: null,
    shortAddress: null,
    chainId: null,
    connected: false,
    loading: false,
    error: null,
  });

  const connect = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const { address, chainId } = await connectWallet();
      setState({
        address,
        shortAddress: shortenAddress(address),
        chainId,
        connected: true,
        loading: false,
        error: null,
      });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err.message }));
    }
  }, []);

  const disconnect = useCallback(() => {
    setState({ address: null, shortAddress: null, chainId: null, connected: false, loading: false, error: null });
  }, []);

  return { ...state, connect, disconnect };
}
