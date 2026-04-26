// scripts/deploy.ts — Hardhat 3 compatible
import { network } from "hardhat";

async function main() {
  // In Hardhat 3 with hardhat-toolbox-mocha-ethers,
  // ethers is accessed via the network connection
  const connection = await network.connect();
  const ethers = connection.ethers;

  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);
  console.log(
    "Balance:",
    ethers.formatEther(await ethers.provider.getBalance(deployer.address)),
    "ETH\n"
  );

  // ── 1. MockPriceOracle ──────────────────────────────
  console.log("1. Deploying MockPriceOracle...");
  const Oracle = await ethers.getContractFactory("MockPriceOracle");
  const oracle = await Oracle.deploy();
  await oracle.waitForDeployment();
  const oracleAddr = await oracle.getAddress();
  console.log("   ✓ MockPriceOracle:", oracleAddr);

  // ── 2. JumpRateInterestStrategy ─────────────────────
  console.log("\n2. Deploying JumpRateInterestStrategy...");
  const Strategy = await ethers.getContractFactory("JumpRateInterestStrategy");
  const strategy = await Strategy.deploy(
    ethers.parseUnits("0.02", 18),   // baseRatePerYear 2%
    ethers.parseUnits("0.10", 18),   // multiplierPerYear 10%
    ethers.parseUnits("3.00", 18),   // jumpMultiplier 300%
    ethers.parseUnits("0.80", 18),   // kink 80%
    deployer.address
  );
  await strategy.waitForDeployment();
  const strategyAddr = await strategy.getAddress();
  console.log("   ✓ JumpRateInterestStrategy:", strategyAddr);

  // ── 3. Comptroller ──────────────────────────────────
  console.log("\n3. Deploying Comptroller...");
  const Comptroller = await ethers.getContractFactory("Comptroller");
  const comptroller = await Comptroller.deploy(
    deployer.address,
    oracleAddr,
    ethers.parseUnits("0.50", 18),   // closeFactor 50%
    ethers.parseUnits("1.08", 18)    // liquidationIncentive 8%
  );
  await comptroller.waitForDeployment();
  const comptrollerAddr = await comptroller.getAddress();
  console.log("   ✓ Comptroller:", comptrollerAddr);

  // ── 4. CEth ────────────────────────────────────────
  console.log("\n4. Deploying CEth...");
  const CEth = await ethers.getContractFactory("CEth");
  const cETH = await CEth.deploy(
    deployer.address,
    "Compound Ether",
    "cETH",
    comptrollerAddr,
    strategyAddr,
    ethers.parseUnits("1", 18),      // initialExchangeRate
    ethers.parseUnits("0.10", 18),   // reserveFactor 10%
    ethers.parseUnits("0.0005", 18)  // borrowRateMax
  );
  await cETH.waitForDeployment();
  const cETHAddr = await cETH.getAddress();
  console.log("   ✓ CEth:", cETHAddr);

  // ── 5. CErc20 USDC ──────────────────────────────────
  const SEPOLIA_USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
  console.log("\n5. Deploying CErc20 (USDC)...");
  const CErc20 = await ethers.getContractFactory("CErc20");
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
  console.log("   ✓ CErc20 (USDC):", cUSDCAddr);

  // ── 6. CErc20 DAI ───────────────────────────────────
  const SEPOLIA_DAI = "0x3e622317f8C93f7328350cF0B56d9eD4C620C5d6";
  console.log("\n6. Deploying CErc20 (DAI)...");
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
  console.log("   ✓ CErc20 (DAI):", cDAIAddr);

  // ── 7. Router ───────────────────────────────────────
  const SEPOLIA_WETH = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14";
  console.log("\n7. Deploying Router...");
  const Router = await ethers.getContractFactory("CrossMarketLeverageRouter");
  const router = await Router.deploy(
    deployer.address,
    SEPOLIA_WETH,
    comptrollerAddr
  );
  await router.waitForDeployment();
  const routerAddr = await router.getAddress();
  console.log("   ✓ Router:", routerAddr);

  // ── 8. Post-deploy config ────────────────────────────
  console.log("\n8. Setting oracle prices...");
  await (await oracle.setUnderlyingPrice(cETHAddr,  ethers.parseUnits("3000", 18))).wait();
  await (await oracle.setUnderlyingPrice(cUSDCAddr, ethers.parseUnits("1", 18))).wait();
  await (await oracle.setUnderlyingPrice(cDAIAddr,  ethers.parseUnits("1", 18))).wait();
  console.log("   ✓ Prices set");

  console.log("\n9. Listing markets in Comptroller...");
  await (await (comptroller as any)._supportMarket(cETHAddr,  ethers.parseUnits("0.75", 18))).wait();
  await (await (comptroller as any)._supportMarket(cUSDCAddr, ethers.parseUnits("0.80", 18))).wait();
  await (await (comptroller as any)._supportMarket(cDAIAddr,  ethers.parseUnits("0.80", 18))).wait();
  console.log("   ✓ Markets listed");

  console.log("\n10. Approving Router in cTokens...");
  await (await (cETH  as any).setRouter(routerAddr, true)).wait();
  await (await (cUSDC as any).setRouter(routerAddr, true)).wait();
  await (await (cDAI  as any).setRouter(routerAddr, true)).wait();
  console.log("   ✓ Router approved");

  // ── Print addresses ──────────────────────────────────
  console.log("\n" + "=".repeat(60));
  console.log("DEPLOYMENT COMPLETE — paste into frontend/.env.local:");
  console.log("=".repeat(60));
  console.log(`NEXT_PUBLIC_ORACLE_ADDRESS=${oracleAddr}`);
  console.log(`NEXT_PUBLIC_INTEREST_STRATEGY_ADDRESS=${strategyAddr}`);
  console.log(`NEXT_PUBLIC_COMPTROLLER_ADDRESS=${comptrollerAddr}`);
  console.log(`NEXT_PUBLIC_CETH_ADDRESS=${cETHAddr}`);
  console.log(`NEXT_PUBLIC_CUSDC_ADDRESS=${cUSDCAddr}`);
  console.log(`NEXT_PUBLIC_CDAI_ADDRESS=${cDAIAddr}`);
  console.log(`NEXT_PUBLIC_ROUTER_ADDRESS=${routerAddr}`);
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});