"use client";
// components/MarketCard.tsx
import Link from "next/link";
import type { MarketData } from "../lib/protocol";
import { formatUSD, formatAPY } from "../lib/protocol";
import CryptoIcon from "./CryptoIcon";

interface MarketCardProps {
  data: MarketData;
  userSupply?: number;
  userBorrow?: number;
  purchasePrice?: number;
  onViewMarket?: () => void;
}

export default function MarketCard({
  data,
  userSupply,
  userBorrow,
  purchasePrice,
  onViewMarket,
}: MarketCardProps) {
  const { market, supplyAPY, borrowAPY, totalSupply, totalBorrows, utilizationRate, priceUSD } =
    data;
  const hasPosition = (userSupply ?? 0) > 0 || (userBorrow ?? 0) > 0;

  return (
    <div className="card p-5 hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-stone-50 flex items-center justify-center">
            <CryptoIcon symbol={market.symbol} size={28} />
          </div>
          <div>
            <div className="font-medium text-stone-800">{market.symbol}</div>
            <div className="text-xs text-stone-400">{market.name}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono text-sm text-stone-600">{formatUSD(priceUSD)}</div>
          <div className="text-xs text-stone-400">oracle price</div>
        </div>
      </div>

      <hr className="divider mb-4" />

      {/* APY row */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <div className="stat-label mb-1">Supply APY</div>
          <div className="text-emerald-600 font-medium text-lg">{formatAPY(supplyAPY)}</div>
        </div>
        <div>
          <div className="stat-label mb-1">Borrow APY</div>
          <div className="text-amber-600 font-medium text-lg">{formatAPY(borrowAPY)}</div>
        </div>
      </div>

      {/* Utilization bar */}
      <div className="mb-4">
        <div className="flex justify-between text-xs text-stone-400 mb-1">
          <span>Utilization</span>
          <span className="font-mono">{utilizationRate.toFixed(1)}%</span>
        </div>
        <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              utilizationRate > 80
                ? "bg-rose-400"
                : utilizationRate > 60
                ? "bg-amber-400"
                : "bg-emerald-400"
            }`}
            style={{ width: `${Math.min(utilizationRate, 100)}%` }}
          />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 text-sm mb-4">
        <div>
          <span className="text-stone-400">Total Supply</span>
          <div className="font-mono text-stone-700">
            {parseFloat(totalSupply).toLocaleString(undefined, { maximumFractionDigits: 2 })}{" "}
            <span className="text-xs text-stone-400">{market.symbol}</span>
          </div>
        </div>
        <div>
          <span className="text-stone-400">Total Borrow</span>
          <div className="font-mono text-stone-700">
            {parseFloat(totalBorrows).toLocaleString(undefined, { maximumFractionDigits: 2 })}{" "}
            <span className="text-xs text-stone-400">{market.symbol}</span>
          </div>
        </div>
        <div>
          <span className="text-stone-400">Collateral Factor</span>
          <div className="font-mono text-stone-700">{data.collateralFactor.toFixed(0)}%</div>
        </div>
        <div>
          <span className="text-stone-400">Your Supply</span>
          <div className="font-mono text-stone-700">
            {userSupply !== undefined ? formatUSD(userSupply) : "—"}
          </div>
        </div>
      </div>

      {hasPosition && (
        <div className="mb-4 rounded border border-stone-100 bg-stone-50 px-3 py-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-stone-500">Holding price</span>
            <span className="font-mono text-stone-700">{formatUSD(priceUSD)}</span>
          </div>
          {purchasePrice !== undefined && (
            <div className="mt-1 flex items-center justify-between text-xs">
              <span className="text-stone-500">Purchase price</span>
              <span className="font-mono text-amber-700">{formatUSD(purchasePrice)}</span>
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="grid grid-cols-3 gap-2">
        <button type="button" onClick={onViewMarket} className="btn btn-ghost text-sm py-2">
          View
        </button>
        <Link href={`/supply?market=${market.id}`} className="btn btn-primary flex-1 text-sm py-2">
          Supply
        </Link>
        <Link href={`/borrow?market=${market.id}`} className="btn btn-outline flex-1 text-sm py-2">
          Borrow
        </Link>
      </div>
    </div>
  );
}
