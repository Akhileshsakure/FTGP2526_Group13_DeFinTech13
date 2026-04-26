"use client";
// lib/hooks/useUserPosition.ts
// ================================================================
// Reusable hook for fetching a connected user's protocol positions.
// Depends on useMarkets for market price data.
// ================================================================

import { useState, useEffect, useCallback } from "react";
import { fetchUserPositions, type MarketData, type AccountSummary } from "../protocol";

interface UseUserPositionResult {
  summary: AccountSummary | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useUserPosition(
  account: string | null,
  markets: MarketData[],
  isCorrectNetwork: boolean
): UseUserPositionResult {
  const [summary, setSummary] = useState<AccountSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!account || !isCorrectNetwork || markets.length === 0) {
      setSummary(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchUserPositions(account, markets);
      setSummary(data);
    } catch (err: unknown) {
      setError((err as Error).message ?? "Failed to load positions");
    } finally {
      setLoading(false);
    }
  }, [account, isCorrectNetwork, markets]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { summary, loading, error, refresh };
}
