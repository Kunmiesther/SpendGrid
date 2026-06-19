import { ethers } from "ethers";
import EthereumProvider from "@walletconnect/ethereum-provider";

export const QIE_MAINNET = {
  chainId: 1990,
  hexChainId: "0x7c6",
  chainName: "QIE Mainnet",
  rpcUrls: ["https://rpc1mainnet.qie.digital/"],
  nativeCurrency: {
    name: "QIE",
    symbol: "QIE",
    decimals: 18,
  },
  blockExplorerUrls: ["https://mainnet.qie.digital/"],
};

const WALLET_STORAGE_KEY = "spendgrid.wallet";
const WALLETCONNECT_PROJECT_ID = process.env.REACT_APP_WALLETCONNECT_PROJECT_ID || "SPENDGRID_QIE_MAINNET";
const WALLETCONNECT_ID = "walletconnect";

const WALLET_PRIORITIES = {
  qie: 0,
  metamask: 1,
  rabby: 2,
  walletconnect: 100,
};

function getInjectedProviders() {
  if (typeof window === "undefined") return [];
  const detected = [];
  if (Array.isArray(window.ethereum?.providers)) {
    detected.push(...window.ethereum.providers);
  }
  if (window.ethereum) {
    detected.push(window.ethereum);
  }

  [
    window.qie,
    window.qieWallet,
    window.qieEthereum,
    window.metamask?.ethereum,
    window.rabby?.ethereum,
  ].forEach((provider) => {
    if (provider) detected.push(provider);
  });

  return detected.filter((provider, index, providers) => provider && providers.indexOf(provider) === index);
}

function isQieProvider(provider) {
  return Boolean(
    provider?.isQIE ||
      provider?.isQie ||
      provider?.isQieWallet ||
      provider?.isQIEWallet ||
      provider?.qieWallet ||
      provider?.walletName?.toLowerCase?.().includes("qie") ||
      provider?.name?.toLowerCase?.().includes("qie")
  );
}

function providerLabel(type, index) {
  if (type === "qie") return "QIE Wallet";
  if (type === "metamask") return "MetaMask";
  if (type === "rabby") return "Rabby";
  if (type === "coinbase") return "Coinbase Wallet";
  if (type === "trust") return "Trust Wallet";
  return index === 0 ? "Injected Wallet" : `Injected Wallet ${index + 1}`;
}

function providerKind(provider, index) {
  if (isQieProvider(provider)) return "qie";
  if (provider.isRabby) return "rabby";
  if (provider.isMetaMask) return "metamask";
  if (provider.isCoinbaseWallet) return "coinbase";
  if (provider.isTrust) return "trust";
  return `injected-${index}`;
}

export function getWalletProviders() {
  const seenKinds = new Set();
  const injected = getInjectedProviders()
    .map((provider, index) => {
      const type = providerKind(provider, index);
      return {
        id: type.startsWith("injected-") ? type : `injected-${type}`,
        type,
        label: providerLabel(type, index),
        subtitle: type === "qie" ? "Recommended for QIE Mainnet" : null,
        provider,
        connector: "injected",
        priority: WALLET_PRIORITIES[type] ?? 10 + index,
      };
    })
    .filter((wallet) => {
      if (wallet.type.startsWith("injected-")) return true;
      if (seenKinds.has(wallet.type)) return false;
      seenKinds.add(wallet.type);
      return true;
    });

  return [
    ...injected,
    {
      id: WALLETCONNECT_ID,
      type: WALLETCONNECT_ID,
      label: "WalletConnect",
      subtitle: "Scan with WalletConnect",
      provider: null,
      connector: WALLETCONNECT_ID,
      priority: WALLET_PRIORITIES.walletconnect,
    },
  ].sort((a, b) => a.priority - b.priority || a.label.localeCompare(b.label));
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

async function createWalletConnectProvider() {
  if (!WALLETCONNECT_PROJECT_ID || WALLETCONNECT_PROJECT_ID === "SPENDGRID_QIE_MAINNET") {
    throw new Error("REACT_APP_WALLETCONNECT_PROJECT_ID is required for WalletConnect.");
  }

  const provider = await EthereumProvider.init({
    projectId: WALLETCONNECT_PROJECT_ID,
    chains: [QIE_MAINNET.chainId],
    optionalChains: [QIE_MAINNET.chainId],
    showQrModal: true,
    rpcMap: {
      [QIE_MAINNET.chainId]: QIE_MAINNET.rpcUrls[0],
    },
    metadata: {
      name: "SpendGrid",
      description: "SpendGrid AI agent payment dashboard",
      url: window.location.origin,
      icons: [`${window.location.origin}/favicon.ico`],
    },
  });

  await provider.enable();
  return provider;
}

export async function connectWallet(walletId) {
  if (!walletId) {
    throw new Error("Select a wallet provider to connect.");
  }

  const selected = getProviderById(walletId);
  if (!selected) {
    throw new Error("Selected wallet provider is not available.");
  }

  const rawProvider = selected.connector === WALLETCONNECT_ID
    ? await createWalletConnectProvider()
    : selected.provider;

  await rawProvider.request({ method: "eth_requestAccounts" });
  const provider = new ethers.BrowserProvider(rawProvider);
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
    rawProvider,
    signer,
    address,
    chainId: Number(chainId),
    walletId: selected.id,
    walletLabel: selected.label,
  };
}

export async function switchToQieMainnet(rawProvider) {
  if (!rawProvider) {
    throw new Error("No wallet provider selected.");
  }

  try {
    await rawProvider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: QIE_MAINNET.hexChainId }],
    });
  } catch (error) {
    if (error.code !== 4902) {
      throw error;
    }

    await rawProvider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: QIE_MAINNET.hexChainId,
          chainName: QIE_MAINNET.chainName,
          rpcUrls: QIE_MAINNET.rpcUrls,
          nativeCurrency: QIE_MAINNET.nativeCurrency,
          blockExplorerUrls: QIE_MAINNET.blockExplorerUrls,
        },
      ],
    });

    await rawProvider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: QIE_MAINNET.hexChainId }],
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
  window.open("https://mainnet.qie.digital/", "_blank", "noopener,noreferrer");
}

export async function getBalance(provider, address) {
  const raw = await provider.getBalance(address);
  return ethers.formatEther(raw);
}

export function shortenAddress(address) {
  if (!address) return "";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
