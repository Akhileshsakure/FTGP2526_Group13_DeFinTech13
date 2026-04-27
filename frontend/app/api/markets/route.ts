// app/api/markets/route.ts
// Server-side aggregated market data endpoint.

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

const WAD = 1_000_000_000_000_000_000n;
const SECONDS_PER_YEAR = 31_536_000;

function getProvider() {
  const rpc = process.env.NEXT_PUBLIC_RPC_URL;
  if (!rpc) throw new Error("NEXT_PUBLIC_RPC_URL not set");
  return new JsonRpcProvider(rpc);
}

function wadToNumber(value: bigint): number {
  return Number(ethers.formatUnits(value, 18));
}

function fn(contract: Contract, signature: string) {
  return contract.getFunction(signature);
}

function formatOraclePrice(price: bigint, decimals: number): number {
  if (price === 0n) return 0;
  if (decimals < 18 && price >= 10n ** 24n) {
    return Number(ethers.formatUnits(price, 18 + (18 - decimals)));
  }
  return Number(ethers.formatUnits(price, 18));
}

async function getMarketData(market: MarketConfig, provider: JsonRpcProvider) {
  const cToken = new Contract(market.cTokenAddress, getCTokenABI(market), provider);
  const oracle = new Contract(ADDRESSES.oracle, ORACLE_ABI, provider);
  const comptroller = new Contract(ADDRESSES.comptroller, COMPTROLLER_ABI, provider);

  const [
    totalSupplyRaw,
    totalBorrowsRaw,
    totalReservesRaw,
    reserveFactorRaw,
    cashRaw,
    exchangeRateRaw,
    priceRaw,
    marketInfo,
    strategyAddress,
  ] = await Promise.all([
    fn(cToken, "totalSupply()")(),
    fn(cToken, "totalBorrows()")(),
    fn(cToken, "totalReserves()")(),
    fn(cToken, "reserveFactorMantissa()")(),
    fn(cToken, "getCashPrior()")(),
    fn(cToken, "exchangeRateStored()")(),
    fn(oracle, "getUnderlyingPrice(address)")(market.cTokenAddress),
    fn(comptroller, "markets(address)")(market.cTokenAddress),
    fn(cToken, "interestRateStrategy()")(),
  ]);

  const totalSupply = BigInt(totalSupplyRaw);
  const totalBorrows = BigInt(totalBorrowsRaw);
  const totalReserves = BigInt(totalReservesRaw);
  const reserveFactor = BigInt(reserveFactorRaw);
  const cash = BigInt(cashRaw);
  const exchangeRate = BigInt(exchangeRateRaw);
  const totalLiquidity = cash + totalBorrows - totalReserves;

  const utilizationRate =
    totalLiquidity === 0n ? 0 : Number((totalBorrows * 10_000n) / totalLiquidity) / 100;

  let borrowAPY = 0;
  let supplyAPY = 0;
  try {
    const strategy = new Contract(strategyAddress, INTEREST_STRATEGY_ABI, provider);
    const borrowRatePerSecond = BigInt(
      await fn(strategy, "getBorrowRate(uint256,uint256,uint256)")(
        cash,
        totalBorrows,
        totalReserves
      )
    );
    const rate = wadToNumber(borrowRatePerSecond);
    borrowAPY = (Math.pow(1 + rate, SECONDS_PER_YEAR) - 1) * 100;
    supplyAPY = borrowAPY * (utilizationRate / 100) * (1 - wadToNumber(reserveFactor));
  } catch {
    borrowAPY = 0;
    supplyAPY = 0;
  }

  const totalSupplyUnderlying = (totalSupply * exchangeRate) / WAD;
  const priceUSD = formatOraclePrice(BigInt(priceRaw), market.decimals);

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
    totalBorrows: ethers.formatUnits(totalBorrows, market.decimals),
    utilizationRate,
    priceUSD,
    collateralFactor: wadToNumber(BigInt(marketInfo[1])) * 100,
    liquidationThreshold: wadToNumber(BigInt(marketInfo[2])) * 100,
    liquidationBonus: wadToNumber(BigInt(marketInfo[3])) * 100,
    supplyCap: BigInt(marketInfo[4]).toString(),
    borrowCap: BigInt(marketInfo[5]).toString(),
    exchangeRate: exchangeRate.toString(),
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
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
        },
      }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
