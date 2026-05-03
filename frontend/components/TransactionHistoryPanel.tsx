"use client";

import { useEffect, useState } from "react";
import { useWallet } from "../context/WalletContext";
import {
  etherscanTxUrl,
  fetchCachedUserTransactions,
  formatHash,
  formatTransactionDate,
  type UserTransaction,
} from "../lib/transactions";

const TYPE_STYLES: Record<UserTransaction["type"], string> = {
  Supply: "badge-green",
  Withdraw: "badge-stone",
  Borrow: "badge-amber",
  Repay: "badge-green",
  "Enable Collateral": "badge-green",
  "Disable Collateral": "badge-amber",
};

function getTransactionLoadError(error: unknown): string {
  const message = (error as Error).message || "Could not load transaction history";

  if (
    message.includes("compute units") ||
    message.includes("rate limited") ||
    message.includes("429") ||
    message.includes("10 block range") ||
    message.includes("expanded block range")
  ) {
    return "The RPC provider limited transaction history. Refresh in a few seconds or reduce NEXT_PUBLIC_TX_HISTORY_BLOCKS in .env.local.";
  }

  return message;
}

export default function TransactionHistoryPanel({ compact = false }: { compact?: boolean }) {
  const { account, isConnected, isCorrectNetwork } = useWallet();
  const [transactions, setTransactions] = useState<UserTransaction[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!account || !isCorrectNetwork) {
        setTransactions([]);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const result = await fetchCachedUserTransactions(account);
        setTransactions(result.data);
        setUpdatedAt(result.updatedAt);
      } catch (err: unknown) {
        setError(getTransactionLoadError(err));
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [account, isCorrectNetwork]);

  if (!isConnected) {
    return (
      <div className="card p-8 text-center">
        <div className="font-display text-xl mb-2 text-stone-400">Connect your wallet</div>
        <p className="text-stone-500 text-sm">Connect MetaMask to view your personal transaction history.</p>
      </div>
    );
  }

  if (!isCorrectNetwork) {
    return (
      <div className="card p-8 text-center border-amber-200 bg-amber-50">
        <div className="font-display text-xl mb-1 text-amber-700">Wrong Network</div>
        <p className="text-amber-600 text-sm">Switch to Sepolia testnet to continue.</p>
      </div>
    );
  }

  const visibleTransactions = compact ? transactions.slice(0, 6) : transactions;

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3 border-b border-stone-100 flex items-center justify-between gap-3">
        <span className="font-medium text-sm text-stone-700">Transactions</span>
        <span className="text-xs text-stone-400">
          {transactions.length} found
          {updatedAt ? ` - updated ${formatUpdatedAt(updatedAt)}` : ""}
        </span>
      </div>

      {error && (
        <div className="m-5 card p-4 border-rose-200 bg-rose-50 text-rose-700 text-sm">
          Failed to load transactions: {error}
        </div>
      )}

      {loading ? (
        <div className="divide-y divide-stone-100">
          {[1, 2, 3].map((item) => (
            <div key={item} className="px-5 py-4">
              <div className="flex items-center gap-4">
                <div className="skeleton h-6 w-20" />
                <div className="flex-1">
                  <div className="skeleton h-4 w-36 mb-2" />
                  <div className="skeleton h-3 w-48" />
                </div>
                <div className="skeleton h-4 w-24" />
              </div>
            </div>
          ))}
        </div>
      ) : transactions.length === 0 && !error ? (
        <div className="px-5 py-10 text-center">
          <div className="font-display text-xl text-stone-400 mb-2">No transactions yet</div>
          <p className="text-stone-500 text-sm">Supply, borrow, repay, or change collateral settings to create records here.</p>
        </div>
      ) : (
        <div className="divide-y divide-stone-100">
          {visibleTransactions.map((tx) => {
            const expanded = expandedId === tx.id;
            return (
              <div key={tx.id}>
                <button
                  type="button"
                  className="w-full px-5 py-4 text-left hover:bg-stone-50 transition-colors"
                  onClick={() => setExpandedId(expanded ? null : tx.id)}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <span className={`badge ${TYPE_STYLES[tx.type]} w-fit`}>{tx.type}</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm text-stone-800">
                        {tx.market.symbol}
                        {tx.amount ? ` - ${tx.amount}` : ""}
                      </div>
                      <div className="font-mono text-xs text-stone-400 truncate">
                        {formatHash(tx.transactionHash)} - Block {tx.blockNumber}
                      </div>
                    </div>
                    <div className="text-xs text-stone-500 sm:text-right">
                      {formatTransactionDate(tx.timestamp)}
                    </div>
                  </div>
                </button>

                {expanded && <TransactionDetails tx={tx} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatUpdatedAt(timestamp: number): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(timestamp));
}

function TransactionDetails({ tx }: { tx: UserTransaction }) {
  return (
    <div className="px-5 pb-5 bg-stone-50 border-t border-stone-100">
      <div className="grid md:grid-cols-2 gap-3 pt-4">
        <Detail label="Amount" value={tx.amount ?? "Not applicable"} />
        <Detail label="cToken Amount" value={tx.tokenAmount ?? "Not applicable"} />
        <Detail label="User Address" value={tx.userAddress} mono />
        <Detail label="Payer Address" value={tx.counterpartyAddress ?? "Not applicable"} mono />
        <Detail label="Wallet From" value={tx.from ?? "Unknown"} mono />
        <Detail label="Wallet To" value={tx.to ?? "Unknown"} mono />
        <Detail label="Contract Address" value={tx.contractAddress} mono />
        <Detail label="Transaction Value" value={tx.value ?? "0 ETH"} />
        <Detail label="Gas Used" value={tx.gasUsed ?? "Unknown"} />
        <Detail label="Status" value={tx.status === 1 ? "Success" : tx.status === 0 ? "Failed" : "Unknown"} />
        <Detail label="Block Number" value={String(tx.blockNumber)} />
        <div className="rounded border border-stone-200 bg-white p-3 md:col-span-2">
          <div className="stat-label mb-1">Transaction Hash</div>
          <a
            href={etherscanTxUrl(tx.transactionHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-xs text-emerald-700 break-all hover:underline"
          >
            {tx.transactionHash}
          </a>
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded border border-stone-200 bg-white p-3">
      <div className="stat-label mb-1">{label}</div>
      <div className={`${mono ? "font-mono text-xs break-all" : "text-sm"} text-stone-700`}>{value}</div>
    </div>
  );
}
