import { ethers } from "ethers";

export async function connectWallet() {
  if (!window.ethereum) {
    throw new Error("No Ethereum provider found. Install MetaMask or a compatible wallet.");
  }
  const provider = new ethers.BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  const address = await signer.getAddress();
  const { chainId } = await provider.getNetwork();
  return { provider, signer, address, chainId: Number(chainId) };
}

export async function getBalance(provider, address) {
  const raw = await provider.getBalance(address);
  return ethers.formatEther(raw);
}

export function shortenAddress(address) {
  if (!address) return "";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
