// app/api/markets/route.ts
// ================================================================
// Server-side API route for aggregated market data.
// Runs on the server with the Alchemy/Infura RPC — no wallet needed.
// Frontend can call GET /api/markets to get all market data.
//
// This avoids hitting rate limits from many parallel client-side
// RPC calls and is useful for SSR or external integrations.
// ================================================================

import { NextResponse } from "next/server";
import { JsonRpcProvider, Contract, ethers } from "ethers";
import {
  ADDRESSES,
  MARKETS,
  COMPTROLLER_ABI,
  ORACLE_ABI,
  INTEREST_STRATEGY_ABI,
  getCTokenABI,
  type MarketConfig,
} from "../../../lib/contracts";

const WAD = BigInt("1000000000000000000");
const SECONDS_PER_YEAR = 31536000;

function getProvider() {
  const rpc = process.env.NEXT_PUBLIC_RPC_URL;
  if (!rpc) throw new Error("NEXT_PUBLIC_RPC_URL not set");
  return new JsonRpcProvider(rpc);
}

async function getMarketData(market: MarketConfig, provider: JsonRpcProvider) {
  const cToken = new Contract(market.cTokenAddress, getCTokenABI(market), provider);
  const oracle = new Contract(ADDRESSES.oracle, ORACLE_ABI, provider);
  const comptroller = new Contract(ADDRESSES.comptroller, COMPTROLLER_ABI, provider);
  const strategy = new Contract(
    process.env.NEXT_PUBLIC_INTEREST_STRATEGY_ADDRESS!,
    INTEREST_STRATEGY_ABI,
    provider
  );

  const [totalSupply, totalBorrows, totalReserves, reserveFactor, cash, exchangeRate, price, marketInfo] =
    await Promise.all([
      cToken.totalSupply(),
      cToken.totalBorrows(),
      cToken.totalReserves(),
      cToken.reserveFactorMantissa(),
      cToken.getCashPrior(),
      cToken.exchangeRateStored(),
      oracle.getUnderlyingPrice(market.cTokenAddress),
      comptroller.markets(market.cTokenAddress),
    ]);

  const totalBorrowsBig = BigInt(totalBorrows);
  const cashBig = BigInt(cash);
  const reservesBig = BigInt(totalReserves);
  const totalLiquidity = cashBig + totalBorrowsBig - reservesBig;

  const utilizationRate =
    totalLiquidity === 0n ? 0 : Number((totalBorrowsBig * 10000n) / totalLiquidity) / 100;

  let borrowAPY = 0;
  let supplyAPY = 0;
  try {
    const borrowRatePerSec = await strategy.getBorrowRate(cash, totalBorrows, totalReserves);
    const rateN = Number(ethers.formatUnits(borrowRatePerSec, 18));
    borrowAPY = (Math.pow(1 + rateN, SECONDS_PER_YEAR) - 1) * 100;
    const rf = Number(ethers.formatUnits(reserveFactor, 18));
    supplyAPY = borrowAPY * (utilizationRate / 100) * (1 - rf);
  } catch {
    // Strategy not deployed — return 0
  }

  const cTokenSupply = BigInt(totalSupply);
  const exRate = BigInt(exchangeRate);
  const totalSupplyUnderlying = (cTokenSupply * exRate) / WAD;

  const priceScaled = BigInt(price);
  const priceUSD =
    market.decimals === 6
      ? Number(ethers.formatUnits(priceScaled, 30))
      : Number(ethers.formatUnits(priceScaled, 18));

  const collateralFactor =
    Number(ethers.formatUnits(marketInfo.collateralFactorMantissa, 18)) * 100;

  return {
    id: market.id,
    name: market.name,
    symbol: market.symbol,
    icon: market.icon,
    isNative: market.isNative,
    decimals: market.decimals,
    cTokenAddress: market.cTokenAddress,
    underlyingAddress: market.underlyingAddress,
    supplyAPY: Math.max(0, supplyAPY),
    borrowAPY: Math.max(0, borrowAPY),
    totalSupply: ethers.formatUnits(totalSupplyUnderlying, market.decimals),
    totalBorrows: ethers.formatUnits(totalBorrowsBig, market.decimals),
    utilizationRate,
    priceUSD,
    collateralFactor,
    exchangeRate: exRate.toString(),
  };
}

export async function GET() {
  try {
    const provider = getProvider();
    const results = await Promise.all(MARKETS.map((m) => getMarketData(m, provider)));

    return NextResponse.json(
      { success: true, data: results, timestamp: Date.now() },
      {
        headers: {
          // Cache for 30 seconds on CDN, allow stale for 60s
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
        },
      }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
