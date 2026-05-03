"use client";
// app/page.tsx — Dashboard
import { useEffect, useState } from "react";
import Link from "next/link";
import TransactionHistoryPanel from "../../components/TransactionHistoryPanel";
import { useWallet } from "../../context/WalletContext";
import {
  fetchCachedAllMarkets,
  fetchUserPositions,
  formatUSD,
  formatAPY,
  formatHealthFactor,
  formatTokenSmart,
  type MarketData,
  type AccountSummary,
} from "../../lib/protocol";

export default function Dashboard() {
  const { account, isConnected, isCorrectNetwork } = useWallet();

  const [markets, setMarkets] = useState<MarketData[]>([]);
  const [summary, setSummary] = useState<AccountSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [positionError, setPositionError] = useState<string | null>(null);
  const [marketUpdatedAt, setMarketUpdatedAt] = useState<number | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      setPositionError(null);
      try {
        const cachedMarkets = await fetchCachedAllMarkets();
        const md = cachedMarkets.data;
        setMarkets(md);
        setMarketUpdatedAt(cachedMarkets.updatedAt);
        if (account && isCorrectNetwork) {
          try {
            const s = await fetchUserPositions(account, md);
            setSummary(s);
          } catch {
            setSummary(null);
            setPositionError("Wallet positions could not be loaded yet. Market data is still available.");
          }
        } else {
          setSummary(null);
        }
      } catch (err: unknown) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [account, isCorrectNetwork]);

  const healthColor =
    !summary || !isFinite(summary.healthFactor)
      ? "text-stone-400"
      : summary.healthFactor >= 2
      ? "text-emerald-600"
      : summary.healthFactor >= 1.2
      ? "text-amber-600"
      : "text-rose-500";

  return (
    <div className="fade-up">
      {/* Page header */}
      <div className="mb-8">
        <h1 className="font-display text-3xl text-stone-800 mb-1">Dashboard</h1>
        <p className="text-stone-500 text-sm">
          Your lending & borrowing positions on the DeFi protocol
        </p>
        {marketUpdatedAt && (
          <p className="text-xs text-stone-400 mt-1">
            Market data updated {formatUpdatedAt(marketUpdatedAt)}; public metrics are cached for 15 seconds.
          </p>
        )}
      </div>

      {/* Wallet gate */}
      {!isConnected && (
        <div className="card p-10 text-center">
          <div className="font-display text-2xl mb-2 text-stone-400">
            Connect your wallet
          </div>
          <p className="text-stone-500 text-sm">
            Connect MetaMask to see your positions and start lending.
          </p>
        </div>
      )}

      {isConnected && !isCorrectNetwork && (
        <div className="card p-8 text-center border-amber-200 bg-amber-50">
          <div className="font-display text-xl mb-1 text-amber-700">Wrong Network</div>
          <p className="text-amber-600 text-sm">Switch to Sepolia testnet to continue.</p>
        </div>
      )}

      {isConnected && isCorrectNetwork && (
        <>
          {/* Portfolio summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
            <SummaryCard
              label="Total Supplied"
              value={loading ? null : formatUSD(summary?.totalSuppliedUSD ?? 0)}
              accent="green"
            />
            <SummaryCard
              label="Total Borrowed"
              value={loading ? null : formatUSD(summary?.totalBorrowedUSD ?? 0)}
              accent="amber"
            />
            <SummaryCard
              label="Net APY"
              value={loading ? null : formatAPY(summary?.netAPY ?? 0)}
              accent="green"
            />
            <div className="card p-4">
              <div className="stat-label mb-1">Health Factor</div>
              {loading ? (
                <div className="skeleton h-7 w-16 mt-1" />
              ) : (
                <div className={`stat-value ${healthColor}`}>
                  {formatHealthFactor(summary?.healthFactor ?? Infinity)}
                </div>
              )}
              {!loading && summary && isFinite(summary.healthFactor) && (
                <div className="text-xs text-stone-400 mt-1">
                  {summary.healthFactor < 1.2 ? "⚠ At risk" : "Safe"}
                </div>
              )}
            </div>
          </div>

          {/* Available to borrow */}
          {!loading && summary && summary.availableToBorrowUSD > 0 && (
            <div className="card p-4 mb-6 flex items-center justify-between bg-emerald-50 border-emerald-100">
              <div>
                <div className="text-sm font-medium text-emerald-800">
                  Available to borrow
                </div>
                <div className="font-mono text-lg text-emerald-700">
                  {formatUSD(summary.availableToBorrowUSD)}
                </div>
              </div>
              <Link href="/borrow" className="btn btn-primary text-sm py-2">
                Borrow →
              </Link>
            </div>
          )}

          {/* Positions table */}
          {error && (
            <div className="card p-4 border-rose-200 bg-rose-50 text-rose-700 text-sm mb-6">
              Failed to load data: {error}
            </div>
          )}

          {positionError && !error && (
            <div className="card p-4 border-amber-200 bg-amber-50 text-amber-700 text-sm mb-6">
              {positionError}
            </div>
          )}

          <div className="card overflow-hidden">
            <div className="px-5 py-3 border-b border-stone-100">
              <span className="font-medium text-sm text-stone-700">Your Positions</span>
            </div>
            <div className="divide-y divide-stone-100">
              {loading
                ? [1, 2, 3].map((i) => (
                    <div key={i} className="px-5 py-4 flex items-center gap-4">
                      <div className="skeleton w-8 h-8 rounded-full" />
                      <div className="flex-1">
                        <div className="skeleton h-3.5 w-24 mb-2" />
                        <div className="skeleton h-3 w-16" />
                      </div>
                      <div className="skeleton h-5 w-20" />
                    </div>
                  ))
                : summary?.positions.map((pos) => {
                    const hasActivity =
                      parseFloat(pos.supplyBalanceUnderlying) > 0 ||
                      parseFloat(pos.borrowBalance) > 0;
                    return (
                      <div
                        key={pos.market.id}
                        className={`px-5 py-4 flex items-center gap-4 ${
                          !hasActivity ? "opacity-40" : ""
                        }`}
                      >
                        <div className="w-8 h-8 rounded-full bg-stone-100 flex items-center justify-center text-stone-600 font-display">
                          {pos.market.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm text-stone-800">
                            {pos.market.symbol}
                          </div>
                          <div className="text-xs text-stone-400">{pos.market.name}</div>
                        </div>
                        <div className="text-right">
                          {parseFloat(pos.supplyBalanceUnderlying) > 0 && (
                            <div className="text-sm">
                              <span className="text-emerald-600 font-mono">
                                +{formatTokenSmart(pos.supplyBalanceUnderlying, pos.market.symbol)}
                              </span>
                              <span className="text-stone-400 text-xs ml-1">supplied</span>
                            </div>
                          )}
                          {parseFloat(pos.borrowBalance) > 0 && (
                            <div className="text-sm">
                              <span className="text-amber-600 font-mono">
                                -{formatTokenSmart(pos.borrowBalance, pos.market.symbol)}
                              </span>
                              <span className="text-stone-400 text-xs ml-1">borrowed</span>
                            </div>
                          )}
                          {!hasActivity && (
                            <span className="text-xs text-stone-400">No position</span>
                          )}
                        </div>
                        <div className="hidden sm:flex gap-2">
                          <Link
                            href={`/supply?market=${pos.market.id}`}
                            className="btn btn-outline text-xs py-1 px-3"
                          >
                            Supply
                          </Link>
                          {parseFloat(pos.borrowBalance) > 0 && (
                            <Link
                              href={`/borrow?market=${pos.market.id}`}
                              className="btn btn-ghost text-xs py-1 px-3"
                            >
                              Repay
                            </Link>
                          )}
                        </div>
                      </div>
                    );
                  })}
            </div>
          </div>

          <div className="mt-8">
            <TransactionHistoryPanel compact />
          </div>
        </>
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

function SummaryCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | null;
  accent: "green" | "amber" | "red";
}) {
  const accentColor = {
    green: "text-emerald-600",
    amber: "text-amber-600",
    red: "text-rose-500",
  }[accent];

  return (
    <div className="card p-4">
      <div className="stat-label mb-1">{label}</div>
      {value === null ? (
        <div className="skeleton h-7 w-24 mt-1" />
      ) : (
        <div className={`stat-value ${accentColor}`}>{value}</div>
      )}
    </div>
  );
}
