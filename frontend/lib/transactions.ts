// lib/transactions.ts
// Read user protocol activity from cToken and Comptroller events.

import { Log, TransactionResponse, ethers } from "ethers";
import { ADDRESSES, MARKETS, type MarketConfig } from "./contracts";
import { formatUnits, getReadProvider, shortAddress } from "./ethers";

const DEFAULT_HISTORY_BLOCKS = 20;
const LOG_CHUNK_BLOCKS = 10;
const LOG_QUERY_DELAY_MS = 150;
const EVENT_ABI = [
  "event Mint(address indexed minter, uint256 mintAmount, uint256 mintTokens)",
  "event Redeem(address indexed redeemer, uint256 redeemAmount, uint256 redeemTokens)",
  "event Borrow(address indexed borrower, uint256 borrowAmount, uint256 accountBorrowsNew, uint256 totalBorrowsNew)",
  "event RepayBorrow(address indexed payer, address indexed borrower, uint256 repayAmount, uint256 accountBorrowsNew, uint256 totalBorrowsNew)",
  "event MarketEntered(address cToken, address account)",
  "event MarketExited(address cToken, address account)",
] as const;
const EVENT_IFACE = new ethers.Interface(EVENT_ABI);

export type TransactionType =
  | "Supply"
  | "Withdraw"
  | "Borrow"
  | "Repay"
  | "Enable Collateral"
  | "Disable Collateral";

export interface UserTransaction {
  id: string;
  type: TransactionType;
  market: MarketConfig;
  amount: string | null;
  tokenAmount: string | null;
  userAddress: string;
  counterpartyAddress: string | null;
  contractAddress: string;
  transactionHash: string;
  blockNumber: number;
  timestamp: number | null;
  from: string | null;
  to: string | null;
  value: string | null;
  gasUsed: string | null;
  status: number | null;
}

export interface CachedTransactions {
  data: UserTransaction[];
  updatedAt: number;
}

function historyBlockWindow(): number {
  const configured = Number(process.env.NEXT_PUBLIC_TX_HISTORY_BLOCKS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_HISTORY_BLOCKS;
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function sameAddress(left: string | null | undefined, right: string | null | undefined): boolean {
  return !!left && !!right && left.toLowerCase() === right.toLowerCase();
}

function formatAmount(value: bigint, market: MarketConfig): string {
  return `${formatUnits(value, market.decimals)} ${market.symbol}`;
}

function getMarketByCToken(address: string): MarketConfig | undefined {
  return MARKETS.find((market) => sameAddress(market.cTokenAddress, address));
}

async function getTransactionMeta(txHash: string) {
  const provider = getReadProvider();
  const [tx, receipt] = await Promise.all([
    provider.getTransaction(txHash),
    provider.getTransactionReceipt(txHash),
  ]);

  return {
    tx: tx as TransactionResponse | null,
    gasUsed: receipt?.gasUsed?.toString() ?? null,
    status: receipt?.status ?? null,
  };
}

function parseProtocolLog(log: Log, userAddress: string): Omit<UserTransaction, "timestamp" | "from" | "to" | "value" | "gasUsed" | "status"> | null {
  const parsed = EVENT_IFACE.parseLog({
    topics: [...log.topics],
    data: log.data,
  });
  if (!parsed) return null;

  const eventName = parsed.name;
  const args = parsed.args;
  const market = getMarketByCToken(log.address);

  if ((eventName === "MarketEntered" || eventName === "MarketExited") && sameAddress(args.account, userAddress)) {
    const collateralMarket = getMarketByCToken(args.cToken);
    if (!collateralMarket) return null;

    return {
      id: `${log.transactionHash}-${log.index}`,
      type: eventName === "MarketEntered" ? "Enable Collateral" : "Disable Collateral",
      market: collateralMarket,
      amount: null,
      tokenAmount: null,
      userAddress: args.account,
      counterpartyAddress: null,
      contractAddress: log.address,
      transactionHash: log.transactionHash,
      blockNumber: log.blockNumber,
    };
  }

  if (!market) return null;

  const base = {
    id: `${log.transactionHash}-${log.index}`,
    market,
    userAddress: "",
    counterpartyAddress: null,
    contractAddress: log.address,
    transactionHash: log.transactionHash,
    blockNumber: log.blockNumber,
  };

  if (eventName === "Mint") {
    if (!sameAddress(args.minter, userAddress)) return null;
    return {
      ...base,
      type: "Supply",
      amount: formatAmount(BigInt(args.mintAmount), market),
      tokenAmount: `${formatUnits(BigInt(args.mintTokens), 8)} c${market.symbol}`,
      userAddress: args.minter,
    };
  }

  if (eventName === "Redeem") {
    if (!sameAddress(args.redeemer, userAddress)) return null;
    return {
      ...base,
      type: "Withdraw",
      amount: formatAmount(BigInt(args.redeemAmount), market),
      tokenAmount: `${formatUnits(BigInt(args.redeemTokens), 8)} c${market.symbol}`,
      userAddress: args.redeemer,
    };
  }

  if (eventName === "Borrow") {
    if (!sameAddress(args.borrower, userAddress)) return null;
    return {
      ...base,
      type: "Borrow",
      amount: formatAmount(BigInt(args.borrowAmount), market),
      tokenAmount: null,
      userAddress: args.borrower,
    };
  }

  if (eventName === "RepayBorrow") {
    if (!sameAddress(args.borrower, userAddress) && !sameAddress(args.payer, userAddress)) {
      return null;
    }
    return {
      ...base,
      type: "Repay",
      amount: formatAmount(BigInt(args.repayAmount), market),
      tokenAmount: null,
      userAddress: args.borrower,
      counterpartyAddress: args.payer,
    };
  }

  return null;
}

async function fetchProtocolLogs(fromBlock: number, latestBlock: number): Promise<Log[]> {
  const provider = getReadProvider();
  const addresses = [
    ...MARKETS.map((market) => market.cTokenAddress),
    ADDRESSES.comptroller,
  ].filter((address): address is string => Boolean(address));
  const logs: Log[] = [];

  for (let start = fromBlock; start <= latestBlock; start += LOG_CHUNK_BLOCKS) {
    const end = Math.min(start + LOG_CHUNK_BLOCKS - 1, latestBlock);
    logs.push(
      ...(await provider.getLogs({
        address: addresses,
        fromBlock: start,
        toBlock: end,
      }))
    );
    await wait(LOG_QUERY_DELAY_MS);
  }

  return logs;
}

async function enrichTransaction(
  tx: Omit<UserTransaction, "timestamp" | "from" | "to" | "value" | "gasUsed" | "status">,
  timestamp: number | null
): Promise<UserTransaction> {
  const meta = await getTransactionMeta(tx.transactionHash);

  return {
    ...tx,
    timestamp,
    from: meta.tx?.from ?? null,
    to: meta.tx?.to ?? null,
    value: meta.tx ? `${ethers.formatEther(meta.tx.value)} ETH` : null,
    gasUsed: meta.gasUsed,
    status: meta.status,
  };
}

export async function fetchUserTransactionsFromChain(userAddress: string): Promise<UserTransaction[]> {
  const provider = getReadProvider();
  const latestBlock = await provider.getBlockNumber();
  const fromBlock = Math.max(0, latestBlock - historyBlockWindow());

  const parsed = [
    ...(await fetchProtocolLogs(fromBlock, latestBlock)).flatMap((log) => {
      const parsedLog = parseProtocolLog(log, userAddress);
      return parsedLog ? [parsedLog] : [];
    }),
  ].sort((a, b) => b.blockNumber - a.blockNumber);

  const blockTimes = new Map<number, number | null>();
  await Promise.all(
    [...new Set(parsed.map((tx) => tx.blockNumber))].map(async (blockNumber) => {
      const block = await provider.getBlock(blockNumber);
      blockTimes.set(blockNumber, block?.timestamp ?? null);
    })
  );

  return Promise.all(parsed.map((tx) => enrichTransaction(tx, blockTimes.get(tx.blockNumber) ?? null)));
}

export async function fetchUserTransactions(userAddress: string): Promise<UserTransaction[]> {
  return (await fetchCachedUserTransactions(userAddress)).data;
}

export async function fetchCachedUserTransactions(userAddress: string): Promise<CachedTransactions> {
  if (typeof window === "undefined") {
    return { data: await fetchUserTransactionsFromChain(userAddress), updatedAt: Date.now() };
  }

  const response = await fetch(`/api/transactions?user=${encodeURIComponent(userAddress)}`);
  if (!response.ok) {
    throw new Error(`Transaction API returned ${response.status}`);
  }
  const payload = (await response.json()) as {
    success?: boolean;
    data?: UserTransaction[];
    timestamp?: number;
    error?: string;
  };
  if (!payload.success || !payload.data) {
    throw new Error(payload.error || "Could not load transactions");
  }
  return { data: payload.data, updatedAt: payload.timestamp ?? Date.now() };
}

export function formatTransactionDate(timestamp: number | null): string {
  if (!timestamp) return "Pending timestamp";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp * 1000));
}

export function formatHash(hash: string): string {
  return shortAddress(hash);
}

export function etherscanTxUrl(hash: string): string {
  return `https://sepolia.etherscan.io/tx/${hash}`;
}
