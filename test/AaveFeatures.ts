import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseEther } from "viem";

describe("Aave Advanced Features Tests", async () => {
  async function setupAaveEnvironment() {
    const { viem } = await network.connect();
    const publicClient = await viem.getPublicClient();
    const [deployer, supplier, borrower, liquidator] = await viem.getWalletClients();

    async function waitTx(hash: `0x${string}`) {
      return await publicClient.waitForTransactionReceipt({ hash });
    }

    const oracle = await viem.deployContract("MockPriceOracle");

    const interestRateModel = await viem.deployContract(
      "AaveInterestRateStrategy",
      [deployer.account.address, parseEther("0.45"), 0n, parseEther("0.07"), parseEther("3")]
    );

    const comptroller = await viem.deployContract("Comptroller", [
      deployer.account.address,
      oracle.address,
      parseEther("0.5"),
    ]);

    const token = await viem.deployContract("MockERC20", ["Mock Token", "MTK", 18]);

    const cErc20 = await viem.deployContract("CErc20", [
      deployer.account.address,
      token.address,
      "Compound Mock Token",
      "cMTK",
      comptroller.address,
      interestRateModel.address,
      parseEther("1"),
      parseEther("0.1"),
      parseEther("0.000001"),
    ]);

    const cEth = await viem.deployContract("CEth", [
      deployer.account.address,
      "Compound ETH",
      "cETH",
      comptroller.address,
      interestRateModel.address,
      parseEther("1"),
      parseEther("0.1"),
      parseEther("0.000001"),
    ]);

    // Set Price: MTK = 1 USD, ETH = 2000 USD
    await waitTx(await oracle.write.setUnderlyingPrice([cErc20.address, parseEther("1")], { account: deployer.account }));
    await waitTx(await oracle.write.setUnderlyingPrice([cEth.address, parseEther("2000")], { account: deployer.account }));

    // Support markets
    await waitTx(await comptroller.write._supportMarket([cErc20.address, parseEther("0.5"), parseEther("0.8"), parseEther("1.05")], { account: deployer.account }));
    await waitTx(await comptroller.write._supportMarket([cEth.address, parseEther("0.5"), parseEther("0.8"), parseEther("1.05")], { account: deployer.account }));

    return { viem, publicClient, deployer, supplier, borrower, liquidator, waitTx, oracle, comptroller, token, cErc20, cEth };
  }

  it("should enforce supply and borrow caps", async () => {
    const { waitTx, supplier, borrower, token, cErc20, cEth, comptroller } = await setupAaveEnvironment();

    // Set Supply Cap to 1000 MTK, Borrow Cap to 500 MTK
    await waitTx(await comptroller.write._setMarketCaps([cErc20.address, parseEther("1000"), parseEther("500")]));

    // Supplier gets 2000 MTK
    await waitTx(await token.write.mint([supplier.account.address, parseEther("2000")]));
    await waitTx(await token.write.approve([cErc20.address, parseEther("2000")], { account: supplier.account }));

    // Supplying 1500 MTK should fail because supply cap is 1000
    let mintFailed = false;
    try {
      await cErc20.write.mint([parseEther("1500")], { account: supplier.account });
    } catch(e) {
      mintFailed = true;
    }
    assert.ok(mintFailed, "Mint over cap should fail");

    // Supplying 800 MTK should succeed
    await waitTx(await cErc20.write.mint([parseEther("800")], { account: supplier.account }));
    const balanceSuccess = await cErc20.read.balanceOf([supplier.account.address]);
    assert.ok(balanceSuccess > 0n);

    // Borrower gets 10 ETH to use as collateral
    await waitTx(await cEth.write.mint([], { account: borrower.account, value: parseEther("10") }));
    await waitTx(await comptroller.write.enterMarkets([[cEth.address]], { account: borrower.account }));

    // Borrowing 600 MTK should fail because borrow cap is 500
    let borrowFailed = false;
    try {
      await cErc20.write.borrow([parseEther("600")], { account: borrower.account });
    } catch(e) {
      borrowFailed = true;
    }
    assert.ok(borrowFailed, "Borrow over cap should fail");

    // Borrowing 400 MTK should succeed
    await waitTx(await cErc20.write.borrow([parseEther("400")], { account: borrower.account }));
    const borrowBalanceSuccess = await cErc20.read.borrowBalanceStored([borrower.account.address]);
    assert.ok(borrowBalanceSuccess > 0n);
  });

  it("should restrict borrowing based on LTV but liquidate based on Health Factor", async () => {
    const { waitTx, supplier, borrower, liquidator, token, cErc20, cEth, comptroller, oracle } = await setupAaveEnvironment();

    // Supplier provides 10 ETH liquidity (Value = 20,000 USD)
    await waitTx(await cEth.write.mint([], { account: supplier.account, value: parseEther("10") }));

    // Borrower provides 4000 MTK collateral (Value = 4000 USD)
    // LTV = 50%, Liq Threshold = 80%
    await waitTx(await token.write.mint([borrower.account.address, parseEther("4000")]));
    await waitTx(await token.write.approve([cErc20.address, parseEther("4000")], { account: borrower.account }));
    await waitTx(await cErc20.write.mint([parseEther("4000")], { account: borrower.account }));
    await waitTx(await comptroller.write.enterMarkets([[cErc20.address]], { account: borrower.account }));

    // Max borrow = 4000 * 50% = 2000 USD. ETH is 2000 USD. So max borrow = 1.0 ETH.
    // Try to borrow 1.1 ETH (2200 USD). This should FAIL.
    let borrowLimitFailed = false;
    try {
      await cEth.write.borrow([parseEther("1.1")], { account: borrower.account });
    } catch(e) {
      borrowLimitFailed = true;
    }
    assert.ok(borrowLimitFailed, "Borrow over LTV limit should fail");

    // Borrow 0.95 ETH (1900 USD). This should SUCCEED.
    await waitTx(await cEth.write.borrow([parseEther("0.95")], { account: borrower.account }));
    assert.ok(await cEth.read.borrowBalanceStored([borrower.account.address]) > 0n);

    // Check Health Factor: Collateral=4000, Threshold=80% -> Max borrow before liq = 3200 USD.
    // Borrows = 1900 USD. HF = 3200 / 1900 = 1.68
    let hf = await comptroller.read.getAccountHealthFactor([borrower.account.address]);
    assert.ok(hf[1] >= parseEther("1.6"));

    // Try liquidating now. Should fail because HF > 1.
    // Liquidator pays back 0.1 ETH
    let earlyLiqFailed = false;
    try {
      await cEth.write.liquidateBorrow([borrower.account.address, cErc20.address], { account: liquidator.account, value: parseEther("0.1") });
    } catch(e) {
      earlyLiqFailed = true;
    }
    assert.ok(earlyLiqFailed, "Early liquidation should fail");

    // Drop price of MTK to 0.45 USD
    // Collateral value = 4000 * 0.45 = 1800 USD. 
    // Threshold value = 1800 * 80% = 1440 USD.
    // Borrow value = 0.95 * 2000 = 1900 USD.
    // HF = 1440 / 1900 = 0.75 < 1.0! 
    await waitTx(await oracle.write.setUnderlyingPrice([cErc20.address, parseEther("0.45")], { account: liquidator.account }));

    let hfAfter = await comptroller.read.getAccountHealthFactor([borrower.account.address]);
    assert.ok(hfAfter[1] < parseEther("1"), "Health factor should be below 1");

    // Liquidator liquidates 0.4 ETH (800 USD debt)
    const liquidatorCTokenBefore = await cErc20.read.balanceOf([liquidator.account.address]);
    
    await waitTx(
      await cEth.write.liquidateBorrow([borrower.account.address, cErc20.address], { account: liquidator.account, value: parseEther("0.4") })
    );

    const liquidatorCTokenAfter = await cErc20.read.balanceOf([liquidator.account.address]);
    assert.ok(liquidatorCTokenAfter > liquidatorCTokenBefore, "Liquidator should receive seized collateral");
  });

  it("should block operations when market is paused", async () => {
    const { waitTx, supplier, borrower, token, cErc20, cEth, comptroller } = await setupAaveEnvironment();

    // Supplier provides ETH liquidity
    await waitTx(await cEth.write.mint([], { account: supplier.account, value: parseEther("10") }));

    // Borrower gets MTK
    await waitTx(await token.write.mint([borrower.account.address, parseEther("1000")]));
    await waitTx(await token.write.approve([cErc20.address, parseEther("1000")], { account: borrower.account }));
    
    // Pause cErc20 market
    await waitTx(await comptroller.write._setMarketPause([cErc20.address, true]));

    // Minting should fail
    let mintFailed = false;
    try {
      await cErc20.write.mint([parseEther("500")], { account: borrower.account });
    } catch (e: any) {
      assert.ok(e.message.includes("Market is paused"));
      mintFailed = true;
    }
    assert.ok(mintFailed, "Mint should fail when market is paused");

    // Unpause market
    await waitTx(await comptroller.write._setMarketPause([cErc20.address, false]));
    
    // Minting should succeed now
    await waitTx(await cErc20.write.mint([parseEther("500")], { account: borrower.account }));
    assert.ok(await cErc20.read.balanceOf([borrower.account.address]) > 0n);

    // Enter market and try borrowing
    await waitTx(await comptroller.write.enterMarkets([[cErc20.address]], { account: borrower.account }));
    
    // Pause cEth market
    await waitTx(await comptroller.write._setMarketPause([cEth.address, true]));

    // Borrowing cEth should fail
    let borrowFailed = false;
    try {
      await cEth.write.borrow([parseEther("0.1")], { account: borrower.account });
    } catch (e: any) {
      assert.ok(e.message.includes("Market is paused"));
      borrowFailed = true;
    }
    assert.ok(borrowFailed, "Borrow should fail when market is paused");
  });
});
