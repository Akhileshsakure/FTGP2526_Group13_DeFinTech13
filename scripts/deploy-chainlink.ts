// scripts/deploy-chainlink.ts
// Deploys the same markets as deploy.ts, but uses ChainlinkPriceOracle.

import { network } from "hardhat";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SEPOLIA_USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const SEPOLIA_DAI = "0x3e622317f8C93f7328350cF0B56d9eD4C620C5d6";
const SEPOLIA_WETH = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14";

const FEEDS = {
  ETH_USD: process.env.CHAINLINK_ETH_USD_FEED ?? "0x694AA1769357215DE4FAC081bf1f309aDC325306",
  BTC_USD: process.env.CHAINLINK_BTC_USD_FEED ?? "0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43",
  USDC_USD: process.env.CHAINLINK_USDC_USD_FEED ?? "0xA2F78ab2355fe2f984D808B5CeE7FD0A93D5270E",
  DAI_USD: process.env.CHAINLINK_DAI_USD_FEED ?? "0x14866185B1962B63C3Ea9E03Bc1da838bab34C19",
  USDT_USD:
    process.env.CHAINLINK_USDT_USD_FEED ??
    process.env.CHAINLINK_USDC_USD_FEED ??
    "0xA2F78ab2355fe2f984D808B5CeE7FD0A93D5270E",
};

async function main() {
  const connection = await network.connect();
  const ethers = connection.ethers;

  const [deployer] = await ethers.getSigners();
  console.log("Deploying Chainlink setup with:", deployer.address);
  console.log(
    "Balance:",
    ethers.formatEther(await ethers.provider.getBalance(deployer.address)),
    "ETH\n"
  );

  console.log("1. Deploying ChainlinkPriceOracle...");
  const ChainlinkOracle = await ethers.getContractFactory("ChainlinkPriceOracle");
  const oracle = await ChainlinkOracle.deploy(
    deployer.address,
    48 * 60 * 60 // max staleness: 48 hours, practical for Sepolia feeds
  );
  await oracle.waitForDeployment();
  const oracleAddr = await oracle.getAddress();
  console.log("   ChainlinkPriceOracle:", oracleAddr);

  console.log("\n2. Deploying JumpRateInterestStrategy...");
  const Strategy = await ethers.getContractFactory("JumpRateInterestStrategy");
  const strategy = await Strategy.deploy(
    deployer.address,
    ethers.parseUnits("0.02", 18),
    ethers.parseUnits("0.10", 18),
    ethers.parseUnits("3.00", 18),
    ethers.parseUnits("0.80", 18)
  );
  await strategy.waitForDeployment();
  const strategyAddr = await strategy.getAddress();
  console.log("   JumpRateInterestStrategy:", strategyAddr);

  console.log("\n3. Deploying Comptroller...");
  const Comptroller = await ethers.getContractFactory("Comptroller");
  const comptroller = await Comptroller.deploy(
    deployer.address,
    oracleAddr,
    ethers.parseUnits("0.50", 18)
  );
  await comptroller.waitForDeployment();
  const comptrollerAddr = await comptroller.getAddress();
  console.log("   Comptroller:", comptrollerAddr);

  console.log("\n4. Deploying cToken markets...");
  const CEth = await ethers.getContractFactory("CEth");
  const CErc20 = await ethers.getContractFactory("CErc20");
  const MockERC20 = await ethers.getContractFactory("MockERC20");

  const cETH = await CEth.deploy(
    deployer.address,
    "Compound Ether",
    "cETH",
    comptrollerAddr,
    strategyAddr,
    ethers.parseUnits("1", 18),
    ethers.parseUnits("0.10", 18),
    ethers.parseUnits("0.0005", 18)
  );
  await cETH.waitForDeployment();
  const cETHAddr = await cETH.getAddress();

  const cUSDC = await CErc20.deploy(
    deployer.address,
    SEPOLIA_USDC,
    "Compound USDC",
    "cUSDC",
    comptrollerAddr,
    strategyAddr,
    ethers.parseUnits("1", 18),
    ethers.parseUnits("0.10", 18),
    ethers.parseUnits("0.0005", 18)
  );
  await cUSDC.waitForDeployment();
  const cUSDCAddr = await cUSDC.getAddress();

  const cDAI = await CErc20.deploy(
    deployer.address,
    SEPOLIA_DAI,
    "Compound DAI",
    "cDAI",
    comptrollerAddr,
    strategyAddr,
    ethers.parseUnits("1", 18),
    ethers.parseUnits("0.10", 18),
    ethers.parseUnits("0.0005", 18)
  );
  await cDAI.waitForDeployment();
  const cDAIAddr = await cDAI.getAddress();

  const cWETH = await CErc20.deploy(
    deployer.address,
    SEPOLIA_WETH,
    "Compound WETH",
    "cWETH",
    comptrollerAddr,
    strategyAddr,
    ethers.parseUnits("1", 18),
    ethers.parseUnits("0.10", 18),
    ethers.parseUnits("0.0005", 18)
  );
  await cWETH.waitForDeployment();
  const cWETHAddr = await cWETH.getAddress();

  const wbtc = await MockERC20.deploy("Wrapped Bitcoin", "WBTC", 8);
  await wbtc.waitForDeployment();
  const wbtcAddr = await wbtc.getAddress();
  const cWBTC = await CErc20.deploy(
    deployer.address,
    wbtcAddr,
    "Compound WBTC",
    "cWBTC",
    comptrollerAddr,
    strategyAddr,
    ethers.parseUnits("1", 18),
    ethers.parseUnits("0.10", 18),
    ethers.parseUnits("0.0005", 18)
  );
  await cWBTC.waitForDeployment();
  const cWBTCAddr = await cWBTC.getAddress();

  const usdt = await MockERC20.deploy("Tether USD", "USDT", 6);
  await usdt.waitForDeployment();
  const usdtAddr = await usdt.getAddress();
  const cUSDT = await CErc20.deploy(
    deployer.address,
    usdtAddr,
    "Compound USDT",
    "cUSDT",
    comptrollerAddr,
    strategyAddr,
    ethers.parseUnits("1", 18),
    ethers.parseUnits("0.10", 18),
    ethers.parseUnits("0.0005", 18)
  );
  await cUSDT.waitForDeployment();
  const cUSDTAddr = await cUSDT.getAddress();

  console.log("   cETH:", cETHAddr);
  console.log("   cUSDC:", cUSDCAddr);
  console.log("   cDAI:", cDAIAddr);
  console.log("   cWETH:", cWETHAddr);
  console.log("   Mock WBTC:", wbtcAddr);
  console.log("   cWBTC:", cWBTCAddr);
  console.log("   Mock USDT:", usdtAddr);
  console.log("   cUSDT:", cUSDTAddr);

  console.log("\n5. Setting Chainlink feeds...");
  await (await (oracle as any).setFeed(cETHAddr, FEEDS.ETH_USD)).wait();
  await (await (oracle as any).setFeed(cWETHAddr, FEEDS.ETH_USD)).wait();
  await (await (oracle as any).setFeed(cWBTCAddr, FEEDS.BTC_USD)).wait();
  await (await (oracle as any).setFeed(cUSDCAddr, FEEDS.USDC_USD)).wait();
  await (await (oracle as any).setFeed(cDAIAddr, FEEDS.DAI_USD)).wait();
  await (await (oracle as any).setFeed(cUSDTAddr, FEEDS.USDT_USD)).wait();
  console.log("   Feeds set");

  console.log("\n6. Listing markets in Comptroller...");
  const markets = [
    [cETHAddr, "0.75", "0.80", "1.05"],
    [cUSDCAddr, "0.80", "0.85", "1.05"],
    [cDAIAddr, "0.80", "0.85", "1.05"],
    [cWETHAddr, "0.75", "0.80", "1.05"],
    [cWBTCAddr, "0.70", "0.75", "1.08"],
    [cUSDTAddr, "0.75", "0.80", "1.05"],
  ] as const;

  for (const [market, ltv, threshold, bonus] of markets) {
    await (await (comptroller as any)._supportMarket(
      market,
      ethers.parseUnits(ltv, 18),
      ethers.parseUnits(threshold, 18),
      ethers.parseUnits(bonus, 18)
    )).wait();
  }
  console.log("   Markets listed");

  console.log("\n7. Deploying Router...");
  const Router = await ethers.getContractFactory("CrossMarketLeverageRouter");
  const router = await Router.deploy(deployer.address, SEPOLIA_WETH, comptrollerAddr);
  await router.waitForDeployment();
  const routerAddr = await router.getAddress();
  console.log("   Router:", routerAddr);

  console.log("\n8. Approving Router in Comptroller and markets...");
  await (await (comptroller as any).setRouter(routerAddr, true)).wait();
  for (const market of [cETH, cUSDC, cDAI, cWETH, cWBTC, cUSDT]) {
    await (await (market as any).setRouter(routerAddr, true)).wait();
  }
  console.log("   Router approved");

  const frontendEnvPath = resolve(process.cwd(), "frontend", ".env.local");
  const frontendRpcUrl = process.env.NEXT_PUBLIC_RPC_URL ?? process.env.SEPOLIA_RPC_URL ?? "";
  const frontendEnv = [
    `NEXT_PUBLIC_RPC_URL=${frontendRpcUrl}`,
    `NEXT_PUBLIC_ORACLE_ADDRESS=${oracleAddr}`,
    `NEXT_PUBLIC_INTEREST_STRATEGY_ADDRESS=${strategyAddr}`,
    `NEXT_PUBLIC_COMPTROLLER_ADDRESS=${comptrollerAddr}`,
    `NEXT_PUBLIC_CETH_ADDRESS=${cETHAddr}`,
    `NEXT_PUBLIC_CUSDC_ADDRESS=${cUSDCAddr}`,
    `NEXT_PUBLIC_CDAI_ADDRESS=${cDAIAddr}`,
    `NEXT_PUBLIC_CWETH_ADDRESS=${cWETHAddr}`,
    `NEXT_PUBLIC_CWBTC_ADDRESS=${cWBTCAddr}`,
    `NEXT_PUBLIC_CUSDT_ADDRESS=${cUSDTAddr}`,
    `NEXT_PUBLIC_ROUTER_ADDRESS=${routerAddr}`,
    `NEXT_PUBLIC_USDC_ADDRESS=${SEPOLIA_USDC}`,
    `NEXT_PUBLIC_DAI_ADDRESS=${SEPOLIA_DAI}`,
    `NEXT_PUBLIC_WETH_ADDRESS=${SEPOLIA_WETH}`,
    `NEXT_PUBLIC_WBTC_ADDRESS=${wbtcAddr}`,
    `NEXT_PUBLIC_USDT_ADDRESS=${usdtAddr}`,
    "NEXT_PUBLIC_TX_HISTORY_BLOCKS=20",
    "",
  ].join("\n");

  writeFileSync(frontendEnvPath, frontendEnv, "utf8");

  console.log("\n" + "=".repeat(60));
  console.log("CHAINLINK DEPLOYMENT COMPLETE");
  console.log("Saved frontend env file:", frontendEnvPath);
  console.log("Oracle:", oracleAddr);
  console.log("Comptroller:", comptrollerAddr);
  console.log("Router:", routerAddr);
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
