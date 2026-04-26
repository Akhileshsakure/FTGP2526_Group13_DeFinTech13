"use client";
// context/WalletContext.tsx
// ================================================================
// Global wallet state: account, chain, connection status
// Wrap the app with <WalletProvider> in layout.tsx
// ================================================================

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import {
  requestAccounts,
  getAccounts,
  getChainId,
  switchToSepolia,
  SEPOLIA_CHAIN_ID,
  shortAddress,
} from "../lib/ethers";

interface WalletState {
  account: string | null;
  chainId: number | null;
  isConnected: boolean;
  isCorrectNetwork: boolean;
  isConnecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  switchNetwork: () => Promise<void>;
  disconnect: () => void;
  shortAccount: string;
}

const WalletContext = createContext<WalletState>({} as WalletState);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isConnected = !!account;
  const isCorrectNetwork = chainId === SEPOLIA_CHAIN_ID;

  // ── Auto-reconnect on page load if already connected ────────
  useEffect(() => {
    const init = async () => {
      const accounts = await getAccounts();
      if (accounts.length > 0) {
        setAccount(accounts[0]);
        const chain = await getChainId();
        setChainId(chain);
      }
    };
    init();
  }, []);

  // ── Listen for MetaMask events ────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined" || !window.ethereum) return;

    const handleAccountsChanged = (accounts: unknown) => {
      const accs = accounts as string[];
      if (accs.length === 0) {
        setAccount(null);
      } else {
        setAccount(accs[0]);
      }
    };

    const handleChainChanged = (chainId: unknown) => {
      setChainId(parseInt(chainId as string, 16));
    };

    window.ethereum.on("accountsChanged", handleAccountsChanged);
    window.ethereum.on("chainChanged", handleChainChanged);

    return () => {
      window.ethereum?.removeListener("accountsChanged", handleAccountsChanged);
      window.ethereum?.removeListener("chainChanged", handleChainChanged);
    };
  }, []);

  const connect = useCallback(async () => {
    setIsConnecting(true);
    setError(null);
    try {
      const accounts = await requestAccounts();
      setAccount(accounts[0]);
      const chain = await getChainId();
      setChainId(chain);
    } catch (err: unknown) {
      setError((err as Error).message || "Connection failed");
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const switchNetwork = useCallback(async () => {
    try {
      await switchToSepolia();
      const chain = await getChainId();
      setChainId(chain);
    } catch (err: unknown) {
      setError((err as Error).message || "Network switch failed");
    }
  }, []);

  const disconnect = useCallback(() => {
    // MetaMask doesn't support programmatic disconnect — clear local state
    setAccount(null);
    setChainId(null);
  }, []);

  const shortAccount = account ? shortAddress(account) : "";

  return (
    <WalletContext.Provider
      value={{
        account,
        chainId,
        isConnected,
        isCorrectNetwork,
        isConnecting,
        error,
        connect,
        switchNetwork,
        disconnect,
        shortAccount,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  return useContext(WalletContext);
}
