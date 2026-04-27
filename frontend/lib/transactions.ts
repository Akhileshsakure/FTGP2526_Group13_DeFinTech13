// lib/transactions.ts
// Read user protocol activity from cToken and Comptroller events.

import { Contract, EventLog, Log, TransactionResponse, ethers } from "ethers";
import { ADDRESSES, COMPTROLLER_ABI, MARKETS, getCTokenABI, type MarketConfig } from "./contracts";
import { formatUnits, getReadProvider, shortAddress } from "./ethers";

const DEFAULT_HISTORY_BLOCKS = 75_000;
const EVENT_ABI = [
  "event Mint(address indexed minter, uint256 mintAmount, uint256 mintTokens)",
  "event Redeem(address indexed redeemer, uint256 redeemAmount, uint256 redeemTokens)",
  "event Borrow(address indexed borrower, uint256 borrowAmount, uint256 accountBorrowsNew, uint256 totalBorrowsNew)",
  "event RepayBorrow(address indexed payer, address indexed borrower, uint256 repayAmount, uint256 accountBorrowsNew, uint256 totalBorrowsNew)",
  "event MarketEntered(address cToken, address account)",
  "event MarketExited(address cToken, address account)",
] as const;

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

function historyBlockWindow(): number {
  const configured = Number(process.env.NEXT_PUBLIC_TX_HISTORY_BLOCKS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_HISTORY_BLOCKS;
}

function isEventLog(log: EventLog | Log): log is EventLog {
  return "args" in log && "eventName" in log;
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

function getProtocolEvents(contract: Contract, userAddress: string, market?: MarketConfig) {
  if (market) {
    return [
      contract.filters.Mint(userAddress),
      contract.filters.Redeem(userAddress),
      contract.filters.Borrow(userAddress),
      contract.filters.RepayBorrow(null, userAddress),
    ];
  }

  return [
    contract.filters.MarketEntered(),
    contract.filters.MarketExited(),
  ];
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

function parseUserEvent(log: EventLog, market: MarketConfig): Omit<UserTransaction, "timestamp" | "from" | "to" | "value" | "gasUsed" | "status"> | null {
  const eventName = log.eventName;
  const args = log.args;
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
    return {
      ...base,
      type: "Supply",
      amount: formatAmount(BigInt(args.mintAmount), market),
      tokenAmount: `${formatUnits(BigInt(args.mintTokens), 8)} c${market.symbol}`,
      userAddress: args.minter,
    };
  }

  if (eventName === "Redeem") {
    return {
      ...base,
      type: "Withdraw",
      amount: formatAmount(BigInt(args.redeemAmount), market),
      tokenAmount: `${formatUnits(BigInt(args.redeemTokens), 8)} c${market.symbol}`,
      userAddress: args.redeemer,
    };
  }

  if (eventName === "Borrow") {
    return {
      ...base,
      type: "Borrow",
      amount: formatAmount(BigInt(args.borrowAmount), market),
      tokenAmount: null,
      userAddress: args.borrower,
    };
  }

  if (eventName === "RepayBorrow") {
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

function parseComptrollerEvent(log: EventLog): Omit<UserTransaction, "timestamp" | "from" | "to" | "value" | "gasUsed" | "status"> | null {
  const market = getMarketByCToken(log.args.cToken);
  if (!market) return null;

  const type: TransactionType =
    log.eventName === "MarketEntered" ? "Enable Collateral" : "Disable Collateral";

  return {
    id: `${log.transactionHash}-${log.index}`,
    type,
    market,
    amount: null,
    tokenAmount: null,
    userAddress: log.args.account,
    counterpartyAddress: null,
    contractAddress: log.address,
    transactionHash: log.transactionHash,
    blockNumber: log.blockNumber,
  };
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

export async function fetchUserTransactions(userAddress: string): Promise<UserTransaction[]> {
  const provider = getReadProvider();
  const latestBlock = await provider.getBlockNumber();
  const fromBlock = Math.max(0, latestBlock - historyBlockWindow());

  const marketLogs = await Promise.all(
    MARKETS.map(async (market) => {
      const contract = new Contract(
        market.cTokenAddress,
        [...getCTokenABI(market), ...EVENT_ABI],
        provider
      );
      const filters = getProtocolEvents(contract, userAddress, market);
      const logs = await Promise.all(filters.map((filter) => contract.queryFilter(filter, fromBlock, latestBlock)));
      return logs.flatMap((eventLog) =>
        eventLog.filter(isEventLog).flatMap((log) => {
          const parsed = parseUserEvent(log, market);
          return parsed ? [parsed] : [];
        })
      );
    })
  );

  const comptroller = new Contract(ADDRESSES.comptroller, [...COMPTROLLER_ABI, ...EVENT_ABI], provider);
  const comptrollerLogs = await Promise.all(
    getProtocolEvents(comptroller, userAddress).map((filter) =>
      comptroller.queryFilter(filter, fromBlock, latestBlock)
    )
  );

  const parsed = [
    ...marketLogs.flat(),
    ...comptrollerLogs.flatMap((eventLog) =>
      eventLog.filter(isEventLog).flatMap((log) => {
        if (!sameAddress(log.args.account, userAddress)) return [];
        const parsedLog = parseComptrollerEvent(log);
        return parsedLog ? [parsedLog] : [];
      })
    ),
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
