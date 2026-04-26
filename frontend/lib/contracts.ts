// lib/contracts.ts
// ================================================================
// Contract ABIs and address configuration
// All ABIs are hand-extracted from the Solidity source files.
// Update addresses in .env.local after deployment.
// ================================================================

// ── Addresses ──────────────────────────────────────────────────
export const ADDRESSES = {
  comptroller: process.env.NEXT_PUBLIC_COMPTROLLER_ADDRESS as string,
  router: process.env.NEXT_PUBLIC_ROUTER_ADDRESS as string,
  oracle: process.env.NEXT_PUBLIC_ORACLE_ADDRESS as string,

  // cToken markets
  cETH: process.env.NEXT_PUBLIC_CETH_ADDRESS as string,
  cUSDC: process.env.NEXT_PUBLIC_CUSDC_ADDRESS as string,
  cDAI: process.env.NEXT_PUBLIC_CDAI_ADDRESS as string,

  // Underlying ERC20s
  USDC: process.env.NEXT_PUBLIC_USDC_ADDRESS as string,
  DAI: process.env.NEXT_PUBLIC_DAI_ADDRESS as string,
} as const;

// ── Market metadata (UI display) ──────────────────────────────
export interface MarketConfig {
  id: string;
  name: string;
  symbol: string;
  cTokenAddress: string;
  underlyingAddress: string | null; // null = native ETH
  isNative: boolean;
  decimals: number;
  icon: string; // emoji fallback
  collateralFactor: number; // percentage display e.g. 75
}

export const MARKETS: MarketConfig[] = [
  {
    id: "eth",
    name: "Ether",
    symbol: "ETH",
    cTokenAddress: ADDRESSES.cETH,
    underlyingAddress: null,
    isNative: true,
    decimals: 18,
    icon: "Ξ",
    collateralFactor: 75,
  },
  {
    id: "usdc",
    name: "USD Coin",
    symbol: "USDC",
    cTokenAddress: ADDRESSES.cUSDC,
    underlyingAddress: ADDRESSES.USDC,
    isNative: false,
    decimals: 6,
    icon: "$",
    collateralFactor: 80,
  },
  {
    id: "dai",
    name: "Dai Stablecoin",
    symbol: "DAI",
    cTokenAddress: ADDRESSES.cDAI,
    underlyingAddress: ADDRESSES.DAI,
    isNative: false,
    decimals: 18,
    icon: "◈",
    collateralFactor: 80,
  },
];

// ── ABIs ───────────────────────────────────────────────────────

export const COMPTROLLER_ABI = [
  // View
  "function getAccountLiquidity(address account) view returns (uint256 error, uint256 liquidity, uint256 shortfall)",
  "function getHypotheticalAccountLiquidity(address account, address cTokenModify, uint256 redeemTokens, uint256 borrowAmount) view returns (uint256, uint256, uint256)",
  "function markets(address cToken) view returns (bool isListed, uint256 collateralFactorMantissa)",
  "function accountMembership(address user, address cToken) view returns (bool)",
  "function accountAssets(address user, uint256 index) view returns (address)",
  "function allMarkets(uint256 index) view returns (address)",
  "function closeFactorMantissa() view returns (uint256)",
  "function liquidationIncentiveMantissa() view returns (uint256)",
  "function oracle() view returns (address)",
  // Write
  "function enterMarkets(address[] calldata cTokens) returns (uint256[])",
  "function exitMarket(address cToken) returns (uint256)",
] as const;

export const CTOKEN_BASE_ABI = [
  // ERC20
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  // Market state
  "function exchangeRateStored() view returns (uint256)",
  "function exchangeRateCurrent() returns (uint256)",
  "function borrowBalanceStored(address account) view returns (uint256)",
  "function borrowBalanceCurrent(address account) returns (uint256)",
  "function totalBorrows() view returns (uint256)",
  "function totalReserves() view returns (uint256)",
  "function reserveFactorMantissa() view returns (uint256)",
  "function borrowIndex() view returns (uint256)",
  "function accrualTimestamp() view returns (uint256)",
  "function getCashPrior() view returns (uint256)",
  "function getAccountSnapshot(address account) view returns (uint256 error, uint256 cTokenBalance, uint256 borrowBalance, uint256 exchangeRateMantissa)",
  // User actions (direct, not via router)
  "function mint(uint256 mintAmount) returns (uint256)",
  "function redeem(uint256 redeemTokens) returns (uint256)",
  "function redeemUnderlying(uint256 redeemAmount) returns (uint256)",
  "function borrow(uint256 borrowAmount) returns (uint256)",
  "function repayBorrow(uint256 repayAmount) returns (uint256)",
  "function repayBorrowBehalf(address borrower, uint256 repayAmount) returns (uint256)",
] as const;

export const CETH_ABI = [
  ...CTOKEN_BASE_ABI,
  "function mint() payable returns (uint256)",
  "function repayBorrow() payable returns (uint256)",
] as const;

export const CERC20_ABI = [
  ...CTOKEN_BASE_ABI,
  "function underlying() view returns (address)",
] as const;

export const ERC20_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function transferFrom(address from, address to, uint256 amount) returns (bool)",
  "event Approval(address indexed owner, address indexed spender, uint256 value)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
] as const;

export const ORACLE_ABI = [
  "function getUnderlyingPrice(address cToken) view returns (uint256)",
  "function prices(address asset) view returns (uint256)",
] as const;

export const INTEREST_STRATEGY_ABI = [
  "function getBorrowRate(uint256 cash, uint256 totalBorrows, uint256 totalReserves) view returns (uint256)",
  "function getSupplyRate(uint256 cash, uint256 totalBorrows, uint256 totalReserves, uint256 reserveFactorMantissa) view returns (uint256)",
  "function kink() view returns (uint256)",
  "function multiplierPerSecond() view returns (uint256)",
  "function jumpMultiplierPerSecond() view returns (uint256)",
  "function baseRatePerSecond() view returns (uint256)",
] as const;

// Router ABI — the primary entry point for all user transactions
export const ROUTER_ABI = [
  "function loopLeverage((address cToken, uint256 amount, bool isNative, bool enterMarket) initialSupply, (address cTokenBorrow, bool borrowIsNative, uint256 borrowAmount, address swapAdapter, address tokenOut, uint256 minAmountOut, bytes swapData, address cTokenSupply, bool supplyIsNative, bool enterMarket)[] steps) payable",
  "function comptroller() view returns (address)",
  "function wrappedNative() view returns (address)",
  "function owner() view returns (address)",
] as const;

// ── Helper: get cToken ABI based on market ────────────────────
export function getCTokenABI(market: MarketConfig) {
  return market.isNative ? CETH_ABI : CERC20_ABI;
}
