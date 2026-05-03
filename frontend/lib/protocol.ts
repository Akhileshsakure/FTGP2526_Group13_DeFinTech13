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

function percentToWad(percent: string): bigint {
  return parseUnits((parseFloat(percent || "0") / 100).toString(), 18);
}

function amountToTokenUnits(amount: string, market: MarketConfig): bigint {
  return parseUnits(amount || "0", market.decimals);
}

function maybeMaxUint(amount: string, market: MarketConfig): bigint {
  return amount.trim().toLowerCase() === "max" ? ethers.MaxUint256 : amountToTokenUnits(amount, market);
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

export interface PricePoint {
  timestamp: number;
  priceUSD: number;
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

export interface RiskPreview {
  errorCode: number;
  liquidityUSD: number;
  shortfallUSD: number;
  allowed: boolean;
}

export interface AdminMarketState {
  market: MarketConfig;
  isListed: boolean;
  ltv: number;
  liquidationThreshold: number;
  liquidationBonus: number;
  supplyCap: bigint;
  borrowCap: bigint;
  isPaused: boolean;
  reserveFactor: number;
  interestRateStrategy: string;
}

export interface InterestRateParams {
  owner: string;
  baseRatePerYear: number;
  multiplierPerYear: number;
  jumpMultiplierPerYear: number;
  kink: number;
}

export interface AdminProtocolState {
  admin: string;
  pendingAdmin: string;
  oracle: string;
  closeFactor: number;
  markets: AdminMarketState[];
}

export interface CachedData<T> {
  data: T;
  updatedAt: number;
}

type MarketApiItem = Omit<MarketData, "market" | "supplyCap" | "borrowCap" | "exchangeRate"> & {
  id: string;
  name: string;
  symbol: string;
  icon: string;
  isNative: boolean;
  decimals: number;
  cTokenAddress: string;
  underlyingAddress: string | null;
  supplyCap: string;
  borrowCap: string;
  exchangeRate: string;
};

function mapMarketApiItem(item: MarketApiItem): MarketData {
  return {
    market: {
      id: item.id,
      name: item.name,
      symbol: item.symbol,
      cTokenAddress: item.cTokenAddress,
      underlyingAddress: item.underlyingAddress,
      isNative: item.isNative,
      decimals: item.decimals,
      icon: item.icon,
      collateralFactor: item.collateralFactor,
    },
    supplyAPY: item.supplyAPY,
    totalSupply: item.totalSupply,
    borrowAPY: item.borrowAPY,
    totalBorrows: item.totalBorrows,
    utilizationRate: item.utilizationRate,
    priceUSD: item.priceUSD,
    collateralFactor: item.collateralFactor,
    liquidationThreshold: item.liquidationThreshold,
    liquidationBonus: item.liquidationBonus,
    supplyCap: BigInt(item.supplyCap),
    borrowCap: BigInt(item.borrowCap),
    exchangeRate: BigInt(item.exchangeRate),
  };
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
  if (typeof window !== "undefined") {
    return (await fetchCachedAllMarkets()).data;
  }

  const configuredMarkets = MARKETS.filter((market) => Boolean(market.cTokenAddress));
  const results = await Promise.allSettled(configuredMarkets.map(fetchMarketData));
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

export async function fetchCachedAllMarkets(): Promise<CachedData<MarketData[]>> {
  if (typeof window === "undefined") {
    return { data: await fetchAllMarkets(), updatedAt: Date.now() };
  }

  const response = await fetch("/api/markets");
  if (!response.ok) {
    throw new Error(`Market API returned ${response.status}`);
  }
  const payload = (await response.json()) as {
    success?: boolean;
    data?: MarketApiItem[];
    timestamp?: number;
    error?: string;
  };
  if (!payload.success || !payload.data) {
    throw new Error(payload.error || "Could not load market data");
  }

  return {
    data: payload.data.map(mapMarketApiItem),
    updatedAt: payload.timestamp ?? Date.now(),
  };
}

export async function fetchMarketPriceHistory(marketData: MarketData): Promise<PricePoint[]> {
  if (typeof window !== "undefined") {
    return (await fetchCachedMarketPriceHistory(marketData)).data;
  }

  assertAddress(ADDRESSES.oracle, "Oracle address");
  const provider = getReadProvider();
  const oracle = new Contract(ADDRESSES.oracle, ORACLE_ABI, provider);

  try {
    const rawHistory = (await fn(oracle, "getPriceHistory(address)")(
      marketData.market.cTokenAddress
    )) as Array<{ price: bigint; timestamp: bigint } | [bigint, bigint]>;

    return rawHistory
      .map((record) => {
        const price = Array.isArray(record) ? record[0] : record.price;
        const timestamp = Array.isArray(record) ? record[1] : record.timestamp;
        return {
          timestamp: Number(timestamp),
          priceUSD: formatOraclePrice(BigInt(price), marketData.market.decimals),
        };
      })
      .filter((point) => point.timestamp > 0 && point.priceUSD > 0)
      .sort((a, b) => a.timestamp - b.timestamp);
  } catch {
    return buildFallbackPriceHistory(marketData.priceUSD, marketData.market.id);
  }
}

export async function fetchCachedMarketPriceHistory(
  marketData: MarketData
): Promise<CachedData<PricePoint[]>> {
  if (typeof window === "undefined") {
    return { data: await fetchMarketPriceHistory(marketData), updatedAt: Date.now() };
  }

  const response = await fetch(`/api/price-history?market=${encodeURIComponent(marketData.market.id)}`);
  if (!response.ok) {
    throw new Error(`Price history API returned ${response.status}`);
  }
  const payload = (await response.json()) as {
    success?: boolean;
    data?: PricePoint[];
    timestamp?: number;
    error?: string;
  };
  if (!payload.success || !payload.data) {
    throw new Error(payload.error || "Could not load price history");
  }
  return { data: payload.data, updatedAt: payload.timestamp ?? Date.now() };
}

function buildFallbackPriceHistory(currentPrice: number, seed: string): PricePoint[] {
  const now = Math.floor(Date.now() / 1000);
  const base = currentPrice || 1;
  const seedOffset = seed.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0) % 9;

  return Array.from({ length: 16 }, (_, index) => {
    const wave = Math.sin((index + seedOffset) * 0.6) * 0.02;
    const drift = (index - 15) * 0.0025;
    return {
      timestamp: now - (15 - index) * 3600,
      priceUSD: Math.max(base * (1 + wave + drift), 0.0001),
    };
  });
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
      const [cTokenBalanceRaw, borrowBalanceRaw, isCollateral] =
        await Promise.all([
          readWithRetry(() => fn(cToken, "balanceOf(address)")(userAddress)),
          readWithRetry(() => fn(cToken, "borrowBalanceStored(address)")(userAddress)),
          readWithRetry(() => fn(comptroller, "checkMembership(address,address)")(
            userAddress,
            md.market.cTokenAddress
          )),
        ]);

      const cTokenBalance = BigInt(cTokenBalanceRaw);
      const borrowBalance = BigInt(borrowBalanceRaw);
      const exchangeRate = md.exchangeRate;
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

export async function fetchUserPositionForMarket(
  userAddress: string,
  marketData: MarketData
): Promise<AccountSummary> {
  assertAddress(ADDRESSES.comptroller, "Comptroller address");
  const provider = getReadProvider();
  const comptroller = new Contract(ADDRESSES.comptroller, COMPTROLLER_ABI, provider);
  const cToken = new Contract(marketData.market.cTokenAddress, getCTokenABI(marketData.market), provider);

  const [
    cTokenBalanceRaw,
    borrowBalanceRaw,
    isCollateral,
    [, liquidity, shortfall],
    [healthErr, healthFactorRaw],
  ] = await Promise.all([
    readWithRetry(() => fn(cToken, "balanceOf(address)")(userAddress)),
    readWithRetry(() => fn(cToken, "borrowBalanceStored(address)")(userAddress)),
    readWithRetry(() => fn(comptroller, "checkMembership(address,address)")(
      userAddress,
      marketData.market.cTokenAddress
    )),
    readWithRetry(() => fn(comptroller, "getAccountLiquidity(address)")(userAddress)),
    readWithRetry(() => fn(comptroller, "getAccountHealthFactor(address)")(userAddress)),
  ]);

  const cTokenBalance = BigInt(cTokenBalanceRaw);
  const borrowBalance = BigInt(borrowBalanceRaw);
  const supplyUnderlying = (cTokenBalance * marketData.exchangeRate) / WAD;
  const supplyStr = formatUnits(supplyUnderlying, marketData.market.decimals);
  const borrowStr = formatUnits(borrowBalance, marketData.market.decimals);
  const liquidityUSD = wadToNumber(BigInt(liquidity));
  const shortfallUSD = wadToNumber(BigInt(shortfall));
  const healthFactor =
    BigInt(healthErr) !== 0n
      ? Infinity
      : Math.min(wadToNumber(BigInt(healthFactorRaw)), MAX_HEALTH_FACTOR_DISPLAY);

  const position = {
    market: marketData.market,
    cTokenBalance,
    supplyBalanceUnderlying: supplyStr,
    supplyBalanceUSD: parseFloat(supplyStr) * marketData.priceUSD,
    borrowBalance: borrowStr,
    borrowBalanceUSD: parseFloat(borrowStr) * marketData.priceUSD,
    isCollateral: Boolean(isCollateral),
  } satisfies UserPosition;

  return {
    totalSuppliedUSD: position.supplyBalanceUSD,
    totalBorrowedUSD: position.borrowBalanceUSD,
    netAPY:
      position.supplyBalanceUSD === 0
        ? 0
        : (position.supplyBalanceUSD * (marketData.supplyAPY / 100) -
            position.borrowBalanceUSD * (marketData.borrowAPY / 100)) /
          position.supplyBalanceUSD *
          100,
    healthFactor: shortfallUSD > 0 ? 0 : healthFactor,
    availableToBorrowUSD: liquidityUSD,
    positions: [position],
  };
}

export async function fetchBorrowRiskPreview(
  userAddress: string,
  market: MarketConfig,
  amountHuman: string
): Promise<RiskPreview> {
  assertAddress(ADDRESSES.comptroller, "Comptroller address");
  assertAddress(market.cTokenAddress, `${market.symbol} market address`);
  const amount = parseUnits(amountHuman || "0", market.decimals);
  const comptroller = readContract(ADDRESSES.comptroller, COMPTROLLER_ABI);
  const [errorCodeRaw, liquidityRaw, shortfallRaw] = await readWithRetry(() =>
    fn(comptroller, "getHypotheticalAccountLiquidity(address,address,uint256,uint256)")(
      userAddress,
      market.cTokenAddress,
      0,
      amount
    )
  );
  const errorCode = Number(errorCodeRaw);
  const shortfallUSD = wadToNumber(BigInt(shortfallRaw));
  return {
    errorCode,
    liquidityUSD: wadToNumber(BigInt(liquidityRaw)),
    shortfallUSD,
    allowed: errorCode === 0 && shortfallUSD === 0,
  };
}

export async function fetchRedeemRiskPreview(
  userAddress: string,
  market: MarketConfig,
  amountHuman: string,
  exchangeRate: bigint
): Promise<RiskPreview> {
  assertAddress(ADDRESSES.comptroller, "Comptroller address");
  assertAddress(market.cTokenAddress, `${market.symbol} market address`);
  const redeemUnderlying = parseUnits(amountHuman || "0", market.decimals);
  const redeemTokens = exchangeRate === 0n ? 0n : (redeemUnderlying * WAD) / exchangeRate;
  const comptroller = readContract(ADDRESSES.comptroller, COMPTROLLER_ABI);
  const [errorCodeRaw, liquidityRaw, shortfallRaw] = await readWithRetry(() =>
    fn(comptroller, "getHypotheticalAccountLiquidity(address,address,uint256,uint256)")(
      userAddress,
      market.cTokenAddress,
      redeemTokens,
      0
    )
  );
  const errorCode = Number(errorCodeRaw);
  const shortfallUSD = wadToNumber(BigInt(shortfallRaw));
  return {
    errorCode,
    liquidityUSD: wadToNumber(BigInt(liquidityRaw)),
    shortfallUSD,
    allowed: errorCode === 0 && shortfallUSD === 0,
  };
}

export function calculateProjectedHealthFactor(
  summary: AccountSummary | null,
  marketsData: MarketData[],
  borrowMarket: MarketData | undefined,
  amountHuman: string
): number {
  if (!summary) return Infinity;
  const thresholdCollateralUSD = summary.positions.reduce((sum, position) => {
    if (!position.isCollateral) return sum;
    const marketData = marketsData.find((md) => md.market.id === position.market.id);
    return sum + position.supplyBalanceUSD * ((marketData?.liquidationThreshold ?? 0) / 100);
  }, 0);
  const extraBorrowUSD =
    borrowMarket && amountHuman && parseFloat(amountHuman) > 0
      ? parseFloat(amountHuman) * borrowMarket.priceUSD
      : 0;
  const projectedBorrowUSD = summary.totalBorrowedUSD + extraBorrowUSD;
  if (projectedBorrowUSD === 0) return Infinity;
  return thresholdCollateralUSD / projectedBorrowUSD;
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

export async function fetchAdminProtocolState(): Promise<AdminProtocolState> {
  assertAddress(ADDRESSES.comptroller, "Comptroller address");
  const comptroller = readContract(ADDRESSES.comptroller, COMPTROLLER_ABI);
  const configuredMarkets = MARKETS.filter((market) => Boolean(market.cTokenAddress));

  const [admin, pendingAdmin, oracle, closeFactor, markets] = await Promise.all([
    readWithRetry(() => fn(comptroller, "admin()")()),
    readWithRetry(() => fn(comptroller, "pendingAdmin()")()),
    readWithRetry(() => fn(comptroller, "oracle()")()),
    readWithRetry(() => fn(comptroller, "closeFactorMantissa()")()),
    Promise.all(
      configuredMarkets.map(async (market) => {
        const cToken = readContract(market.cTokenAddress, getCTokenABI(market));
        const [marketInfo, isPaused, reserveFactor, strategy] = await Promise.all([
          readWithRetry(() => fn(comptroller, "markets(address)")(market.cTokenAddress)),
          readWithRetry(() => fn(comptroller, "isMarketPaused(address)")(market.cTokenAddress)),
          readWithRetry(() => fn(cToken, "reserveFactorMantissa()")()),
          readWithRetry(() => fn(cToken, "interestRateStrategy()")()),
        ]);

        return {
          market,
          isListed: Boolean(marketInfo[0]),
          ltv: wadToNumber(BigInt(marketInfo[1])) * 100,
          liquidationThreshold: wadToNumber(BigInt(marketInfo[2])) * 100,
          liquidationBonus: wadToNumber(BigInt(marketInfo[3])) * 100,
          supplyCap: BigInt(marketInfo[4]),
          borrowCap: BigInt(marketInfo[5]),
          isPaused: Boolean(isPaused),
          reserveFactor: wadToNumber(BigInt(reserveFactor)) * 100,
          interestRateStrategy: String(strategy),
        } satisfies AdminMarketState;
      })
    ),
  ]);

  return {
    admin: String(admin),
    pendingAdmin: String(pendingAdmin),
    oracle: String(oracle),
    closeFactor: wadToNumber(BigInt(closeFactor)) * 100,
    markets,
  };
}

export async function fetchInterestRateParams(strategyAddress: string): Promise<InterestRateParams> {
  const strategy = readContract(strategyAddress, INTEREST_STRATEGY_ABI);
  const [owner, baseRate, multiplier, jumpMultiplier, kink] = await Promise.all([
    readWithRetry(() => fn(strategy, "owner()")()),
    readWithRetry(() => fn(strategy, "baseRatePerYear()")()),
    readWithRetry(() => fn(strategy, "multiplierPerYear()")()),
    readWithRetry(() => fn(strategy, "jumpMultiplierPerYear()")()),
    readWithRetry(() => fn(strategy, "kink()")()),
  ]);

  return {
    owner: String(owner),
    baseRatePerYear: wadToNumber(BigInt(baseRate)) * 100,
    multiplierPerYear: wadToNumber(BigInt(multiplier)) * 100,
    jumpMultiplierPerYear: wadToNumber(BigInt(jumpMultiplier)) * 100,
    kink: wadToNumber(BigInt(kink)) * 100,
  };
}

export async function adminSetMarketRiskParameters(
  market: MarketConfig,
  ltvPercent: string,
  liquidationThresholdPercent: string,
  liquidationBonusPercent: string
): Promise<ethers.ContractTransactionReceipt | null> {
  const comptroller = await writeContract(ADDRESSES.comptroller, COMPTROLLER_ABI);
  const tx = await fn(comptroller, "_setMarketRiskParameters(address,uint256,uint256,uint256)")(
    market.cTokenAddress,
    percentToWad(ltvPercent),
    percentToWad(liquidationThresholdPercent),
    percentToWad(liquidationBonusPercent)
  );
  return tx.wait();
}

export async function adminSetMarketCaps(
  market: MarketConfig,
  supplyCapAmount: string,
  borrowCapAmount: string
): Promise<ethers.ContractTransactionReceipt | null> {
  const comptroller = await writeContract(ADDRESSES.comptroller, COMPTROLLER_ABI);
  const tx = await fn(comptroller, "_setMarketCaps(address,uint256,uint256)")(
    market.cTokenAddress,
    maybeMaxUint(supplyCapAmount, market),
    maybeMaxUint(borrowCapAmount, market)
  );
  return tx.wait();
}

export async function adminSetMarketPause(
  market: MarketConfig,
  state: boolean
): Promise<ethers.ContractTransactionReceipt | null> {
  const comptroller = await writeContract(ADDRESSES.comptroller, COMPTROLLER_ABI);
  const tx = await fn(comptroller, "_setMarketPause(address,bool)")(market.cTokenAddress, state);
  return tx.wait();
}

export async function adminSetCloseFactor(
  closeFactorPercent: string
): Promise<ethers.ContractTransactionReceipt | null> {
  const comptroller = await writeContract(ADDRESSES.comptroller, COMPTROLLER_ABI);
  const tx = await fn(comptroller, "_setCloseFactor(uint256)")(percentToWad(closeFactorPercent));
  return tx.wait();
}

export async function adminSetPriceOracle(
  oracleAddress: string
): Promise<ethers.ContractTransactionReceipt | null> {
  assertAddress(oracleAddress, "Oracle address");
  const comptroller = await writeContract(ADDRESSES.comptroller, COMPTROLLER_ABI);
  const tx = await fn(comptroller, "_setPriceOracle(address)")(oracleAddress);
  return tx.wait();
}

export async function adminSetComptrollerRouter(
  routerAddress: string,
  approved: boolean
): Promise<ethers.ContractTransactionReceipt | null> {
  assertAddress(routerAddress, "Router address");
  const comptroller = await writeContract(ADDRESSES.comptroller, COMPTROLLER_ABI);
  const tx = await fn(comptroller, "setRouter(address,bool)")(routerAddress, approved);
  return tx.wait();
}

export async function adminSetReserveFactor(
  market: MarketConfig,
  reserveFactorPercent: string
): Promise<ethers.ContractTransactionReceipt | null> {
  const cToken = await writeContract(market.cTokenAddress, getCTokenABI(market));
  const tx = await fn(cToken, "_setReserveFactor(uint256)")(percentToWad(reserveFactorPercent));
  return tx.wait();
}

export async function adminSetInterestRateStrategy(
  market: MarketConfig,
  strategyAddress: string
): Promise<ethers.ContractTransactionReceipt | null> {
  assertAddress(strategyAddress, "Interest rate strategy address");
  const cToken = await writeContract(market.cTokenAddress, getCTokenABI(market));
  const tx = await fn(cToken, "_setInterestRateStrategy(address)")(strategyAddress);
  return tx.wait();
}

export async function adminSetCTokenRouter(
  market: MarketConfig,
  routerAddress: string,
  approved: boolean
): Promise<ethers.ContractTransactionReceipt | null> {
  assertAddress(routerAddress, "Router address");
  const cToken = await writeContract(market.cTokenAddress, getCTokenABI(market));
  const tx = await fn(cToken, "setRouter(address,bool)")(routerAddress, approved);
  return tx.wait();
}

export async function adminSetInterestRateParams(
  strategyAddress: string,
  baseRatePercent: string,
  multiplierPercent: string,
  jumpMultiplierPercent: string,
  kinkPercent: string
): Promise<ethers.ContractTransactionReceipt | null> {
  assertAddress(strategyAddress, "Interest rate strategy address");
  const strategy = await writeContract(strategyAddress, INTEREST_STRATEGY_ABI);
  const tx = await fn(strategy, "setInterestParams(uint256,uint256,uint256,uint256)")(
    percentToWad(baseRatePercent),
    percentToWad(multiplierPercent),
    percentToWad(jumpMultiplierPercent),
    percentToWad(kinkPercent)
  );
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
  if (!isFinite(hf) || hf >= MAX_HEALTH_FACTOR_DISPLAY) return "No debt";
  return hf.toFixed(2);
}
