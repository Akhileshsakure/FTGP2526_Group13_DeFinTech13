// lib/protocol.ts
// ================================================================
// All smart contract interactions for the DeFi lending protocol.
//
// Architecture note:
//   - READ functions use the read-only RPC provider (no wallet needed)
//   - WRITE functions require a signer (MetaMask connected)
//   - The Router contract is the single entry point for all user txs
//   - Direct cToken calls (mint/borrow/repay/redeem) are used for
//     simplicity when the router's loopLeverage is overkill for a
//     single-market, no-leverage operation.
// ================================================================

import { ethers, Contract } from "ethers";
import { getReadProvider, getSigner, parseUnits, formatUnits } from "./ethers";
import {
  ADDRESSES,
  MARKETS,
  MarketConfig,
  COMPTROLLER_ABI,
  CETH_ABI,
  CERC20_ABI,
  ERC20_ABI,
  ORACLE_ABI,
  INTEREST_STRATEGY_ABI,
  getCTokenABI,
} from "./contracts";

const WAD = BigInt("1000000000000000000"); // 1e18

// ── Contract factory helpers ──────────────────────────────────

function readContract(address: string, abi: readonly string[]) {
  return new Contract(address, abi, getReadProvider());
}

async function writeContract(address: string, abi: readonly string[]) {
  const signer = await getSigner();
  return new Contract(address, abi, signer);
}

// ── Types ─────────────────────────────────────────────────────

export interface MarketData {
  market: MarketConfig;
  // Supply side
  supplyAPY: number;       // percentage, e.g. 3.5
  totalSupply: string;     // human readable underlying
  // Borrow side
  borrowAPY: number;
  totalBorrows: string;
  // Utilization
  utilizationRate: number; // 0–100
  // Price
  priceUSD: number;
  // Collateral factor
  collateralFactor: number; // 0–100
  // Exchange rate
  exchangeRate: bigint;
}

export interface UserPosition {
  market: MarketConfig;
  // Supply
  cTokenBalance: bigint;
  supplyBalanceUnderlying: string;
  supplyBalanceUSD: number;
  // Borrow
  borrowBalance: string;
  borrowBalanceUSD: number;
  // Collateral membership
  isCollateral: boolean;
}

export interface AccountSummary {
  totalSuppliedUSD: number;
  totalBorrowedUSD: number;
  netAPY: number;
  healthFactor: number;  // liquidity / totalBorrows. >1 is safe
  availableToBorrowUSD: number;
  positions: UserPosition[];
}

// ── Market Data Reads ─────────────────────────────────────────

/** Fetch on-chain data for a single market */
export async function fetchMarketData(market: MarketConfig): Promise<MarketData> {
  const provider = getReadProvider();
  const cToken = new Contract(market.cTokenAddress, getCTokenABI(market), provider);
  const oracle = new Contract(ADDRESSES.oracle, ORACLE_ABI, provider);
  const comptroller = new Contract(ADDRESSES.comptroller, COMPTROLLER_ABI, provider);
  const interestStrategy = new Contract(
    process.env.NEXT_PUBLIC_INTEREST_STRATEGY_ADDRESS as string,
    INTEREST_STRATEGY_ABI,
    provider
  );

  const [
    totalSupplyRaw,
    totalBorrowsRaw,
    totalReservesRaw,
    reserveFactor,
    cashRaw,
    exchangeRate,
    priceRaw,
    marketInfo,
  ] = await Promise.all([
    cToken.totalSupply(),
    cToken.totalBorrows(),
    cToken.totalReserves(),
    cToken.reserveFactorMantissa(),
    cToken.getCashPrior(),
    cToken.exchangeRateStored(),
    oracle.getUnderlyingPrice(market.cTokenAddress),
    comptroller.markets(market.cTokenAddress),
  ]);

  // Calculate utilization rate = totalBorrows / (cash + totalBorrows - reserves)
  const totalCash = BigInt(cashRaw);
  const totalBorrows = BigInt(totalBorrowsRaw);
  const totalReserves = BigInt(totalReservesRaw);
  const totalLiquidity = totalCash + totalBorrows - totalReserves;
  
  const utilizationRate =
    totalLiquidity === 0n
      ? 0
      : Number((totalBorrows * 10000n) / totalLiquidity) / 100;

  // Borrow rate (per second from strategy)
  let borrowAPY = 0;
  let supplyAPY = 0;
  try {
    const borrowRatePerSec = await interestStrategy.getBorrowRate(
      totalCash,
      totalBorrowsRaw,
      totalReservesRaw
    );
    // APY = (1 + ratePerSec)^(365*24*3600) - 1
    const SECONDS_PER_YEAR = 31536000;
    const rateN = Number(ethers.formatUnits(borrowRatePerSec, 18));
    borrowAPY = (Math.pow(1 + rateN, SECONDS_PER_YEAR) - 1) * 100;

    // Supply APY = borrow APY * utilization * (1 - reserve factor)
    const rf = Number(ethers.formatUnits(reserveFactor, 18));
    supplyAPY = borrowAPY * (utilizationRate / 100) * (1 - rf);
  } catch {
    // Strategy not deployed yet — show 0
  }

  // Convert exchange rate to human-readable total supply in underlying
  // totalSupplyUnderlying = totalSupply * exchangeRate / 1e18
  const cTokenSupply = BigInt(totalSupplyRaw);
  const exRate = BigInt(exchangeRate);
  const totalSupplyUnderlying = (cTokenSupply * exRate) / WAD;

  // Price: oracle returns price scaled to 1e18 (USD value of 1 underlying unit)
  // For 6-decimal tokens (USDC), oracle price is adjusted: price * 1e12
  const priceScaled = BigInt(priceRaw);
  // Price in USD for 1 underlying token
  const priceUSD =
    market.decimals === 6
      ? Number(ethers.formatUnits(priceScaled, 30)) // 18+12 decimals
      : Number(ethers.formatUnits(priceScaled, 18));

  const collateralFactor =
    Number(ethers.formatUnits(marketInfo.collateralFactorMantissa, 18)) * 100;

  return {
    market,
    supplyAPY: Math.max(0, supplyAPY),
    borrowAPY: Math.max(0, borrowAPY),
    totalSupply: formatUnits(totalSupplyUnderlying, market.decimals),
    totalBorrows: formatUnits(totalBorrows, market.decimals),
    utilizationRate,
    priceUSD,
    collateralFactor,
    exchangeRate: exRate,
  };
}

/** Fetch data for all markets */
export async function fetchAllMarkets(): Promise<MarketData[]> {
  return Promise.all(MARKETS.map(fetchMarketData));
}

// ── User Position Reads ───────────────────────────────────────

export async function fetchUserPositions(
  userAddress: string,
  marketsData: MarketData[]
): Promise<AccountSummary> {
  const provider = getReadProvider();
  const comptroller = new Contract(ADDRESSES.comptroller, COMPTROLLER_ABI, provider);

  const positions = await Promise.all(
    marketsData.map(async (md) => {
      const cToken = new Contract(md.market.cTokenAddress, getCTokenABI(md.market), provider);

      const [snapshot, isCollateral] = await Promise.all([
        cToken.getAccountSnapshot(userAddress),
        comptroller.accountMembership(userAddress, md.market.cTokenAddress),
      ]);

      const [, cTokenBalance, borrowBalance, exchangeRateMantissa] = snapshot;
      const cTokenBal = BigInt(cTokenBalance);
      const exRate = BigInt(exchangeRateMantissa);

      // Supply balance in underlying = cTokenBalance * exchangeRate / 1e18
      const supplyUnderlying = (cTokenBal * exRate) / WAD;
      const supplyStr = formatUnits(supplyUnderlying, md.market.decimals);
      const borrowStr = formatUnits(BigInt(borrowBalance), md.market.decimals);

      const supplyUSD = parseFloat(supplyStr) * md.priceUSD;
      const borrowUSD = parseFloat(borrowStr) * md.priceUSD;

      return {
        market: md.market,
        cTokenBalance: cTokenBal,
        supplyBalanceUnderlying: supplyStr,
        supplyBalanceUSD: supplyUSD,
        borrowBalance: borrowStr,
        borrowBalanceUSD: borrowUSD,
        isCollateral: Boolean(isCollateral),
      } satisfies UserPosition;
    })
  );

  // Account liquidity from Comptroller
  const [, liquidity, shortfall] = await comptroller.getAccountLiquidity(userAddress);
  const liquidityUSD = Number(ethers.formatUnits(BigInt(liquidity), 18));
  const shortfallUSD = Number(ethers.formatUnits(BigInt(shortfall), 18));

  const totalSuppliedUSD = positions.reduce((s, p) => s + p.supplyBalanceUSD, 0);
  const totalBorrowedUSD = positions.reduce((s, p) => s + p.borrowBalanceUSD, 0);

  // Health factor: if nothing borrowed, show Infinity (safe)
  const healthFactor =
    totalBorrowedUSD === 0
      ? Infinity
      : (totalSuppliedUSD * 0.75) / totalBorrowedUSD; // approx; exact from comptroller

  // Weighted net APY
  const supplyIncome = positions.reduce((s, p) => {
    const md = marketsData.find((m) => m.market.id === p.market.id)!;
    return s + p.supplyBalanceUSD * (md.supplyAPY / 100);
  }, 0);
  const borrowCost = positions.reduce((s, p) => {
    const md = marketsData.find((m) => m.market.id === p.market.id)!;
    return s + p.borrowBalanceUSD * (md.borrowAPY / 100);
  }, 0);
  const netAPY =
    totalSuppliedUSD === 0
      ? 0
      : ((supplyIncome - borrowCost) / totalSuppliedUSD) * 100;

  return {
    totalSuppliedUSD,
    totalBorrowedUSD,
    netAPY,
    healthFactor: shortfallUSD > 0 ? 0 : healthFactor,
    availableToBorrowUSD: liquidityUSD,
    positions,
  };
}

// ── User Wallet Balance ───────────────────────────────────────

export async function fetchWalletBalance(
  userAddress: string,
  market: MarketConfig
): Promise<string> {
  const provider = getReadProvider();

  if (market.isNative) {
    const balance = await provider.getBalance(userAddress);
    return formatUnits(balance, 18);
  }

  const token = new Contract(market.underlyingAddress!, ERC20_ABI, provider);
  const balance = await token.balanceOf(userAddress);
  return formatUnits(BigInt(balance), market.decimals);
}

// ── ERC20 Approval ────────────────────────────────────────────

export async function approveToken(
  tokenAddress: string,
  spenderAddress: string,
  amount: bigint
): Promise<ethers.ContractTransactionReceipt | null> {
  const token = await writeContract(tokenAddress, ERC20_ABI);
  const tx = await token.approve(spenderAddress, amount);
  return tx.wait();
}

export async function checkAllowance(
  tokenAddress: string,
  ownerAddress: string,
  spenderAddress: string
): Promise<bigint> {
  const token = readContract(tokenAddress, ERC20_ABI);
  const allowance = await token.allowance(ownerAddress, spenderAddress);
  return BigInt(allowance);
}

// ── Supply (Mint cTokens) ─────────────────────────────────────
// For simplicity, calls cToken.mint() directly (requires user has entered market separately)
// If using Router, would call loopLeverage with a supply-only step.

export async function supplyAsset(
  market: MarketConfig,
  amountHuman: string
): Promise<ethers.ContractTransactionReceipt | null> {
  const amount = parseUnits(amountHuman, market.decimals);
  const signer = await getSigner();

  if (market.isNative) {
    // CEth.mint() is payable
    const cEth = new Contract(market.cTokenAddress, CETH_ABI, signer);
    const tx = await cEth.mint({ value: amount });
    return tx.wait();
  } else {
    // First ensure allowance
    const userAddress = await signer.getAddress();
    const allowance = await checkAllowance(
      market.underlyingAddress!,
      userAddress,
      market.cTokenAddress
    );
    if (allowance < amount) {
      await approveToken(market.underlyingAddress!, market.cTokenAddress, amount * 2n);
    }
    const cErc20 = new Contract(market.cTokenAddress, CERC20_ABI, signer);
    const tx = await cErc20.mint(amount);
    return tx.wait();
  }
}

// ── Redeem (Burn cTokens, get underlying back) ────────────────

export async function redeemAsset(
  market: MarketConfig,
  amountHuman: string
): Promise<ethers.ContractTransactionReceipt | null> {
  const amount = parseUnits(amountHuman, market.decimals);
  const signer = await getSigner();
  const abi = getCTokenABI(market);
  const cToken = new Contract(market.cTokenAddress, abi, signer);
  // redeemUnderlying: specify amount of underlying to receive
  const tx = await cToken.redeemUnderlying(amount);
  return tx.wait();
}

// ── Borrow ────────────────────────────────────────────────────

export async function borrowAsset(
  market: MarketConfig,
  amountHuman: string
): Promise<ethers.ContractTransactionReceipt | null> {
  const amount = parseUnits(amountHuman, market.decimals);
  const signer = await getSigner();
  const abi = getCTokenABI(market);
  const cToken = new Contract(market.cTokenAddress, abi, signer);
  const tx = await cToken.borrow(amount);
  return tx.wait();
}

// ── Repay ─────────────────────────────────────────────────────

export async function repayBorrow(
  market: MarketConfig,
  amountHuman: string,
  repayFull: boolean = false
): Promise<ethers.ContractTransactionReceipt | null> {
  const signer = await getSigner();

  if (market.isNative) {
    const amount = repayFull
      ? parseUnits(amountHuman, 18) // pass full amount with a little extra; cToken handles remainder
      : parseUnits(amountHuman, 18);
    const cEth = new Contract(market.cTokenAddress, CETH_ABI, signer);
    const tx = await cEth.repayBorrow({ value: amount });
    return tx.wait();
  } else {
    const amount = repayFull
      ? ethers.MaxUint256 // type(uint256).max = repay full
      : parseUnits(amountHuman, market.decimals);

    const userAddress = await signer.getAddress();
    // Approve max if repaying full, else exact amount
    const approveAmount = repayFull
      ? ethers.MaxUint256
      : amount;
    const allowance = await checkAllowance(
      market.underlyingAddress!,
      userAddress,
      market.cTokenAddress
    );
    if (allowance < amount) {
      await approveToken(market.underlyingAddress!, market.cTokenAddress, approveAmount);
    }

    const cErc20 = new Contract(market.cTokenAddress, CERC20_ABI, signer);
    const tx = await cErc20.repayBorrow(amount);
    return tx.wait();
  }
}

// ── Enter / Exit Collateral ───────────────────────────────────

export async function enterMarket(
  cTokenAddress: string
): Promise<ethers.ContractTransactionReceipt | null> {
  const comptroller = await writeContract(ADDRESSES.comptroller, COMPTROLLER_ABI);
  const tx = await comptroller.enterMarkets([cTokenAddress]);
  return tx.wait();
}

export async function exitMarket(
  cTokenAddress: string
): Promise<ethers.ContractTransactionReceipt | null> {
  const comptroller = await writeContract(ADDRESSES.comptroller, COMPTROLLER_ABI);
  const tx = await comptroller.exitMarket(cTokenAddress);
  return tx.wait();
}

// ── Formatting helpers ────────────────────────────────────────

export function formatUSD(value: number): string {
  if (!isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatAPY(value: number): string {
  if (!isFinite(value) || isNaN(value)) return "—";
  return `${value.toFixed(2)}%`;
}

export function formatToken(value: string, decimals: number = 4): string {
  const num = parseFloat(value);
  if (isNaN(num)) return "0";
  return num.toFixed(decimals);
}

export function formatHealthFactor(hf: number): string {
  if (!isFinite(hf)) return "∞";
  return hf.toFixed(2);
}
