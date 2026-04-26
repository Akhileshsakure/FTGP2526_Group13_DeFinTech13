"use client";
// lib/hooks/useMarkets.ts
// ================================================================
// Reusable hook for fetching all market data.
// Handles loading, error, and auto-refresh every 30 seconds.
// ================================================================

import { useState, useEffect, useCallback } from "react";
import { fetchAllMarkets, type MarketData } from "../protocol";

interface UseMarketsResult {
  markets: MarketData[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  lastUpdated: Date | null;
}

export function useMarkets(autoRefreshMs: number = 30_000): UseMarketsResult {
  const [markets, setMarkets] = useState<MarketData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAllMarkets();
      setMarkets(data);
      setLastUpdated(new Date());
    } catch (err: unknown) {
      setError((err as Error).message ?? "Failed to load markets");
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Auto-refresh
  useEffect(() => {
    if (autoRefreshMs <= 0) return;
    const interval = setInterval(refresh, autoRefreshMs);
    return () => clearInterval(interval);
  }, [refresh, autoRefreshMs]);

  return { markets, loading, error, refresh, lastUpdated };
}
