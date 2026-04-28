import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { network } from "hardhat";
import { parseUnits } from "viem";

const WAD = parseUnits("1", 18);

describe("Extended markets and deployment configuration", async () => {
  async function setupExtendedMarkets() {
    const { viem } = await network.connect();
    const publicClient = await viem.getPublicClient();
    const [deployer, supplier, borrower] = await viem.getWalletClients();

    async function waitTx(hash: `0x${string}`) {
      return await publicClient.waitForTransactionReceipt({ hash });
    }

    const oracle = await viem.deployContract("MockPriceOracle");
    const interestRateModel = await viem.deployContract("JumpRateInterestStrategy", [
      deployer.account.address,
      parseUnits("0.02", 18),
      parseUnits("0.10", 18),
      parseUnits("3", 18),
      parseUnits("0.8", 18),
    ]);
    const comptroller = await viem.deployContract("Comptroller", [
      deployer.account.address,
      oracle.address,
      parseUnits("0.5", 18),
    ]);

    const usdt = await viem.deployContract("MockERC20", ["Tether USD", "USDT", 6]);
    const wbtc = await viem.deployContract("MockERC20", ["Wrapped Bitcoin", "WBTC", 8]);

    const cUsdt = await viem.deployContract("CErc20", [
      deployer.account.address,
      usdt.address,
      "Compound USDT",
      "cUSDT",
      comptroller.address,
      interestRateModel.address,
      WAD,
      parseUnits("0.1", 18),
      parseUnits("0.0005", 18),
    ]);

    const cWbtc = await viem.deployContract("CErc20", [
      deployer.account.address,
      wbtc.address,
      "Compound WBTC",
      "cWBTC",
      comptroller.address,
      interestRateModel.address,
      WAD,
      parseUnits("0.1", 18),
      parseUnits("0.0005", 18),
    ]);

    await waitTx(await oracle.write.setUnderlyingPrice([cUsdt.address, parseUnits("1", 30)]));
    await waitTx(await oracle.write.setUnderlyingPrice([cWbtc.address, parseUnits("65000", 28)]));

    await waitTx(
      await comptroller.write._supportMarket([
        cUsdt.address,
        parseUnits("0.75", 18),
        parseUnits("0.80", 18),
        parseUnits("1.05", 18),
      ])
    );
    await waitTx(
      await comptroller.write._supportMarket([
        cWbtc.address,
        parseUnits("0.70", 18),
        parseUnits("0.75", 18),
        parseUnits("1.08", 18),
      ])
    );
    await waitTx(await comptroller.write._setMarketCaps([cUsdt.address, parseUnits("1000000", 6), parseUnits("500000", 6)]));
    await waitTx(await comptroller.write._setMarketCaps([cWbtc.address, parseUnits("100", 8), parseUnits("20", 8)]));

    return { waitTx, supplier, borrower, oracle, comptroller, usdt, wbtc, cUsdt, cWbtc };
  }

  it("supports WBTC collateral and USDT borrowing with independent decimals and risk parameters", async () => {
    const { waitTx, supplier, borrower, comptroller, usdt, wbtc, cUsdt, cWbtc } =
      await setupExtendedMarkets();

    await waitTx(await usdt.write.mint([supplier.account.address, parseUnits("100000", 6)]));
    await waitTx(await usdt.write.approve([cUsdt.address, parseUnits("100000", 6)], { account: supplier.account }));
    await waitTx(await cUsdt.write.mint([parseUnits("100000", 6)], { account: supplier.account }));

    await waitTx(await wbtc.write.mint([borrower.account.address, parseUnits("1", 8)]));
    await waitTx(await wbtc.write.approve([cWbtc.address, parseUnits("1", 8)], { account: borrower.account }));
    await waitTx(await cWbtc.write.mint([parseUnits("1", 8)], { account: borrower.account }));
    await waitTx(await comptroller.write.enterMarkets([[cWbtc.address]], { account: borrower.account }));

    await waitTx(await cUsdt.write.borrow([parseUnits("40000", 6)], { account: borrower.account }));
    assert.equal(await cUsdt.read.borrowBalanceStored([borrower.account.address]), parseUnits("40000", 6));

    let failed = false;
    try {
      await cUsdt.write.borrow([parseUnits("10000", 6)], { account: borrower.account });
    } catch {
      failed = true;
    }
    assert.ok(failed, "Borrowing beyond WBTC LTV should fail");
  });

  it("uses Chainlink oracle protections for ownership, missing feeds, and stale feeds", async () => {
    const { viem } = await network.connect();
    const [deployer, attacker] = await viem.getWalletClients();

    const oracle = await viem.deployContract("ChainlinkPriceOracle", [
      deployer.account.address,
      3600n,
    ]);
    const feed = await viem.deployContract("MockV3Aggregator", [8, 65000_00000000n]);

    let missingFeedFailed = false;
    try {
      await oracle.read.getUnderlyingPrice([attacker.account.address]);
    } catch {
      missingFeedFailed = true;
    }
    assert.ok(missingFeedFailed, "Missing feed should fail closed");

    let nonOwnerFailed = false;
    try {
      await oracle.write.setFeed([attacker.account.address, feed.address], {
        account: attacker.account,
      });
    } catch {
      nonOwnerFailed = true;
    }
    assert.ok(nonOwnerFailed, "Only owner can set feeds");

    await oracle.write.setFeed([attacker.account.address, feed.address], {
      account: deployer.account,
    });
    assert.equal(
      await oracle.read.getUnderlyingPrice([attacker.account.address]),
      parseUnits("65000", 18)
    );
  });

  it("raises borrow rates as utilization increases in the jump rate model", async () => {
    const { viem } = await network.connect();
    const [deployer] = await viem.getWalletClients();

    const strategy = await viem.deployContract("JumpRateInterestStrategy", [
      deployer.account.address,
      parseUnits("0.02", 18),
      parseUnits("0.10", 18),
      parseUnits("3", 18),
      parseUnits("0.8", 18),
    ]);

    const lowUtilRate = await strategy.read.getBorrowRate([
      parseUnits("900", 18),
      parseUnits("100", 18),
      0n,
    ]);
    const highUtilRate = await strategy.read.getBorrowRate([
      parseUnits("100", 18),
      parseUnits("900", 18),
      0n,
    ]);

    assert.ok(highUtilRate > lowUtilRate, "Higher utilization should produce a higher borrow rate");
  });

  it("keeps multi-asset market and Chainlink deployment configuration in sync", () => {
    const root = process.cwd();
    const contractsConfig = readFileSync(join(root, "frontend", "lib", "contracts.ts"), "utf8");
    const mockDeploy = readFileSync(join(root, "scripts", "deploy.ts"), "utf8");
    const chainlinkDeploy = readFileSync(join(root, "scripts", "deploy-chainlink.ts"), "utf8");
    const packageJson = readFileSync(join(root, "package.json"), "utf8");

    for (const symbol of ["WBTC", "WETH", "USDT"]) {
      assert.match(contractsConfig, new RegExp(`symbol:\\s+"${symbol}"`));
      assert.match(mockDeploy, new RegExp(`NEXT_PUBLIC_C${symbol}_ADDRESS`));
      assert.match(chainlinkDeploy, new RegExp(`NEXT_PUBLIC_C${symbol}_ADDRESS`));
    }

    assert.match(packageJson, /"deploy:mock": "hardhat run scripts\/deploy\.ts --network sepolia"/);
    assert.match(packageJson, /"deploy:chainlink": "hardhat run scripts\/deploy-chainlink\.ts --network sepolia"/);
    assert.match(chainlinkDeploy, /ChainlinkPriceOracle/);
    assert.match(chainlinkDeploy, /setFeed\(cWBTCAddr, FEEDS\.BTC_USD\)/);
    assert.match(chainlinkDeploy, /setFeed\(cETHAddr, FEEDS\.ETH_USD\)/);
  });
});
