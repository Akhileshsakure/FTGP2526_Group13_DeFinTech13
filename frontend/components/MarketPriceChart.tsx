"use client";

import type { MarketData, PricePoint } from "../lib/protocol";
import { formatUSD } from "../lib/protocol";

export interface PurchaseMarker {
  id: string;
  timestamp: number;
  priceUSD: number;
  amount: string | null;
}

interface MarketPriceChartProps {
  marketData: MarketData;
  priceHistory: PricePoint[];
  markers: PurchaseMarker[];
  compact?: boolean;
}

const CHART_WIDTH = 640;
const CHART_HEIGHT = 220;
const PADDING_X = 36;
const PADDING_Y = 24;

export default function MarketPriceChart({
  marketData,
  priceHistory,
  markers,
  compact = false,
}: MarketPriceChartProps) {
  const points = normalizeHistory(priceHistory, marketData.priceUSD);
  const prices = [...points.map((point) => point.priceUSD), ...markers.map((marker) => marker.priceUSD)];
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const range = maxPrice - minPrice || Math.max(maxPrice * 0.02, 1);
  const minTime = Math.min(...points.map((point) => point.timestamp));
  const maxTime = Math.max(...points.map((point) => point.timestamp));
  const timeRange = maxTime - minTime || 1;

  const xFor = (timestamp: number) =>
    PADDING_X + ((timestamp - minTime) / timeRange) * (CHART_WIDTH - PADDING_X * 2);
  const yFor = (price: number) =>
    PADDING_Y + ((maxPrice - price) / range) * (CHART_HEIGHT - PADDING_Y * 2);

  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${xFor(point.timestamp).toFixed(2)} ${yFor(point.priceUSD).toFixed(2)}`)
    .join(" ");

  const latest = points[points.length - 1];
  const first = points[0];
  const change = first.priceUSD === 0 ? 0 : ((latest.priceUSD - first.priceUSD) / first.priceUSD) * 100;
  const lineColor = change >= 0 ? "#059669" : "#e11d48";
  const gradientId = `price-fill-${marketData.market.id}`;

  return (
    <div className={compact ? "" : "card p-5"}>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
        <div>
          <div className="stat-label mb-1">{compact ? "Holding Price" : "Price Trend"}</div>
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-2xl text-stone-800">{formatUSD(latest.priceUSD)}</span>
            <span className={`text-sm font-medium ${change >= 0 ? "text-emerald-600" : "text-rose-500"}`}>
              {change >= 0 ? "+" : ""}
              {change.toFixed(2)}%
            </span>
          </div>
        </div>
        {!compact && (
          <div className="text-xs text-stone-400 sm:text-right">
            {markers.length > 0
              ? `${markers.length} purchase ${markers.length === 1 ? "marker" : "markers"}`
              : "No purchase markers yet"}
          </div>
        )}
      </div>

      {!compact && (
        <div className="relative h-[220px] w-full overflow-hidden rounded border border-stone-100 bg-stone-50">
          <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="h-full w-full" role="img">
            <defs>
              <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={lineColor} stopOpacity="0.18" />
                <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
              </linearGradient>
            </defs>

            {[0, 1, 2].map((line) => {
              const y = PADDING_Y + (line * (CHART_HEIGHT - PADDING_Y * 2)) / 2;
              return <line key={line} x1={PADDING_X} x2={CHART_WIDTH - PADDING_X} y1={y} y2={y} stroke="#e7e5e4" strokeWidth="1" />;
            })}

            <path
              d={`${path} L ${CHART_WIDTH - PADDING_X} ${CHART_HEIGHT - PADDING_Y} L ${PADDING_X} ${CHART_HEIGHT - PADDING_Y} Z`}
              fill={`url(#${gradientId})`}
            />
            <path d={path} fill="none" stroke={lineColor} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />

            {markers.map((marker) => {
              const markerX = Math.min(Math.max(xFor(marker.timestamp), PADDING_X), CHART_WIDTH - PADDING_X);
              const markerY = yFor(marker.priceUSD);
              return (
                <g key={marker.id}>
                  <line x1={markerX} x2={markerX} y1={PADDING_Y} y2={CHART_HEIGHT - PADDING_Y} stroke="#a16207" strokeDasharray="4 4" />
                  <circle cx={markerX} cy={markerY} r="5" fill="#f59e0b" stroke="#ffffff" strokeWidth="2" />
                </g>
              );
            })}
          </svg>
        </div>
      )}

      {!compact && markers.length > 0 && (
        <div className="mt-4 grid gap-2">
          {markers.map((marker) => (
            <div key={marker.id} className="flex items-center justify-between rounded border border-amber-100 bg-amber-50 px-3 py-2 text-sm">
              <div>
                <span className="font-medium text-amber-800">Purchase price</span>
                <span className="text-amber-700"> {formatUSD(marker.priceUSD)}</span>
              </div>
              <div className="text-xs text-amber-700">
                {marker.amount ?? "Supply"} · {new Date(marker.timestamp * 1000).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function normalizeHistory(history: PricePoint[], currentPrice: number): PricePoint[] {
  if (history.length >= 2) {
    return history;
  }

  const now = Math.floor(Date.now() / 1000);
  const base = currentPrice || 1;
  return Array.from({ length: 12 }, (_, index) => {
    const drift = Math.sin(index * 0.75) * 0.018 + (index - 5) * 0.004;
    return {
      timestamp: now - (11 - index) * 3600,
      priceUSD: Math.max(base * (1 + drift), 0.0001),
    };
  });
}
