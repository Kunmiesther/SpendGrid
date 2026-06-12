import { ethers } from "ethers";

export const QIE_TESTNET = {
  chainId: 1983,
  hexChainId: "0x7bf",
  chainName: "QIE Testnet",
  rpcUrls: ["https://rpc1testnet.qie.digital/"],
  nativeCurrency: {
    name: "QIE",
    symbol: "QIE",
    decimals: 18,
  },
  blockExplorerUrls: [],
};

const WALLET_STORAGE_KEY = "spendgrid.wallet";

function getInjectedProviders() {
  if (typeof window === "undefined" || !window.ethereum) return [];
  const detected = window.ethereum.providers?.length ? window.ethereum.providers : [window.ethereum];
  return detected.filter((provider, index, providers) => providers.indexOf(provider) === index);
}

function providerLabel(provider) {
  if (provider.isRabby) return "Rabby";
  if (provider.isMetaMask) return "MetaMask";
  if (provider.isCoinbaseWallet) return "Coinbase Wallet";
  if (provider.isTrust) return "Trust Wallet";
  return "Injected Wallet";
}

function providerId(provider, index) {
  if (provider.isRabby) return "rabby";
  if (provider.isMetaMask) return "metamask";
  if (provider.isCoinbaseWallet) return "coinbase";
  if (provider.isTrust) return "trust";
  return `injected-${index}`;
}

export function getWalletProviders() {
  return getInjectedProviders().map((provider, index) => ({
    id: providerId(provider, index),
    label: providerLabel(provider),
    provider,
  }));
}

export function getStoredWalletId() {
  try {
    return window.localStorage.getItem(WALLET_STORAGE_KEY);
  } catch (_error) {
    return null;
  }
}

export function clearStoredWallet() {
  try {
    window.localStorage.removeItem(WALLET_STORAGE_KEY);
  } catch (_error) {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
}

export function getProviderById(walletId) {
  const providers = getWalletProviders();
  return providers.find((wallet) => wallet.id === walletId) || null;
}

export async function connectWallet(walletId) {
  const selected = getProviderById(walletId);
  if (!selected) {
    throw new Error("Selected wallet provider is not available.");
  }

  await selected.provider.request({ method: "eth_requestAccounts" });
  const provider = new ethers.BrowserProvider(selected.provider);
  const signer = await provider.getSigner();
  const address = await signer.getAddress();
  const { chainId } = await provider.getNetwork();

  try {
    window.localStorage.setItem(WALLET_STORAGE_KEY, selected.id);
  } catch (_error) {
    // Connection should still succeed when persistent storage is unavailable.
  }

  return {
    provider,
    rawProvider: selected.provider,
    signer,
    address,
    chainId: Number(chainId),
    walletId: selected.id,
    walletLabel: selected.label,
  };
}

export async function switchToQieTestnet(rawProvider) {
  if (!rawProvider) {
    throw new Error("No wallet provider selected.");
  }

  try {
    await rawProvider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: QIE_TESTNET.hexChainId }],
    });
  } catch (error) {
    if (error.code !== 4902) {
      throw error;
    }

    await rawProvider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: QIE_TESTNET.hexChainId,
          chainName: QIE_TESTNET.chainName,
          rpcUrls: QIE_TESTNET.rpcUrls,
          nativeCurrency: QIE_TESTNET.nativeCurrency,
          blockExplorerUrls: QIE_TESTNET.blockExplorerUrls,
        },
      ],
    });

    await rawProvider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: QIE_TESTNET.hexChainId }],
    });
  }
}

export async function copyAddress(address) {
  if (!address) return;
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(address);
    return;
  }

  const input = document.createElement("textarea");
  input.value = address;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  document.execCommand("copy");
  document.body.removeChild(input);
}

export function openFaucet() {
  window.open("https://qie.digital/faucet", "_blank", "noopener,noreferrer");
}

export async function getBalance(provider, address) {
  const raw = await provider.getBalance(address);
  return ethers.formatEther(raw);
}

export function shortenAddress(address) {
  if (!address) return "";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
