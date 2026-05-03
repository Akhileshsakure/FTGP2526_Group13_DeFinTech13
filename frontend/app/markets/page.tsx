"use client";
// app/markets/page.tsx
import { useEffect, useState } from "react";
import { useWallet } from "../../context/WalletContext";
import MarketCard from "../../components/MarketCard";
import CryptoIcon from "../../components/CryptoIcon";
import MarketPriceChart, { type PurchaseMarker } from "../../components/MarketPriceChart";
import {
  fetchCachedAllMarkets,
  fetchCachedMarketPriceHistory,
  fetchUserPositions,
  getTransactionErrorMessage,
  type MarketData,
  type AccountSummary,
  type PricePoint,
} from "../../lib/protocol";
import { fetchUserTransactions, type UserTransaction } from "../../lib/transactions";

export default function MarketsPage() {
  const { account, isConnected, isCorrectNetwork } = useWallet();
  const [markets, setMarkets] = useState<MarketData[]>([]);
  const [summary, setSummary] = useState<AccountSummary | null>(null);
  const [priceHistoryByMarket, setPriceHistoryByMarket] = useState<Record<string, PricePoint[]>>({});
  const [purchaseMarkersByMarket, setPurchaseMarkersByMarket] = useState<Record<string, PurchaseMarker[]>>({});
  const [selectedMarketId, setSelectedMarketId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [positionError, setPositionError] = useState<string | null>(null);
  const [marketUpdatedAt, setMarketUpdatedAt] = useState<number | null>(null);
  const [priceUpdatedAt, setPriceUpdatedAt] = useState<number | null>(null);

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
        const histories = await Promise.all(
          md.map(async (marketData) => [
            marketData.market.id,
            await fetchCachedMarketPriceHistory(marketData),
          ] as const)
        );
        const historyMap = Object.fromEntries(histories.map(([id, result]) => [id, result.data]));
        setPriceHistoryByMarket(historyMap);
        setPriceUpdatedAt(histories[0]?.[1].updatedAt ?? null);

        if (account && isCorrectNetwork) {
          try {
            const s = await fetchUserPositions(account, md);
            setSummary(s);
            try {
              const txs = await fetchUserTransactions(account);
              setPurchaseMarkersByMarket(buildPurchaseMarkers(md, historyMap, txs));
            } catch {
              setPurchaseMarkersByMarket({});
            }
          } catch {
            setSummary(null);
            setPurchaseMarkersByMarket({});
            setPositionError(
              "Wallet positions could not be loaded yet. Market data is still available."
            );
          }
        } else {
          setSummary(null);
          setPurchaseMarkersByMarket({});
        }
      } catch (err: unknown) {
        setError(getTransactionErrorMessage(err));
        setMarkets([]);
        setSummary(null);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [account, isCorrectNetwork]);

  const selectedMarket = markets.find((marketData) => marketData.market.id === selectedMarketId);
  const selectedPosition = summary?.positions.find(
    (position) => position.market.id === selectedMarket?.market.id
  );

  return (
    <div className="fade-up">
      <div className="mb-8">
        <h1 className="font-display text-3xl text-stone-800 mb-1">Markets</h1>
        {(marketUpdatedAt || priceUpdatedAt) && (
          <p className="text-xs text-stone-400 mb-1">
            Market data updated {marketUpdatedAt ? formatUpdatedAt(marketUpdatedAt) : "-"}; price history updated{" "}
            {priceUpdatedAt ? formatUpdatedAt(priceUpdatedAt) : "-"}; cached for 15 seconds.
          </p>
        )}
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

      {positionError && !error && (
        <div className="card p-4 border-amber-200 bg-amber-50 text-amber-700 text-sm mb-6">
          {positionError}
          <br />
          <span className="opacity-70 text-xs">
            This usually happens just after redeploying contracts or before every market has an oracle price.
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
        <>
          {selectedMarket && (
            <div className="mb-6">
              <MarketDetail
                data={selectedMarket}
                history={priceHistoryByMarket[selectedMarket.market.id] ?? []}
                markers={purchaseMarkersByMarket[selectedMarket.market.id] ?? []}
                userSupply={selectedPosition?.supplyBalanceUSD}
                userBorrow={selectedPosition?.borrowBalanceUSD}
              />
            </div>
          )}

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {markets.map((md) => {
              const pos = summary?.positions.find((p) => p.market.id === md.market.id);
              const markers = purchaseMarkersByMarket[md.market.id] ?? [];
              return (
                <MarketCard
                  key={md.market.id}
                  data={md}
                  userSupply={pos?.supplyBalanceUSD}
                  userBorrow={pos?.borrowBalanceUSD}
                  purchasePrice={markers[0]?.priceUSD}
                  onViewMarket={() => setSelectedMarketId(md.market.id)}
                />
              );
            })}
          </div>
        </>
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

function MarketDetail({
  data,
  history,
  markers,
  userSupply,
  userBorrow,
}: {
  data: MarketData;
  history: PricePoint[];
  markers: PurchaseMarker[];
  userSupply?: number;
  userBorrow?: number;
}) {
  return (
    <div className="grid lg:grid-cols-[1fr_280px] gap-4">
      <MarketPriceChart marketData={data} priceHistory={history} markers={markers} />
      <div className="card p-5">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-full bg-stone-50 flex items-center justify-center">
            <CryptoIcon symbol={data.market.symbol} size={30} />
          </div>
          <div>
            <div className="font-medium text-stone-800">{data.market.symbol}</div>
            <div className="text-xs text-stone-400">{data.market.name}</div>
          </div>
        </div>
        <div className="space-y-3 text-sm">
          <Detail label="Oracle price" value={data.priceUSD.toLocaleString(undefined, { style: "currency", currency: "USD" })} />
          <Detail label="Your supply" value={(userSupply ?? 0).toLocaleString(undefined, { style: "currency", currency: "USD" })} />
          <Detail label="Your borrow" value={(userBorrow ?? 0).toLocaleString(undefined, { style: "currency", currency: "USD" })} />
          <Detail label="LTV" value={`${data.collateralFactor.toFixed(0)}%`} />
          <Detail label="Liquidation threshold" value={`${data.liquidationThreshold.toFixed(0)}%`} />
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-stone-100 pb-2 last:border-b-0">
      <span className="text-stone-500">{label}</span>
      <span className="font-mono text-stone-700 text-right">{value}</span>
    </div>
  );
}

function buildPurchaseMarkers(
  markets: MarketData[],
  historyMap: Record<string, PricePoint[]>,
  transactions: UserTransaction[]
): Record<string, PurchaseMarker[]> {
  const result: Record<string, PurchaseMarker[]> = {};

  for (const tx of transactions) {
    if (tx.type !== "Supply" || !tx.timestamp) continue;

    const marketData = markets.find((md) => md.market.id === tx.market.id);
    if (!marketData) continue;

    const history = historyMap[marketData.market.id] ?? [];
    const pricePoint = findPriceAt(history, tx.timestamp) ?? {
      timestamp: tx.timestamp,
      priceUSD: marketData.priceUSD,
    };

    result[marketData.market.id] = [
      ...(result[marketData.market.id] ?? []),
      {
        id: tx.id,
        timestamp: tx.timestamp,
        priceUSD: pricePoint.priceUSD,
        amount: tx.amount,
      },
    ];
  }

  return result;
}

function formatUpdatedAt(timestamp: number): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(timestamp));
}

function findPriceAt(history: PricePoint[], timestamp: number): PricePoint | null {
  if (history.length === 0) return null;

  return (
    [...history]
      .reverse()
      .find((point) => point.timestamp <= timestamp) ?? history[0]
  );
}
