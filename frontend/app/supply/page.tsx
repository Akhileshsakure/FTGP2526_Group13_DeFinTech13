"use client";
// app/supply/page.tsx
// NOTE: useSearchParams() requires a <Suspense> boundary in Next.js 14.
// The default export wraps SupplyInner in Suspense to satisfy this requirement.
import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useWallet } from "../../context/WalletContext";
import TxButton from "../../components/TxButton";
import Toast, { useToast } from "../../components/Toast";
import {
  fetchAllMarkets,
  fetchUserPositions,
  fetchWalletBalance,
  supplyAsset,
  redeemAsset,
  enterMarket,
  exitMarket,
  formatUSD,
  formatAPY,
  formatTokenSmart,
  type MarketData,
  type AccountSummary,
} from "../../lib/protocol";
import { MARKETS } from "../../lib/contracts";

type Tab = "supply" | "redeem";

function SupplyInner() {
  const { account, isConnected, isCorrectNetwork } = useWallet();
  const searchParams = useSearchParams();
  const initialMarketId = searchParams.get("market") ?? MARKETS[0].id;

  const [tab, setTab] = useState<Tab>("supply");
  const [selectedMarketId, setSelectedMarketId] = useState(initialMarketId);
  const [amount, setAmount] = useState("");
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

  const handleMaxSupply = () => setAmount(walletBalance);
  const handleMaxRedeem = () =>
    setAmount(userPosition?.supplyBalanceUnderlying ?? "0");

  const handleSupply = async () => {
    if (!amount || parseFloat(amount) <= 0) return;
    setTxLoading(true);
    try {
      addToast("Confirm transaction in MetaMask…", "pending");
      const receipt = await supplyAsset(selectedMarket, amount);
      addToast("Supply successful!", "success", receipt?.hash);
      setAmount("");
      await loadData();
    } catch (err: unknown) {
      addToast((err as Error).message ?? "Transaction failed", "error");
    } finally {
      setTxLoading(false);
    }
  };

  const handleRedeem = async () => {
    if (!amount || parseFloat(amount) <= 0) return;
    setTxLoading(true);
    try {
      addToast("Confirm transaction in MetaMask…", "pending");
      const receipt = await redeemAsset(selectedMarket, amount);
      addToast("Redeem successful!", "success", receipt?.hash);
      setAmount("");
      await loadData();
    } catch (err: unknown) {
      addToast((err as Error).message ?? "Transaction failed", "error");
    } finally {
      setTxLoading(false);
    }
  };

  const handleToggleCollateral = async () => {
    if (!userPosition) return;
    setTxLoading(true);
    try {
      if (userPosition.isCollateral) {
        addToast("Removing from collateral…", "pending");
        await exitMarket(selectedMarket.cTokenAddress);
        addToast("Removed from collateral", "success");
      } else {
        addToast("Enabling as collateral…", "pending");
        await enterMarket(selectedMarket.cTokenAddress);
        addToast("Enabled as collateral", "success");
      }
      await loadData();
    } catch (err: unknown) {
      addToast((err as Error).message ?? "Transaction failed", "error");
    } finally {
      setTxLoading(false);
    }
  };

  const supplied = parseFloat(userPosition?.supplyBalanceUnderlying ?? "0");
  const wallet = parseFloat(walletBalance);

  return (
    <div className="fade-up max-w-xl mx-auto">
      {/* Toasts */}
      {toasts.map((t) => (
        <Toast key={t.id} message={t.message} type={t.type} txHash={t.txHash} onClose={() => removeToast(t.id)} />
      ))}

      <div className="mb-6">
        <h1 className="font-display text-3xl text-stone-800 mb-1">Supply</h1>
        <p className="text-stone-500 text-sm">Deposit assets to earn interest and use as collateral</p>
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
          label="Supply APY"
          value={loading ? null : formatAPY(selectedMarketData?.supplyAPY ?? 0)}
          color="green"
        />
        <InfoCard
          label="Your Supply"
          value={loading ? null : formatTokenSmart(userPosition?.supplyBalanceUnderlying ?? "0", selectedMarket.symbol)}
        />
        <InfoCard
          label="Collateral"
          value={loading ? null : userPosition?.isCollateral ? "Enabled" : "Disabled"}
          color={userPosition?.isCollateral ? "green" : "stone"}
        />
      </div>

      {/* Tab switcher */}
      <div className="flex gap-0.5 bg-stone-100 p-0.5 rounded-lg mb-5">
        {(["supply", "redeem"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); setAmount(""); }}
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
          <label className="stat-label">{tab === "supply" ? "Amount to Supply" : "Amount to Redeem"}</label>
          <button
            onClick={tab === "supply" ? handleMaxSupply : handleMaxRedeem}
            className="text-xs text-emerald-600 font-medium hover:text-emerald-700"
          >
            MAX:{" "}
            {tab === "supply"
              ? formatTokenSmart(wallet, selectedMarket.symbol)
              : formatTokenSmart(userPosition?.supplyBalanceUnderlying ?? "0", selectedMarket.symbol)}
          </button>
        </div>
        <div className="relative">
          <input
            type="number"
            className="input pr-20"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            min="0"
            step="any"
          />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 font-mono text-sm text-stone-500">
            {selectedMarket.symbol}
          </span>
        </div>

        {/* USD estimate */}
        {amount && selectedMarketData && (
          <div className="mt-2 text-xs text-stone-400 font-mono">
            ≈ {formatUSD(parseFloat(amount) * selectedMarketData.priceUSD)}
          </div>
        )}
      </div>

      {/* Gate: wallet not connected */}
      {!isConnected ? (
        <div className="text-center text-stone-400 text-sm py-4">
          Connect your wallet to continue
        </div>
      ) : !isCorrectNetwork ? (
        <div className="text-center text-amber-600 text-sm py-4">
          Switch to Sepolia to continue
        </div>
      ) : tab === "supply" ? (
        <TxButton
          label={`Supply ${selectedMarket.symbol}`}
          pendingLabel="Supplying…"
          onClick={handleSupply}
          loading={txLoading}
          disabled={!amount || parseFloat(amount) <= 0 || parseFloat(amount) > wallet}
        />
      ) : (
        <TxButton
          label={`Redeem ${selectedMarket.symbol}`}
          pendingLabel="Redeeming…"
          onClick={handleRedeem}
          loading={txLoading}
          disabled={!amount || parseFloat(amount) <= 0 || parseFloat(amount) > supplied}
          variant="outline"
        />
      )}

      {/* Collateral toggle */}
      {isConnected && isCorrectNetwork && supplied > 0 && (
        <div className="mt-4 card p-4 flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-stone-700">Use as Collateral</div>
            <div className="text-xs text-stone-400 mt-0.5">
              Collateral factor:{" "}
              {selectedMarketData?.collateralFactor.toFixed(0) ?? "—"}%
            </div>
          </div>
          <button
            onClick={handleToggleCollateral}
            disabled={txLoading}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              userPosition?.isCollateral ? "bg-emerald-500" : "bg-stone-200"
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                userPosition?.isCollateral ? "translate-x-4.5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      )}

      {/* Wallet info */}
      {isConnected && isCorrectNetwork && (
        <div className="mt-4 text-center text-xs text-stone-400">
          Wallet balance:{" "}
          <span className="font-mono">{formatTokenSmart(wallet, selectedMarket.symbol, 6)}</span>
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
  color?: "green" | "amber" | "stone";
}) {
  const colorClass = {
    green: "text-emerald-600",
    amber: "text-amber-600",
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
function SupplyPageSkeleton() {
  return (
    <div className="fade-up max-w-xl mx-auto">
      <div className="skeleton h-9 w-32 mb-2 rounded" />
      <div className="skeleton h-4 w-56 mb-8 rounded" />
      <div className="card p-1 flex gap-1 mb-5">
        {[1, 2, 3].map((i) => <div key={i} className="skeleton flex-1 h-10 rounded" />)}
      </div>
      <div className="grid grid-cols-3 gap-3 mb-5">
        {[1, 2, 3].map((i) => <div key={i} className="card p-3 h-16 rounded" style={{background:"#f5f5f4"}} />)}
      </div>
      <div className="skeleton h-28 w-full mb-4 rounded" />
      <div className="skeleton h-12 w-full rounded" />
    </div>
  );
}

export default function SupplyPage() {
  return (
    <Suspense fallback={<SupplyPageSkeleton />}>
      <SupplyInner />
    </Suspense>
  );
}
