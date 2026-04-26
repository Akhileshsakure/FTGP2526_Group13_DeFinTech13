// lib/ethers.ts
// ================================================================
// Ethers.js v6 provider / signer helpers
// Works exclusively with window.ethereum (MetaMask)
// ================================================================

import { ethers, BrowserProvider, JsonRpcProvider } from "ethers";

export const SEPOLIA_CHAIN_ID = 11155111;
export const SEPOLIA_HEX = "0xaa36a7";

// ── Read-only provider (uses Alchemy/Infura RPC, no wallet needed) ──
export function getReadProvider(): JsonRpcProvider {
  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL;
  if (!rpcUrl) {
    throw new Error("NEXT_PUBLIC_RPC_URL is not set in .env.local");
  }
  return new JsonRpcProvider(rpcUrl);
}

// ── Browser provider (wraps window.ethereum — MetaMask) ──────
export function getBrowserProvider(): BrowserProvider {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("MetaMask not found. Please install MetaMask.");
  }
  return new BrowserProvider(window.ethereum);
}

// ── Get signer (connected wallet) ────────────────────────────
export async function getSigner(): Promise<ethers.Signer> {
  const provider = getBrowserProvider();
  return provider.getSigner();
}

// ── Request MetaMask account access ──────────────────────────
export async function requestAccounts(): Promise<string[]> {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("MetaMask not found.");
  }
  const accounts = await window.ethereum.request({
    method: "eth_requestAccounts",
  });
  return accounts as string[];
}

// ── Get currently connected accounts (no popup) ───────────────
export async function getAccounts(): Promise<string[]> {
  if (typeof window === "undefined" || !window.ethereum) return [];
  const accounts = await window.ethereum.request({ method: "eth_accounts" });
  return accounts as string[];
}

// ── Get current chain ID ──────────────────────────────────────
export async function getChainId(): Promise<number> {
  if (typeof window === "undefined" || !window.ethereum) return 0;
  const chainId = await window.ethereum.request({ method: "eth_chainId" });
  return parseInt(chainId as string, 16);
}

// ── Switch or add Sepolia network ────────────────────────────
export async function switchToSepolia(): Promise<void> {
  if (typeof window === "undefined" || !window.ethereum) return;

  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: SEPOLIA_HEX }],
    });
  } catch (err: unknown) {
    // Chain not added to MetaMask yet — add it
    if ((err as { code?: number })?.code === 4902) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: SEPOLIA_HEX,
            chainName: "Sepolia Test Network",
            nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
            rpcUrls: [
              process.env.NEXT_PUBLIC_RPC_URL ||
                "https://rpc.sepolia.org",
            ],
            blockExplorerUrls: ["https://sepolia.etherscan.io"],
          },
        ],
      });
    } else {
      throw err;
    }
  }
}

// ── Utility: shorten address for display ──────────────────────
export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

// ── Utility: format BigInt to human readable ──────────────────
export function formatUnits(value: bigint, decimals: number = 18): string {
  return ethers.formatUnits(value, decimals);
}

// ── Utility: parse human input to BigInt ──────────────────────
export function parseUnits(value: string, decimals: number = 18): bigint {
  return ethers.parseUnits(value, decimals);
}

// ── Declare global window.ethereum type ──────────────────────
declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on: (event: string, handler: (...args: unknown[]) => void) => void;
      removeListener: (event: string, handler: (...args: unknown[]) => void) => void;
      isMetaMask?: boolean;
    };
  }
}
