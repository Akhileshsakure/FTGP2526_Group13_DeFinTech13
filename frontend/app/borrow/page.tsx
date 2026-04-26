"use client";
// app/borrow/page.tsx
import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useWallet } from "../../context/WalletContext";
import TxButton from "../../components/TxButton";
import Toast, { useToast } from "../../components/Toast";
import {
  fetchAllMarkets,
  fetchUserPositions,
  fetchWalletBalance,
  borrowAsset,
  repayBorrow,
  formatUSD,
  formatAPY,
  formatHealthFactor,
  type MarketData,
  type AccountSummary,
} from "../../lib/protocol";
import { MARKETS } from "../../lib/contracts";

type Tab = "borrow" | "repay";

function BorrowInner() {
  const { account, isConnected, isCorrectNetwork } = useWallet();
  const searchParams = useSearchParams();
  const initialMarketId = searchParams.get("market") ?? MARKETS[0].id;

  const [tab, setTab] = useState<Tab>("borrow");
  const [selectedMarketId, setSelectedMarketId] = useState(initialMarketId);
  const [amount, setAmount] = useState("");
  const [repayFull, setRepayFull] = useState(false);
  const [markets, setMarkets] = useState<MarketData[]>([]);
  const [summary, setSummary] = useState<AccountSummary | null>(null);
  const [walletBalance, setWalletBalance] = useState<string>("0");
  const [loading, setLoading] = useState(true);
  const [txLoading, setTxLoading] = useState(false);
  const { toasts, addToast, removeToast } = useToast();

  const selectedMarket = MARKETS.find((m) => m.id === selectedMarketId) ?? MARKETS[0];
  const selectedMarketData = markets.find((m) => m.market.id === selectedMarketId);
  const userPosition = summary?.positions.find((p) => p.market.id === selectedMarketId);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const md = await fetchAllMarkets();
      setMarkets(md);
      if (account && isCorrectNetwork) {
        const s = await fetchUserPositions(account, md);
        setSummary(s);
        const bal = await fetchWalletBalance(account, selectedMarket);
        setWalletBalance(bal);
      }
    } catch (err: unknown) {
      addToast((err as Error).message, "error");
    } finally {
      setLoading(false);
    }
  }, [account, isCorrectNetwork, selectedMarketId]); // eslint-disable-line

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Max borrow = available liquidity in USD / asset price (rough estimate)
  const maxBorrowUSD = summary?.availableToBorrowUSD ?? 0;
  const maxBorrowAmount =
    selectedMarketData && selectedMarketData.priceUSD > 0
      ? (maxBorrowUSD / selectedMarketData.priceUSD) * 0.99 // 1% safety buffer
      : 0;

  const borrowed = parseFloat(userPosition?.borrowBalance ?? "0");
  const wallet = parseFloat(walletBalance);

  const handleMaxBorrow = () => setAmount(maxBorrowAmount.toFixed(6));
  const handleMaxRepay = () => {
    setAmount(borrowed.toFixed(6));
    setRepayFull(true);
  };

  const handleBorrow = async () => {
    if (!amount || parseFloat(amount) <= 0) return;
    setTxLoading(true);
    try {
      addToast("Confirm transaction in MetaMask…", "pending");
      const receipt = await borrowAsset(selectedMarket, amount);
      addToast("Borrow successful!", "success", receipt?.hash);
      setAmount("");
      await loadData();
    } catch (err: unknown) {
      addToast((err as Error).message ?? "Transaction failed", "error");
    } finally {
      setTxLoading(false);
    }
  };

  const handleRepay = async () => {
    if (!repayFull && (!amount || parseFloat(amount) <= 0)) return;
    setTxLoading(true);
    try {
      addToast("Confirm transaction in MetaMask…", "pending");
      const repayAmount = repayFull ? borrowed.toFixed(6) : amount;
      const receipt = await repayBorrow(selectedMarket, repayAmount, repayFull);
      addToast("Repay successful!", "success", receipt?.hash);
      setAmount("");
      setRepayFull(false);
      await loadData();
    } catch (err: unknown) {
      addToast((err as Error).message ?? "Transaction failed", "error");
    } finally {
      setTxLoading(false);
    }
  };

  // Simulate health factor change when borrowing more
  const simulatedBorrowUSD =
    amount && selectedMarketData
      ? parseFloat(amount) * selectedMarketData.priceUSD
      : 0;
  const simulatedTotalBorrow = (summary?.totalBorrowedUSD ?? 0) + simulatedBorrowUSD;
  const simulatedHF =
    simulatedTotalBorrow === 0
      ? Infinity
      : (summary?.totalSuppliedUSD ?? 0) * 0.75 / simulatedTotalBorrow;

  const hfColor =
    !isFinite(simulatedHF)
      ? "text-stone-400"
      : simulatedHF >= 2
      ? "text-emerald-600"
      : simulatedHF >= 1.2
      ? "text-amber-600"
      : "text-rose-500";

  return (
    <div className="fade-up max-w-xl mx-auto">
      {toasts.map((t) => (
        <Toast key={t.id} message={t.message} type={t.type} txHash={t.txHash} onClose={() => removeToast(t.id)} />
      ))}

      <div className="mb-6">
        <h1 className="font-display text-3xl text-stone-800 mb-1">Borrow</h1>
        <p className="text-stone-500 text-sm">
          Borrow against your collateral or repay existing loans
        </p>
      </div>

      {/* Market selector */}
      <div className="card p-1 flex gap-1 mb-5">
        {MARKETS.map((m) => (
          <button
            key={m.id}
            onClick={() => { setSelectedMarketId(m.id); setAmount(""); }}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded text-sm font-medium transition-all ${
              selectedMarketId === m.id
                ? "bg-stone-800 text-white shadow-sm"
                : "text-stone-500 hover:text-stone-800"
            }`}
          >
            <span className="text-base">{m.icon}</span>
            {m.symbol}
          </button>
        ))}
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <InfoCard
          label="Borrow APY"
          value={loading ? null : formatAPY(selectedMarketData?.borrowAPY ?? 0)}
          color="amber"
        />
        <InfoCard
          label="You Borrowed"
          value={loading ? null : `${borrowed.toFixed(4)} ${selectedMarket.symbol}`}
        />
        <InfoCard
          label="Health Factor"
          value={loading ? null : formatHealthFactor(summary?.healthFactor ?? Infinity)}
          color={
            !summary || !isFinite(summary.healthFactor)
              ? "stone"
              : summary.healthFactor >= 2
              ? "green"
              : summary.healthFactor >= 1.2
              ? "amber"
              : "red"
          }
        />
      </div>

      {/* Available to borrow */}
      {!loading && summary && (
        <div className="card p-3 mb-5 flex items-center justify-between bg-stone-50">
          <span className="text-xs text-stone-500">Available to borrow</span>
          <span className="font-mono text-sm text-stone-700">
            {formatUSD(summary.availableToBorrowUSD)}
            {selectedMarketData && (
              <span className="text-stone-400 text-xs ml-1">
                (~{maxBorrowAmount.toFixed(4)} {selectedMarket.symbol})
              </span>
            )}
          </span>
        </div>
      )}

      {/* Tab switcher */}
      <div className="flex gap-0.5 bg-stone-100 p-0.5 rounded-lg mb-5">
        {(["borrow", "repay"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); setAmount(""); setRepayFull(false); }}
            className={`flex-1 py-2 rounded-md text-sm font-medium capitalize transition-all ${
              tab === t ? "bg-white text-stone-800 shadow-sm" : "text-stone-500"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Amount input */}
      <div className="card p-5 mb-4">
        <div className="flex items-center justify-between mb-2">
          <label className="stat-label">
            {tab === "borrow" ? "Amount to Borrow" : "Amount to Repay"}
          </label>
          {tab === "borrow" ? (
            <button
              onClick={handleMaxBorrow}
              className="text-xs text-emerald-600 font-medium hover:text-emerald-700"
            >
              MAX: {maxBorrowAmount.toFixed(4)} {selectedMarket.symbol}
            </button>
          ) : (
            <button
              onClick={handleMaxRepay}
              className="text-xs text-emerald-600 font-medium hover:text-emerald-700"
            >
              REPAY ALL: {borrowed.toFixed(4)} {selectedMarket.symbol}
            </button>
          )}
        </div>

        {tab === "repay" && (
          <div className="flex items-center gap-2 mb-3">
            <input
              type="checkbox"
              id="repayFull"
              checked={repayFull}
              onChange={(e) => {
                setRepayFull(e.target.checked);
                if (e.target.checked) setAmount(borrowed.toFixed(6));
              }}
              className="rounded"
            />
            <label htmlFor="repayFull" className="text-xs text-stone-600 cursor-pointer">
              Repay full balance (including accrued interest)
            </label>
          </div>
        )}

        <div className="relative">
          <input
            type="number"
            className="input pr-20"
            placeholder="0.00"
            value={amount}
            onChange={(e) => { setAmount(e.target.value); setRepayFull(false); }}
            min="0"
            step="any"
            disabled={repayFull}
          />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 font-mono text-sm text-stone-500">
            {selectedMarket.symbol}
          </span>
        </div>

        {amount && selectedMarketData && (
          <div className="mt-2 text-xs text-stone-400 font-mono">
            ≈ {formatUSD(parseFloat(amount) * selectedMarketData.priceUSD)}
          </div>
        )}

        {/* Health factor simulation for borrow */}
        {tab === "borrow" && amount && parseFloat(amount) > 0 && summary && (
          <div className="mt-3 pt-3 border-t border-stone-100">
            <div className="flex justify-between text-xs">
              <span className="text-stone-500">Projected health factor</span>
              <span className={`font-mono font-medium ${hfColor}`}>
                {formatHealthFactor(simulatedHF)}
                {simulatedHF < 1.2 && " ⚠"}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Action button */}
      {!isConnected ? (
        <div className="text-center text-stone-400 text-sm py-4">
          Connect your wallet to continue
        </div>
      ) : !isCorrectNetwork ? (
        <div className="text-center text-amber-600 text-sm py-4">
          Switch to Sepolia to continue
        </div>
      ) : tab === "borrow" ? (
        <>
          {maxBorrowUSD === 0 && !loading && (
            <div className="mb-3 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg p-3">
              ⚠ You need to supply and enable collateral before borrowing.
            </div>
          )}
          <TxButton
            label={`Borrow ${selectedMarket.symbol}`}
            pendingLabel="Borrowing…"
            onClick={handleBorrow}
            loading={txLoading}
            disabled={
              !amount ||
              parseFloat(amount) <= 0 ||
              parseFloat(amount) > maxBorrowAmount ||
              maxBorrowUSD === 0
            }
          />
        </>
      ) : (
        <>
          {borrowed === 0 && !loading && (
            <div className="mb-3 text-xs text-stone-500 bg-stone-50 border border-stone-100 rounded-lg p-3">
              You have no outstanding debt in {selectedMarket.symbol}.
            </div>
          )}
          <TxButton
            label={`Repay ${selectedMarket.symbol}`}
            pendingLabel="Repaying…"
            onClick={handleRepay}
            loading={txLoading}
            disabled={
              borrowed === 0 ||
              (!repayFull && (!amount || parseFloat(amount) <= 0))
            }
            variant="outline"
          />
        </>
      )}

      {isConnected && isCorrectNetwork && (
        <div className="mt-4 text-center text-xs text-stone-400">
          Wallet balance:{" "}
          <span className="font-mono">{wallet.toFixed(6)} {selectedMarket.symbol}</span>
        </div>
      )}
    </div>
  );
}

function InfoCard({
  label,
  value,
  color = "stone",
}: {
  label: string;
  value: string | null;
  color?: "green" | "amber" | "red" | "stone";
}) {
  const colorClass = {
    green: "text-emerald-600",
    amber: "text-amber-600",
    red: "text-rose-500",
    stone: "text-stone-700",
  }[color];

  return (
    <div className="card p-3 text-center">
      <div className="stat-label mb-1">{label}</div>
      {value === null ? (
        <div className="skeleton h-4 w-3/4 mx-auto mt-1" />
      ) : (
        <div className={`text-sm font-medium font-mono ${colorClass}`}>{value}</div>
      )}
    </div>
  );
}

// ── Default export: Suspense wrapper (required by Next.js 14 for useSearchParams) ──
function BorrowPageSkeleton() {
  return (
    <div className="fade-up max-w-xl mx-auto">
      <div className="skeleton h-9 w-28 mb-2 rounded" />
      <div className="skeleton h-4 w-64 mb-8 rounded" />
      <div className="card p-1 flex gap-1 mb-5">
        {[1, 2, 3].map((i) => <div key={i} className="skeleton flex-1 h-10 rounded" />)}
      </div>
      <div className="grid grid-cols-3 gap-3 mb-5">
        {[1, 2, 3].map((i) => <div key={i} className="card p-3 h-16 rounded" style={{background:"#f5f5f4"}} />)}
      </div>
      <div className="skeleton h-8 w-full mb-5 rounded" />
      <div className="skeleton h-28 w-full mb-4 rounded" />
      <div className="skeleton h-12 w-full rounded" />
    </div>
  );
}

export default function BorrowPage() {
  return (
    <Suspense fallback={<BorrowPageSkeleton />}>
      <BorrowInner />
    </Suspense>
  );
}
