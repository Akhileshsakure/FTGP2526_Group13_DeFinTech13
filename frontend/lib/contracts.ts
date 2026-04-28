// lib/contracts.ts
// Contract ABIs and address configuration for the current lending contracts.

const SEPOLIA_USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const SEPOLIA_DAI = "0x3e622317f8C93f7328350cF0B56d9eD4C620C5d6";
const SEPOLIA_WETH = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14";

export const ADDRESSES = {
  comptroller: process.env.NEXT_PUBLIC_COMPTROLLER_ADDRESS as string,
  router: process.env.NEXT_PUBLIC_ROUTER_ADDRESS as string,
  oracle: process.env.NEXT_PUBLIC_ORACLE_ADDRESS as string,

  cETH: process.env.NEXT_PUBLIC_CETH_ADDRESS as string,
  cUSDC: process.env.NEXT_PUBLIC_CUSDC_ADDRESS as string,
  cDAI: process.env.NEXT_PUBLIC_CDAI_ADDRESS as string,
  cWBTC: process.env.NEXT_PUBLIC_CWBTC_ADDRESS as string,
  cWETH: process.env.NEXT_PUBLIC_CWETH_ADDRESS as string,
  cUSDT: process.env.NEXT_PUBLIC_CUSDT_ADDRESS as string,

  USDC: process.env.NEXT_PUBLIC_USDC_ADDRESS || SEPOLIA_USDC,
  DAI: process.env.NEXT_PUBLIC_DAI_ADDRESS || SEPOLIA_DAI,
  WBTC: process.env.NEXT_PUBLIC_WBTC_ADDRESS as string,
  WETH: process.env.NEXT_PUBLIC_WETH_ADDRESS || SEPOLIA_WETH,
  USDT: process.env.NEXT_PUBLIC_USDT_ADDRESS as string,
} as const;

export interface MarketConfig {
  id: string;
  name: string;
  symbol: string;
  cTokenAddress: string;
  underlyingAddress: string | null;
  isNative: boolean;
  decimals: number;
  icon: string;
  collateralFactor: number;
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
    icon: "◇",
    collateralFactor: 80,
  },
  {
    id: "wbtc",
    name: "Wrapped Bitcoin",
    symbol: "WBTC",
    cTokenAddress: ADDRESSES.cWBTC,
    underlyingAddress: ADDRESSES.WBTC,
    isNative: false,
    decimals: 8,
    icon: "B",
    collateralFactor: 70,
  },
  {
    id: "weth",
    name: "Wrapped Ether",
    symbol: "WETH",
    cTokenAddress: ADDRESSES.cWETH,
    underlyingAddress: ADDRESSES.WETH,
    isNative: false,
    decimals: 18,
    icon: "W",
    collateralFactor: 75,
  },
  {
    id: "usdt",
    name: "Tether USD",
    symbol: "USDT",
    cTokenAddress: ADDRESSES.cUSDT,
    underlyingAddress: ADDRESSES.USDT,
    isNative: false,
    decimals: 6,
    icon: "T",
    collateralFactor: 75,
  },
];

export const COMPTROLLER_ABI = [
  "function getAccountLiquidity(address) view returns (uint256,uint256,uint256)",
  "function getAccountHealthFactor(address) view returns (uint256,uint256)",
  "function getHypotheticalAccountLiquidity(address,address,uint256,uint256) view returns (uint256,uint256,uint256)",
  "function markets(address) view returns (bool,uint256,uint256,uint256,uint256,uint256)",
  "function accountMembership(address,address) view returns (bool)",
  "function checkMembership(address,address) view returns (bool)",
  "function getAssetsIn(address) view returns (address[])",
  "function getAllMarkets() view returns (address[])",
  "function closeFactorMantissa() view returns (uint256)",
  "function oracle() view returns (address)",
  "function enterMarkets(address[]) returns (uint256[])",
  "function exitMarket(address) returns (uint256)",
] as const;

export const CTOKEN_BASE_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function exchangeRateStored() view returns (uint256)",
  "function exchangeRateCurrent() returns (uint256)",
  "function borrowBalanceStored(address) view returns (uint256)",
  "function borrowBalanceCurrent(address) returns (uint256)",
  "function totalBorrows() view returns (uint256)",
  "function totalBorrowsCurrent() returns (uint256)",
  "function totalReserves() view returns (uint256)",
  "function reserveFactorMantissa() view returns (uint256)",
  "function interestRateStrategy() view returns (address)",
  "function borrowIndex() view returns (uint256)",
  "function accrualTimestamp() view returns (uint256)",
  "function getCashPrior() view returns (uint256)",
  "function getAccountSnapshot(address) view returns (uint256,uint256,uint256,uint256)",
  "function mint(uint256) returns (uint256)",
  "function redeem(uint256) returns (uint256)",
  "function redeemUnderlying(uint256) returns (uint256)",
  "function borrow(uint256) returns (uint256)",
  "function repayBorrow(uint256) returns (uint256)",
  "function repayBorrowBehalf(address,uint256) returns (uint256)",
] as const;

export const CETH_ABI = [
  ...CTOKEN_BASE_ABI,
  "function mint() payable returns (uint256)",
  "function repayBorrow() payable returns (uint256)",
  "function repayBorrowBehalf(address) payable returns (uint256)",
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
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function transfer(address,uint256) returns (bool)",
  "function transferFrom(address,address,uint256) returns (bool)",
  "event Approval(address indexed owner, address indexed spender, uint256 value)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
] as const;

export const ORACLE_ABI = [
  "function getUnderlyingPrice(address) view returns (uint256)",
  "function prices(address) view returns (uint256)",
  "function getPriceHistory(address) view returns ((uint256 price,uint256 timestamp)[])",
] as const;

export const INTEREST_STRATEGY_ABI = [
  "function getBorrowRate(uint256,uint256,uint256) view returns (uint256)",
] as const;

export const ROUTER_ABI = [
  "function loopLeverage((address cToken, uint256 amount, bool isNative, bool enterMarket) initialSupply, (address cTokenBorrow, bool borrowIsNative, uint256 borrowAmount, address swapAdapter, address tokenOut, uint256 minAmountOut, bytes swapData, address cTokenSupply, bool supplyIsNative, bool enterMarket)[] steps) payable",
  "function comptroller() view returns (address)",
  "function wrappedNative() view returns (address)",
  "function owner() view returns (address)",
] as const;

export function getCTokenABI(market: MarketConfig) {
  return market.isNative ? CETH_ABI : CERC20_ABI;
}
