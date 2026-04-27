"use client";
// app/markets/page.tsx
import { useEffect, useState } from "react";
import { useWallet } from "../../context/WalletContext";
import MarketCard from "../../components/MarketCard";
import {
  fetchAllMarkets,
  fetchUserPositions,
  getTransactionErrorMessage,
  type MarketData,
  type AccountSummary,
} from "../../lib/protocol";

export default function MarketsPage() {
  const { account, isConnected, isCorrectNetwork } = useWallet();
  const [markets, setMarkets] = useState<MarketData[]>([]);
  const [summary, setSummary] = useState<AccountSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const md = await fetchAllMarkets();
        setMarkets(md);
        if (account && isCorrectNetwork) {
          const s = await fetchUserPositions(account, md);
          setSummary(s);
        }
      } catch (err: unknown) {
        setError(getTransactionErrorMessage(err));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [account, isCorrectNetwork]);

  return (
    <div className="fade-up">
      <div className="mb-8">
        <h1 className="font-display text-3xl text-stone-800 mb-1">Markets</h1>
        <p className="text-stone-500 text-sm">
          All available lending markets — supply to earn interest or borrow against collateral
        </p>
      </div>

      {error && (
        <div className="card p-4 border-rose-200 bg-rose-50 text-rose-700 text-sm mb-6">
          Could not load market data: {error}
          <br />
          <span className="opacity-70 text-xs">
            Check that your contract addresses are set in .env.local
          </span>
        </div>
      )}

      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="card p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="skeleton w-9 h-9 rounded-full" />
                <div>
                  <div className="skeleton h-4 w-12 mb-1" />
                  <div className="skeleton h-3 w-20" />
                </div>
              </div>
              <div className="skeleton h-px w-full mb-4" />
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="skeleton h-8 w-full" />
                <div className="skeleton h-8 w-full" />
              </div>
              <div className="skeleton h-3 w-full mb-4" />
              <div className="skeleton h-8 w-full" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {markets.map((md) => {
            const pos = summary?.positions.find((p) => p.market.id === md.market.id);
            return (
              <MarketCard
                key={md.market.id}
                data={md}
                userSupply={pos?.supplyBalanceUSD}
                userBorrow={pos?.borrowBalanceUSD}
              />
            );
          })}
        </div>
      )}

      {/* Protocol stats footer */}
      {!loading && markets.length > 0 && (
        <div className="mt-8 card p-5">
          <div className="stat-label mb-3">Protocol Overview</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
            <div>
              <div className="stat-label mb-1">Markets</div>
              <div className="font-mono text-lg text-stone-700">{markets.length}</div>
            </div>
            <div>
              <div className="stat-label mb-1">Total Value Locked</div>
              <div className="font-mono text-lg text-stone-700">
                $
                {markets
                  .reduce(
                    (s, m) => s + parseFloat(m.totalSupply) * m.priceUSD,
                    0
                  )
                  .toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>
            </div>
            <div>
              <div className="stat-label mb-1">Total Borrowed</div>
              <div className="font-mono text-lg text-stone-700">
                $
                {markets
                  .reduce(
                    (s, m) => s + parseFloat(m.totalBorrows) * m.priceUSD,
                    0
                  )
                  .toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>
            </div>
            <div>
              <div className="stat-label mb-1">Avg. Borrow APY</div>
              <div className="font-mono text-lg text-stone-700">
                {(
                  markets.reduce((s, m) => s + m.borrowAPY, 0) / markets.length
                ).toFixed(2)}
                %
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
