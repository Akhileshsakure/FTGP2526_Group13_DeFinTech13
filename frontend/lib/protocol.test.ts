import { beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => {
  const provider = {
    getBalance: vi.fn(),
  };
  const signer = {
    getAddress: vi.fn(),
  };
  const contracts = new Map<string, Record<string, ReturnType<typeof vi.fn>>>();
  const calls: Array<{ address: string; signature: string; args: unknown[] }> = [];

  class MockContract {
    address: string;

    constructor(address: string) {
      this.address = address;
    }

    getFunction(signature: string) {
      const handlers = contracts.get(this.address);
      const handler = handlers?.[signature];

      return vi.fn(async (...args: unknown[]) => {
        calls.push({ address: this.address, signature, args });
        if (!handler) {
          throw new Error(`Missing mock for ${this.address} ${signature}`);
        }
        return handler(...args);
      });
    }
  }

  return {
    provider,
    signer,
    contracts,
    calls,
    Contract: vi.fn(function (address: string) {
      return new MockContract(address);
    }),
  };
});

const ADDR = {
  comptroller: "0x0000000000000000000000000000000000000100",
  oracle: "0x0000000000000000000000000000000000000200",
  cETH: "0x0000000000000000000000000000000000000300",
  cUSDC: "0x0000000000000000000000000000000000000400",
  ETH: "0x0000000000000000000000000000000000000500",
  USDC: "0x0000000000000000000000000000000000000600",
  user: "0x0000000000000000000000000000000000000700",
  strategy: "0x0000000000000000000000000000000000000800",
} as const;

const ethMarket = {
  id: "eth",
  name: "Ether",
  symbol: "ETH",
  cTokenAddress: ADDR.cETH,
  underlyingAddress: null,
  isNative: true,
  decimals: 18,
  icon: "E",
  collateralFactor: 75,
};

const usdcMarket = {
  id: "usdc",
  name: "USD Coin",
  symbol: "USDC",
  cTokenAddress: ADDR.cUSDC,
  underlyingAddress: ADDR.USDC,
  isNative: false,
  decimals: 6,
  icon: "$",
  collateralFactor: 80,
};

vi.mock("ethers", async () => {
  const actual = await vi.importActual<typeof import("ethers")>("ethers");
  return {
    ...actual,
    Contract: testState.Contract,
  };
});

vi.mock("./ethers", async () => {
  const actual = await vi.importActual<typeof import("ethers")>("ethers");
  return {
    getReadProvider: vi.fn(() => testState.provider),
    getSigner: vi.fn(async () => testState.signer),
    parseUnits: actual.ethers.parseUnits,
    formatUnits: actual.ethers.formatUnits,
  };
});

vi.mock("./contracts", () => ({
  ADDRESSES: {
    comptroller: "0x0000000000000000000000000000000000000100",
    oracle: "0x0000000000000000000000000000000000000200",
    router: "0x0000000000000000000000000000000000000500",
    cETH: "0x0000000000000000000000000000000000000300",
    cUSDC: "0x0000000000000000000000000000000000000400",
    cDAI: "",
    cWBTC: "",
    cWETH: "",
    cUSDT: "",
    USDC: "0x0000000000000000000000000000000000000600",
    DAI: "",
    WBTC: "",
    WETH: "",
    USDT: "",
  },
  MARKETS: [
    {
      id: "eth",
      name: "Ether",
      symbol: "ETH",
      cTokenAddress: "0x0000000000000000000000000000000000000300",
      underlyingAddress: null,
      isNative: true,
      decimals: 18,
      icon: "E",
      collateralFactor: 75,
    },
    {
      id: "usdc",
      name: "USD Coin",
      symbol: "USDC",
      cTokenAddress: "0x0000000000000000000000000000000000000400",
      underlyingAddress: "0x0000000000000000000000000000000000000600",
      isNative: false,
      decimals: 6,
      icon: "$",
      collateralFactor: 80,
    },
  ],
  COMPTROLLER_ABI: [],
  CETH_ABI: [],
  CERC20_ABI: [],
  ERC20_ABI: [],
  ORACLE_ABI: [],
  INTEREST_STRATEGY_ABI: [],
  getCTokenABI: vi.fn((market) => (market.isNative ? [] : [])),
}));

import {
  approveToken,
  borrowAsset,
  calculateProjectedHealthFactor,
  checkAllowance,
  enterMarket,
  exitMarket,
  fetchAllMarkets,
  fetchBorrowRiskPreview,
  fetchMarketData,
  fetchMarketPriceHistory,
  fetchRedeemRiskPreview,
  fetchUserPositions,
  fetchWalletBalance,
  formatAPY,
  formatHealthFactor,
  formatToken,
  formatTokenExact,
  formatTokenSmart,
  formatUSD,
  getTransactionErrorMessage,
  redeemAsset,
  repayBorrow,
  supplyAsset,
  type AccountSummary,
  type MarketData,
} from "./protocol";

const WAD = 10n ** 18n;
const receipt = { hash: "0xtx" };

function mockTx() {
  return { wait: vi.fn(async () => receipt) };
}

function setContract(address: string, handlers: Record<string, ReturnType<typeof vi.fn>>) {
  testState.contracts.set(address, handlers);
}

function marketData(overrides: Partial<MarketData> = {}): MarketData {
  return {
    market: ethMarket,
    supplyAPY: 2,
    totalSupply: "10.0",
    borrowAPY: 5,
    totalBorrows: "4.0",
    utilizationRate: 40,
    priceUSD: 2000,
    collateralFactor: 75,
    liquidationThreshold: 80,
    liquidationBonus: 8,
    supplyCap: 0n,
    borrowCap: 0n,
    exchangeRate: WAD,
    ...overrides,
  };
}

beforeEach(() => {
  testState.contracts.clear();
  testState.calls.length = 0;
  vi.clearAllMocks();
  testState.provider.getBalance.mockResolvedValue(2n * WAD);
  testState.signer.getAddress.mockResolvedValue(ADDR.user);
});

describe("market reads", () => {
  it("fetchMarketData reads contract state and calculates market metrics", async () => {
    setContract(ADDR.cETH, {
      "totalSupply()": vi.fn(async () => 10n * WAD),
      "totalBorrows()": vi.fn(async () => 4n * WAD),
      "totalReserves()": vi.fn(async () => 1n * WAD),
      "reserveFactorMantissa()": vi.fn(async () => WAD / 10n),
      "getCashPrior()": vi.fn(async () => 6n * WAD),
      "exchangeRateStored()": vi.fn(async () => WAD),
      "interestRateStrategy()": vi.fn(async () => ADDR.strategy),
    });
    setContract(ADDR.oracle, {
      "getUnderlyingPrice(address)": vi.fn(async () => 2000n * WAD),
    });
    setContract(ADDR.comptroller, {
      "markets(address)": vi.fn(async () => [true, WAD * 75n / 100n, WAD * 8n / 10n, WAD * 108n / 100n, 1000n, 500n]),
    });
    setContract(ADDR.strategy, {
      "getBorrowRate(uint256,uint256,uint256)": vi.fn(async () => 1_000_000_000n),
    });

    const result = await fetchMarketData(ethMarket);

    expect(result.totalSupply).toBe("10.0");
    expect(result.totalBorrows).toBe("4.0");
    expect(result.utilizationRate).toBe(44.44);
    expect(result.priceUSD).toBe(2000);
    expect(result.collateralFactor).toBe(75);
    expect(result.liquidationThreshold).toBe(80);
    expect(result.liquidationBonus).toBe(108);
    expect(result.borrowAPY).toBeGreaterThan(0);
  });

  it("fetchAllMarkets returns the markets that load successfully", async () => {
    setContract(ADDR.cETH, {
      "totalSupply()": vi.fn(async () => 1n * WAD),
      "totalBorrows()": vi.fn(async () => 0n),
      "totalReserves()": vi.fn(async () => 0n),
      "reserveFactorMantissa()": vi.fn(async () => 0n),
      "getCashPrior()": vi.fn(async () => 1n * WAD),
      "exchangeRateStored()": vi.fn(async () => WAD),
      "interestRateStrategy()": vi.fn(async () => ADDR.strategy),
    });
    setContract(ADDR.cUSDC, {});
    setContract(ADDR.oracle, {
      "getUnderlyingPrice(address)": vi.fn(async () => 2000n * WAD),
    });
    setContract(ADDR.comptroller, {
      "markets(address)": vi.fn(async () => [true, 0n, 0n, 0n, 0n, 0n]),
    });
    setContract(ADDR.strategy, {
      "getBorrowRate(uint256,uint256,uint256)": vi.fn(async () => 0n),
    });

    const result = await fetchAllMarkets();

    expect(result).toHaveLength(1);
    expect(result[0].market.symbol).toBe("ETH");
  });

  it("fetchMarketPriceHistory maps oracle history and uses fallback when oracle history fails", async () => {
    setContract(ADDR.oracle, {
      "getPriceHistory(address)": vi.fn(async () => [
        { price: 1900n * WAD, timestamp: 2n },
        { price: 0n, timestamp: 3n },
        [2000n * WAD, 1n],
      ]),
    });

    const history = await fetchMarketPriceHistory(marketData());
    expect(history.map((point) => point.timestamp)).toEqual([1, 2]);
    expect(history[0].priceUSD).toBe(2000);

    setContract(ADDR.oracle, {
      "getPriceHistory(address)": vi.fn(async () => {
        throw new Error("no history");
      }),
    });

    const fallback = await fetchMarketPriceHistory(marketData({ priceUSD: 123 }));
    expect(fallback).toHaveLength(16);
    expect(fallback.every((point) => point.priceUSD > 0)).toBe(true);
  });
});

describe("account and on-chain risk previews", () => {
  it("fetchUserPositions builds account summary from cToken and Comptroller data", async () => {
    const md = marketData();
    setContract(ADDR.cETH, {
      "balanceOf(address)": vi.fn(async () => 2n * WAD),
      "borrowBalanceStored(address)": vi.fn(async () => 1n * WAD),
    });
    setContract(ADDR.comptroller, {
      "checkMembership(address,address)": vi.fn(async () => true),
      "getAccountLiquidity(address)": vi.fn(async () => [0n, 500n * WAD, 0n]),
      "getAccountHealthFactor(address)": vi.fn(async () => [0n, 160n * WAD / 100n]),
    });

    const summary = await fetchUserPositions(ADDR.user, [md]);

    expect(summary.totalSuppliedUSD).toBe(4000);
    expect(summary.totalBorrowedUSD).toBe(2000);
    expect(summary.availableToBorrowUSD).toBe(500);
    expect(summary.healthFactor).toBe(1.6);
    expect(summary.netAPY).toBe(-0.5);
    expect(summary.positions[0].isCollateral).toBe(true);
  });

  it("fetchBorrowRiskPreview passes borrow amount into getHypotheticalAccountLiquidity", async () => {
    setContract(ADDR.comptroller, {
      "getHypotheticalAccountLiquidity(address,address,uint256,uint256)": vi.fn(async () => [0n, 100n * WAD, 0n]),
    });

    const preview = await fetchBorrowRiskPreview(ADDR.user, usdcMarket, "12.5");

    expect(preview).toEqual({ errorCode: 0, liquidityUSD: 100, shortfallUSD: 0, allowed: true });
    expect(testState.calls[0].args).toEqual([ADDR.user, ADDR.cUSDC, 0, 12_500_000n]);
  });

  it("fetchRedeemRiskPreview converts underlying amount to cToken amount before checking liquidity", async () => {
    setContract(ADDR.comptroller, {
      "getHypotheticalAccountLiquidity(address,address,uint256,uint256)": vi.fn(async () => [0n, 0n, 25n * WAD]),
    });

    const preview = await fetchRedeemRiskPreview(ADDR.user, ethMarket, "1", 2n * WAD);

    expect(preview.allowed).toBe(false);
    expect(preview.shortfallUSD).toBe(25);
    expect(testState.calls[0].args).toEqual([ADDR.user, ADDR.cETH, WAD / 2n, 0]);
  });

  it("calculateProjectedHealthFactor uses liquidation threshold and projected borrow value", () => {
    const summary: AccountSummary = {
      totalSuppliedUSD: 3000,
      totalBorrowedUSD: 500,
      netAPY: 0,
      healthFactor: 2,
      availableToBorrowUSD: 1000,
      positions: [
        {
          market: ethMarket,
          cTokenBalance: 0n,
          supplyBalanceUnderlying: "1.0",
          supplyBalanceUSD: 2000,
          borrowBalance: "0",
          borrowBalanceUSD: 0,
          isCollateral: true,
        },
        {
          market: usdcMarket,
          cTokenBalance: 0n,
          supplyBalanceUnderlying: "1000",
          supplyBalanceUSD: 1000,
          borrowBalance: "0",
          borrowBalanceUSD: 0,
          isCollateral: false,
        },
      ],
    };

    const hf = calculateProjectedHealthFactor(summary, [marketData()], marketData(), "0.5");
    expect(hf).toBeCloseTo(1600 / 1500, 6);
    expect(calculateProjectedHealthFactor(null, [], undefined, "")).toBe(Infinity);
  });
});

describe("wallet and transaction functions", () => {
  it("fetchWalletBalance reads native and ERC20 balances", async () => {
    expect(await fetchWalletBalance(ADDR.user, ethMarket)).toBe("2.0");

    setContract(ADDR.USDC, {
      "balanceOf(address)": vi.fn(async () => 123_456_789n),
    });

    expect(await fetchWalletBalance(ADDR.user, usdcMarket)).toBe("123.456789");
  });

  it("approveToken and checkAllowance call ERC20 methods", async () => {
    setContract(ADDR.USDC, {
      "approve(address,uint256)": vi.fn(async () => mockTx()),
      "allowance(address,address)": vi.fn(async () => 99n),
    });

    expect(await approveToken(ADDR.USDC, ADDR.cUSDC, 10n)).toBe(receipt);
    expect(await checkAllowance(ADDR.USDC, ADDR.user, ADDR.cUSDC)).toBe(99n);
  });

  it("supplyAsset handles native mint and ERC20 approval plus mint", async () => {
    setContract(ADDR.cETH, {
      "mint()": vi.fn(async () => mockTx()),
    });
    expect(await supplyAsset(ethMarket, "1")).toBe(receipt);
    expect(testState.calls[0].args).toEqual([{ value: WAD }]);

    setContract(ADDR.USDC, {
      "allowance(address,address)": vi.fn(async () => 0n),
      "approve(address,uint256)": vi.fn(async () => mockTx()),
    });
    setContract(ADDR.cUSDC, {
      "mint(uint256)": vi.fn(async () => mockTx()),
    });

    expect(await supplyAsset(usdcMarket, "2.5")).toBe(receipt);
    expect(testState.calls.some((call) => call.signature === "approve(address,uint256)")).toBe(true);
    expect(testState.calls.some((call) => call.signature === "mint(uint256)")).toBe(true);
  });

  it("redeemAsset and borrowAsset call the selected cToken", async () => {
    setContract(ADDR.cETH, {
      "redeemUnderlying(uint256)": vi.fn(async () => mockTx()),
      "borrow(uint256)": vi.fn(async () => mockTx()),
    });

    expect(await redeemAsset(ethMarket, "0.25")).toBe(receipt);
    expect(await borrowAsset(ethMarket, "0.5")).toBe(receipt);
  });

  it("repayBorrow handles native repayment and ERC20 repay-full approval", async () => {
    setContract(ADDR.cETH, {
      "repayBorrow()": vi.fn(async () => mockTx()),
    });
    expect(await repayBorrow(ethMarket, "1", true)).toBe(receipt);
    expect(testState.calls[0].args).toEqual([{ value: WAD + WAD / 1000n + 1n }]);

    setContract(ADDR.USDC, {
      "allowance(address,address)": vi.fn(async () => 0n),
      "approve(address,uint256)": vi.fn(async () => mockTx()),
    });
    setContract(ADDR.cUSDC, {
      "repayBorrow(uint256)": vi.fn(async () => mockTx()),
    });

    expect(await repayBorrow(usdcMarket, "3", true)).toBe(receipt);
    expect(testState.calls.some((call) => call.signature === "approve(address,uint256)")).toBe(true);
    expect(testState.calls.some((call) => call.signature === "repayBorrow(uint256)")).toBe(true);
  });

  it("enterMarket and exitMarket call Comptroller", async () => {
    setContract(ADDR.comptroller, {
      "enterMarkets(address[])": vi.fn(async () => mockTx()),
      "exitMarket(address)": vi.fn(async () => mockTx()),
    });

    expect(await enterMarket(ADDR.cETH)).toBe(receipt);
    expect(await exitMarket(ADDR.cETH)).toBe(receipt);
  });
});

describe("formatters and error messages", () => {
  it("formats currency, APY, token balances, exact token values and health factor", () => {
    expect(formatUSD(1234.567)).toBe("$1,234.57");
    expect(formatUSD(Infinity)).toBe("-");
    expect(formatAPY(1.234)).toBe("1.23%");
    expect(formatAPY(NaN)).toBe("-");
    expect(formatToken("1.23456", 3)).toBe("1.235");
    expect(formatToken("bad")).toBe("0");
    expect(formatTokenSmart(0.00001, "ETH", 4)).toBe("< 0.0001 ETH");
    expect(formatTokenSmart("bad", "ETH")).toBe("0.0000 ETH");
    expect(formatTokenExact("1.2300", "USDC")).toBe("1.23 USDC");
    expect(formatTokenExact(0, "USDC")).toBe("0 USDC");
    expect(formatHealthFactor(Infinity)).toBe("No debt");
    expect(formatHealthFactor(1.234)).toBe("1.23");
  });

  it("translates common wallet and contract errors into user-facing messages", () => {
    expect(getTransactionErrorMessage({ code: "ACTION_REJECTED" })).toBe("Transaction was rejected in MetaMask.");
    expect(getTransactionErrorMessage({ message: "insufficient funds for gas" })).toContain("not have enough wallet balance");
    expect(getTransactionErrorMessage({ code: "CALL_EXCEPTION" })).toContain("contract rejected");
    expect(getTransactionErrorMessage({ message: "execution reverted: paused" })).toBe("Transaction reverted: paused");
    expect(getTransactionErrorMessage({ shortMessage: "custom error" })).toBe("custom error");
    expect(getTransactionErrorMessage({})).toBe("Transaction failed");
  });
});
