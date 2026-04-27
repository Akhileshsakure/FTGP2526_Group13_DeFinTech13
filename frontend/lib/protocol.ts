// lib/protocol.ts
// Smart contract interactions for the lending protocol frontend.

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

const WAD = 1_000_000_000_000_000_000n;
const SECONDS_PER_YEAR = 31_536_000;
const MAX_HEALTH_FACTOR_DISPLAY = 1_000_000;
const READ_RETRY_COUNT = 2;

function readContract(address: string, abi: readonly string[]) {
  assertAddress(address, "Contract address");
  return new Contract(address, abi, getReadProvider());
}

async function writeContract(address: string, abi: readonly string[]) {
  assertAddress(address, "Contract address");
  const signer = await getSigner();
  return new Contract(address, abi, signer);
}

function fn(contract: Contract, signature: string) {
  return contract.getFunction(signature);
}

function isRetryableReadError(error: unknown): boolean {
  const err = error as { code?: string; message?: string; shortMessage?: string };
  const message = `${err.shortMessage ?? ""} ${err.message ?? ""}`.toLowerCase();
  return (
    err.code === "CALL_EXCEPTION" ||
    message.includes("missing revert data") ||
    message.includes("failed to detect network") ||
    message.includes("could not coalesce error")
  );
}

async function readWithRetry<T>(read: () => Promise<T>, retries = READ_RETRY_COUNT): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await read();
    } catch (error) {
      lastError = error;
      if (!isRetryableReadError(error) || attempt === retries) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }

  throw lastError;
}

function assertAddress(address: string | null | undefined, label: string): asserts address is string {
  if (!address || !ethers.isAddress(address)) {
    throw new Error(`${label} is not configured`);
  }
}

function wadToNumber(value: bigint): number {
  return Number(ethers.formatUnits(value, 18));
}

function formatOraclePrice(price: bigint, decimals: number): number {
  if (price === 0n) return 0;
  if (decimals < 18 && price >= 10n ** 24n) {
    return Number(ethers.formatUnits(price, 18 + (18 - decimals)));
  }
  return Number(ethers.formatUnits(price, 18));
}

export interface MarketData {
  market: MarketConfig;
  supplyAPY: number;
  totalSupply: string;
  borrowAPY: number;
  totalBorrows: string;
  utilizationRate: number;
  priceUSD: number;
  collateralFactor: number;
  liquidationThreshold: number;
  liquidationBonus: number;
  supplyCap: bigint;
  borrowCap: bigint;
  exchangeRate: bigint;
}

export interface UserPosition {
  market: MarketConfig;
  cTokenBalance: bigint;
  supplyBalanceUnderlying: string;
  supplyBalanceUSD: number;
  borrowBalance: string;
  borrowBalanceUSD: number;
  isCollateral: boolean;
}

export interface AccountSummary {
  totalSuppliedUSD: number;
  totalBorrowedUSD: number;
  netAPY: number;
  healthFactor: number;
  availableToBorrowUSD: number;
  positions: UserPosition[];
}

export async function fetchMarketData(market: MarketConfig): Promise<MarketData> {
  assertAddress(market.cTokenAddress, `${market.symbol} market address`);
  assertAddress(ADDRESSES.oracle, "Oracle address");
  assertAddress(ADDRESSES.comptroller, "Comptroller address");

  const provider = getReadProvider();
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
    readWithRetry(() => fn(cToken, "totalSupply()")()),
    readWithRetry(() => fn(cToken, "totalBorrows()")()),
    readWithRetry(() => fn(cToken, "totalReserves()")()),
    readWithRetry(() => fn(cToken, "reserveFactorMantissa()")()),
    readWithRetry(() => fn(cToken, "getCashPrior()")()),
    readWithRetry(() => fn(cToken, "exchangeRateStored()")()),
    readWithRetry(() => fn(oracle, "getUnderlyingPrice(address)")(market.cTokenAddress)),
    readWithRetry(() => fn(comptroller, "markets(address)")(market.cTokenAddress)),
    readWithRetry(() => fn(cToken, "interestRateStrategy()")()),
  ]);

  const totalSupply = BigInt(totalSupplyRaw);
  const totalBorrows = BigInt(totalBorrowsRaw);
  const totalReserves = BigInt(totalReservesRaw);
  const cash = BigInt(cashRaw);
  const exchangeRate = BigInt(exchangeRateRaw);
  const reserveFactor = BigInt(reserveFactorRaw);
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
    const borrowRate = wadToNumber(borrowRatePerSecond);
    borrowAPY = (Math.pow(1 + borrowRate, SECONDS_PER_YEAR) - 1) * 100;
    supplyAPY = borrowAPY * (utilizationRate / 100) * (1 - wadToNumber(reserveFactor));
    if (supplyAPY === 0 && totalLiquidity > 0n && borrowAPY > 0) {
      supplyAPY = borrowAPY * (1 - wadToNumber(reserveFactor));
    }
  } catch {
    borrowAPY = 0;
    supplyAPY = 0;
  }

  const totalSupplyUnderlying = (totalSupply * exchangeRate) / WAD;
  const priceUSD = formatOraclePrice(BigInt(priceRaw), market.decimals);

  return {
    market,
    supplyAPY: Math.max(0, supplyAPY),
    borrowAPY: Math.max(0, borrowAPY),
    totalSupply: formatUnits(totalSupplyUnderlying, market.decimals),
    totalBorrows: formatUnits(totalBorrows, market.decimals),
    utilizationRate,
    priceUSD,
    collateralFactor: wadToNumber(BigInt(marketInfo[1])) * 100,
    liquidationThreshold: wadToNumber(BigInt(marketInfo[2])) * 100,
    liquidationBonus: wadToNumber(BigInt(marketInfo[3])) * 100,
    supplyCap: BigInt(marketInfo[4]),
    borrowCap: BigInt(marketInfo[5]),
    exchangeRate,
  };
}

export async function fetchAllMarkets(): Promise<MarketData[]> {
  const results = await Promise.allSettled(MARKETS.map(fetchMarketData));
  const markets = results.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : []
  );

  if (markets.length === 0) {
    const firstError = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    )?.reason;
    throw firstError instanceof Error ? firstError : new Error("Could not load market data");
  }

  return markets;
}

export async function fetchUserPositions(
  userAddress: string,
  marketsData: MarketData[]
): Promise<AccountSummary> {
  assertAddress(ADDRESSES.comptroller, "Comptroller address");
  const provider = getReadProvider();
  const comptroller = new Contract(ADDRESSES.comptroller, COMPTROLLER_ABI, provider);

  const positions = await Promise.all(
    marketsData.map(async (md) => {
      const cToken = new Contract(md.market.cTokenAddress, getCTokenABI(md.market), provider);
      const [cTokenBalanceRaw, borrowBalanceRaw, exchangeRateRaw, isCollateral] =
        await Promise.all([
          readWithRetry(() => fn(cToken, "balanceOf(address)")(userAddress)),
          readWithRetry(() => fn(cToken, "borrowBalanceStored(address)")(userAddress)),
          readWithRetry(() => fn(cToken, "exchangeRateStored()")()),
          readWithRetry(() => fn(comptroller, "checkMembership(address,address)")(
            userAddress,
            md.market.cTokenAddress
          )),
        ]);

      const cTokenBalance = BigInt(cTokenBalanceRaw);
      const borrowBalance = BigInt(borrowBalanceRaw);
      const exchangeRate = BigInt(exchangeRateRaw);
      const supplyUnderlying = (cTokenBalance * exchangeRate) / WAD;
      const supplyStr = formatUnits(supplyUnderlying, md.market.decimals);
      const borrowStr = formatUnits(borrowBalance, md.market.decimals);

      return {
        market: md.market,
        cTokenBalance,
        supplyBalanceUnderlying: supplyStr,
        supplyBalanceUSD: parseFloat(supplyStr) * md.priceUSD,
        borrowBalance: borrowStr,
        borrowBalanceUSD: parseFloat(borrowStr) * md.priceUSD,
        isCollateral: Boolean(isCollateral),
      } satisfies UserPosition;
    })
  );

  const [[, liquidity, shortfall], [healthErr, healthFactorRaw]] = await Promise.all([
    readWithRetry(() => fn(comptroller, "getAccountLiquidity(address)")(userAddress)),
    readWithRetry(() => fn(comptroller, "getAccountHealthFactor(address)")(userAddress)),
  ]);

  const totalSuppliedUSD = positions.reduce((sum, p) => sum + p.supplyBalanceUSD, 0);
  const totalBorrowedUSD = positions.reduce((sum, p) => sum + p.borrowBalanceUSD, 0);
  const liquidityUSD = wadToNumber(BigInt(liquidity));
  const shortfallUSD = wadToNumber(BigInt(shortfall));
  const healthFactor =
    totalBorrowedUSD === 0 || BigInt(healthErr) !== 0n
      ? Infinity
      : Math.min(wadToNumber(BigInt(healthFactorRaw)), MAX_HEALTH_FACTOR_DISPLAY);

  const supplyIncome = positions.reduce((sum, p) => {
    const md = marketsData.find((m) => m.market.id === p.market.id);
    return sum + p.supplyBalanceUSD * ((md?.supplyAPY ?? 0) / 100);
  }, 0);
  const borrowCost = positions.reduce((sum, p) => {
    const md = marketsData.find((m) => m.market.id === p.market.id);
    return sum + p.borrowBalanceUSD * ((md?.borrowAPY ?? 0) / 100);
  }, 0);

  return {
    totalSuppliedUSD,
    totalBorrowedUSD,
    netAPY: totalSuppliedUSD === 0 ? 0 : ((supplyIncome - borrowCost) / totalSuppliedUSD) * 100,
    healthFactor: shortfallUSD > 0 ? 0 : healthFactor,
    availableToBorrowUSD: liquidityUSD,
    positions,
  };
}

export async function fetchWalletBalance(
  userAddress: string,
  market: MarketConfig
): Promise<string> {
  const provider = getReadProvider();
  if (market.isNative) {
    return formatUnits(await provider.getBalance(userAddress), 18);
  }

  assertAddress(market.underlyingAddress, `${market.symbol} underlying address`);
  const token = new Contract(market.underlyingAddress, ERC20_ABI, provider);
  return formatUnits(BigInt(await fn(token, "balanceOf(address)")(userAddress)), market.decimals);
}

export async function approveToken(
  tokenAddress: string,
  spenderAddress: string,
  amount: bigint
): Promise<ethers.ContractTransactionReceipt | null> {
  const token = await writeContract(tokenAddress, ERC20_ABI);
  const tx = await fn(token, "approve(address,uint256)")(spenderAddress, amount);
  return tx.wait();
}

export async function checkAllowance(
  tokenAddress: string,
  ownerAddress: string,
  spenderAddress: string
): Promise<bigint> {
  const token = readContract(tokenAddress, ERC20_ABI);
  return BigInt(await fn(token, "allowance(address,address)")(ownerAddress, spenderAddress));
}

export async function supplyAsset(
  market: MarketConfig,
  amountHuman: string
): Promise<ethers.ContractTransactionReceipt | null> {
  const amount = parseUnits(amountHuman, market.decimals);
  const signer = await getSigner();

  if (market.isNative) {
    const cEth = new Contract(market.cTokenAddress, CETH_ABI, signer);
    const tx = await fn(cEth, "mint()")({ value: amount });
    return tx.wait();
  }

  assertAddress(market.underlyingAddress, `${market.symbol} underlying address`);
  const userAddress = await signer.getAddress();
  const allowance = await checkAllowance(
    market.underlyingAddress,
    userAddress,
    market.cTokenAddress
  );
  if (allowance < amount) {
    await approveToken(market.underlyingAddress, market.cTokenAddress, amount);
  }

  const cErc20 = new Contract(market.cTokenAddress, CERC20_ABI, signer);
  const tx = await fn(cErc20, "mint(uint256)")(amount);
  return tx.wait();
}

export async function redeemAsset(
  market: MarketConfig,
  amountHuman: string
): Promise<ethers.ContractTransactionReceipt | null> {
  const amount = parseUnits(amountHuman, market.decimals);
  const signer = await getSigner();
  const cToken = new Contract(market.cTokenAddress, getCTokenABI(market), signer);
  const tx = await fn(cToken, "redeemUnderlying(uint256)")(amount);
  return tx.wait();
}

export async function borrowAsset(
  market: MarketConfig,
  amountHuman: string
): Promise<ethers.ContractTransactionReceipt | null> {
  const amount = parseUnits(amountHuman, market.decimals);
  const signer = await getSigner();
  const cToken = new Contract(market.cTokenAddress, getCTokenABI(market), signer);
  const tx = await fn(cToken, "borrow(uint256)")(amount);
  return tx.wait();
}

export async function repayBorrow(
  market: MarketConfig,
  amountHuman: string,
  repayFull: boolean = false
): Promise<ethers.ContractTransactionReceipt | null> {
  const signer = await getSigner();

  if (market.isNative) {
    const baseAmount = parseUnits(amountHuman, 18);
    const amount = repayFull ? baseAmount + baseAmount / 1000n + 1n : baseAmount;
    const cEth = new Contract(market.cTokenAddress, CETH_ABI, signer);
    const tx = await fn(cEth, "repayBorrow()")({ value: amount });
    return tx.wait();
  }

  assertAddress(market.underlyingAddress, `${market.symbol} underlying address`);
  const amount = repayFull ? ethers.MaxUint256 : parseUnits(amountHuman, market.decimals);
  const approveAmount = repayFull ? ethers.MaxUint256 : amount;
  const userAddress = await signer.getAddress();
  const allowance = await checkAllowance(
    market.underlyingAddress,
    userAddress,
    market.cTokenAddress
  );
  if (allowance < amount) {
    await approveToken(market.underlyingAddress, market.cTokenAddress, approveAmount);
  }

  const cErc20 = new Contract(market.cTokenAddress, CERC20_ABI, signer);
  const tx = await fn(cErc20, "repayBorrow(uint256)")(amount);
  return tx.wait();
}

export async function enterMarket(
  cTokenAddress: string
): Promise<ethers.ContractTransactionReceipt | null> {
  const comptroller = await writeContract(ADDRESSES.comptroller, COMPTROLLER_ABI);
  const tx = await fn(comptroller, "enterMarkets(address[])")([cTokenAddress]);
  return tx.wait();
}

export async function exitMarket(
  cTokenAddress: string
): Promise<ethers.ContractTransactionReceipt | null> {
  const comptroller = await writeContract(ADDRESSES.comptroller, COMPTROLLER_ABI);
  const tx = await fn(comptroller, "exitMarket(address)")(cTokenAddress);
  return tx.wait();
}

export function formatUSD(value: number): string {
  if (!isFinite(value)) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatAPY(value: number): string {
  if (!isFinite(value) || isNaN(value)) return "-";
  return `${value.toFixed(2)}%`;
}

export function formatToken(value: string, decimals: number = 4): string {
  const num = parseFloat(value);
  if (isNaN(num)) return "0";
  return num.toFixed(decimals);
}

export function formatTokenSmart(
  value: string | number,
  symbol: string,
  decimals: number = 4
): string {
  const num = typeof value === "number" ? value : parseFloat(value);

  if (!isFinite(num) || isNaN(num) || num === 0) {
    return `${(0).toFixed(decimals)} ${symbol}`;
  }

  const minVisible = 1 / 10 ** decimals;

  if (num > 0 && num < minVisible) {
    return `< ${minVisible.toFixed(decimals)} ${symbol}`;
  }

  return `${num.toFixed(decimals)} ${symbol}`;
}

export function formatTokenExact(value: string | number, symbol: string): string {
  const raw = typeof value === "number" ? value.toString() : value;
  const num = parseFloat(raw);

  if (!isFinite(num) || isNaN(num) || num === 0) {
    return `0 ${symbol}`;
  }

  return `${raw.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "")} ${symbol}`;
}

export function getTransactionErrorMessage(error: unknown): string {
  const err = error as {
    code?: string;
    reason?: string;
    shortMessage?: string;
    message?: string;
    info?: { error?: { message?: string } };
  };

  const rawMessage = [
    err.reason,
    err.shortMessage,
    err.info?.error?.message,
    err.message,
  ]
    .filter(Boolean)
    .join(" ");
  const message = rawMessage.toLowerCase();

  if (err.code === "ACTION_REJECTED" || message.includes("user rejected")) {
    return "Transaction was rejected in MetaMask.";
  }

  if (message.includes("insufficient funds")) {
    return "You do not have enough wallet balance to pay for this transaction and gas.";
  }

  if (message.includes("missing revert data") || err.code === "CALL_EXCEPTION") {
    return "The contract rejected this action. Check that you have enough collateral enabled, the amount is within your limit, and the app is using the latest deployed contract addresses.";
  }

  const revertedMatch = rawMessage.match(/execution reverted(?::| with reason string)?\s*["']?([^"',\n)]*)/i);
  if (revertedMatch?.[1]) {
    return `Transaction reverted: ${revertedMatch[1].trim()}`;
  }

  return err.shortMessage || err.reason || err.message || "Transaction failed";
}

export function formatHealthFactor(hf: number): string {
  if (!isFinite(hf)) return "∞";
  return hf.toFixed(2);
}
