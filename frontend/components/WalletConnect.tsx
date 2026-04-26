"use client";
// components/WalletConnect.tsx
// ================================================================
// Standalone wallet connect button — usable anywhere independently
// of the Navbar. The full wallet state lives in WalletContext.
// ================================================================

import { useWallet } from "../context/WalletContext";

interface WalletConnectProps {
  /** Show a compact pill variant instead of the full button */
  compact?: boolean;
}

export default function WalletConnect({ compact = false }: WalletConnectProps) {
  const {
    isConnected,
    isCorrectNetwork,
    isConnecting,
    shortAccount,
    connect,
    switchNetwork,
  } = useWallet();

  if (isConnected && isCorrectNetwork) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-stone-50 border border-stone-200">
        <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
        <span className="font-mono text-sm text-stone-700">{shortAccount}</span>
      </div>
    );
  }

  if (isConnected && !isCorrectNetwork) {
    return (
      <button
        className={`btn btn-danger ${compact ? "text-xs py-1.5 px-3" : "text-sm py-2 px-4"}`}
        onClick={switchNetwork}
      >
        Switch to Sepolia
      </button>
    );
  }

  return (
    <button
      className={`btn btn-primary ${compact ? "text-xs py-1.5 px-3" : "text-sm py-2 px-4"}`}
      onClick={connect}
      disabled={isConnecting}
    >
      {isConnecting ? (
        <span className="flex items-center gap-1.5">
          <svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          Connecting…
        </span>
      ) : compact ? (
        "Connect"
      ) : (
        "Connect Wallet"
      )}
    </button>
  );
}
