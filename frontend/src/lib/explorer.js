const QIE_MAINNET_EXPLORER_URL = "https://mainnet.qie.digital/";
const QIE_TESTNET_EXPLORER_URL = "https://testnet.qie.digital/";

function normalizeNetwork(network = {}) {
  if (!network || typeof network !== "object") {
    return {};
  }

  return {
    chainId: network.chainId ?? network.id ?? null,
    name: network.name || network.network || network.chainName || ""
  };
}

export function getQieExplorerBase(network = {}) {
  const normalized = normalizeNetwork(network);
  const name = String(normalized.name || "").toLowerCase();
  const chainId = Number(normalized.chainId);

  if (name.includes("test") || (Number.isFinite(chainId) && chainId !== 1990 && !name.includes("main"))) {
    return QIE_TESTNET_EXPLORER_URL;
  }

  return QIE_MAINNET_EXPLORER_URL;
}

export function getQieTxExplorerUrl(network = {}, hash) {
  if (!hash) return "";
  return `${getQieExplorerBase(network)}tx/${hash}`;
}

export { QIE_MAINNET_EXPLORER_URL, QIE_TESTNET_EXPLORER_URL };
