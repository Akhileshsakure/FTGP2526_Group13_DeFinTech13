import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseEther } from "viem";

describe("More lending flows", async () => {
  async function setupCEthOnly() {
    const { viem } = await network.connect();
    const publicClient = await viem.getPublicClient();
    const [deployer, supplier, borrower, liquidator] =
      await viem.getWalletClients();

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

    await waitTx(
      await oracle.write.setUnderlyingPrice(
        [cEth.address, parseEther("3000")],
        { account: deployer.account }
      )
    );

    await waitTx(
      await comptroller.write._supportMarket(
        [cEth.address, parseEther("0.5"), parseEther("0.6"), parseEther("1.05")],
        { account: deployer.account }
      )
    );

    return {
      viem,
      publicClient,
      deployer,
      supplier,
      borrower,
      liquidator,
      waitTx,
      oracle,
      interestRateModel,
      comptroller,
      cEth,
    };
  }

  async function setupWithERC20AndCEth() {
    const { viem } = await network.connect();
    const publicClient = await viem.getPublicClient();
    const [deployer, supplier, borrower, liquidator] =
      await viem.getWalletClients();

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

    const token = await viem.deployContract("MockERC20", [
      "Mock Token",
      "MTK",
      18,
    ]);

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

    // Code comment
    await waitTx(
      await oracle.write.setUnderlyingPrice(
        [cErc20.address, parseEther("1")], // MTK = 1 USD
        { account: deployer.account }
      )
    );

    await waitTx(
      await oracle.write.setUnderlyingPrice(
        [cEth.address, parseEther("2000")], // ETH = 2000 USD
        { account: deployer.account }
      )
    );

    // Code comment
    await waitTx(
      await comptroller.write._supportMarket(
        [cErc20.address, parseEther("0.75"), parseEther("0.8"), parseEther("1.05")], // Code comment
        { account: deployer.account }
      )
    );

    await waitTx(
      await comptroller.write._supportMarket(
        [cEth.address, parseEther("0.5"), parseEther("0.6"), parseEther("1.05")],
        { account: deployer.account }
      )
    );

    return {
      viem,
      publicClient,
      deployer,
      supplier,
      borrower,
      liquidator,
      waitTx,
      oracle,
      interestRateModel,
      comptroller,
      token,
      cErc20,
      cEth,
    };
  }

  it("redeem: should mint ETH and redeem part of it", async () => {
    const { waitTx, supplier, borrower, cEth } = await setupCEthOnly();

    // Code comment
    await waitTx(
      await cEth.write.mint([], {
        account: supplier.account,
        value: parseEther("10"),
      })
    );

    // Code comment
    await waitTx(
      await cEth.write.mint([], {
        account: borrower.account,
        value: parseEther("2"),
      })
    );

    const beforeBalance = await cEth.read.balanceOf([
      borrower.account.address,
    ]);

    // Code comment
    await waitTx(
      await cEth.write.redeemUnderlying([parseEther("1")], {
        account: borrower.account,
      })
    );

    const afterBalance = await cEth.read.balanceOf([
      borrower.account.address,
    ]);

    assert.ok(afterBalance < beforeBalance, "cETH balance should decrease");
  });

  it("CErc20: should deposit, borrow and repay ERC20", async () => {
    const { waitTx, supplier, borrower, token, cErc20, comptroller } =
      await setupWithERC20AndCEth();

    // Code comment
    await waitTx(
      await token.write.mint([supplier.account.address, parseEther("5000")], {
        account: supplier.account,
      })
    );

    await waitTx(
      await token.write.mint([borrower.account.address, parseEther("1000")], {
        account: borrower.account,
      })
    );

    // Code comment
    await waitTx(
      await token.write.approve([cErc20.address, parseEther("5000")], {
        account: supplier.account,
      })
    );

    await waitTx(
      await cErc20.write.mint([parseEther("5000")], {
        account: supplier.account,
      })
    );

    // Code comment
    await waitTx(
      await token.write.approve([cErc20.address, parseEther("1000")], {
        account: borrower.account,
      })
    );

    await waitTx(
      await cErc20.write.mint([parseEther("1000")], {
        account: borrower.account,
      })
    );

    // Code comment
    await waitTx(
      await comptroller.write.enterMarkets([[cErc20.address]], {
        account: borrower.account,
      })
    );

    // Code comment
    await waitTx(
      await cErc20.write.borrow([parseEther("400")], {
        account: borrower.account,
      })
    );

    const borrowAfter = await cErc20.read.borrowBalanceStored([
      borrower.account.address,
    ]);

    assert.equal(borrowAfter, parseEther("400"));

    // Code comment
    await waitTx(
      await token.write.approve([cErc20.address, parseEther("400")], {
        account: borrower.account,
      })
    );

    await waitTx(
      await cErc20.write.repayBorrow([parseEther("400")], {
        account: borrower.account,
      })
    );

    const borrowFinal = await cErc20.read.borrowBalanceStored([
      borrower.account.address,
    ]);

    assert.ok(borrowFinal < 1000000000000n);
  });

  it("liquidation: should become shortfall after price drop and be liquidated", async () => {
    const {
      waitTx,
      supplier,
      borrower,
      liquidator,
      token,
      cErc20,
      cEth,
      comptroller,
      oracle,
    } = await setupWithERC20AndCEth();

    // Code comment
    await waitTx(
      await token.write.mint([borrower.account.address, parseEther("2000")], {
        account: borrower.account,
      })
    );

    await waitTx(
      await token.write.mint([liquidator.account.address, parseEther("1000")], {
        account: liquidator.account,
      })
    );

    // Code comment
    await waitTx(
      await cEth.write.mint([], {
        account: supplier.account,
        value: parseEther("20"),
      })
    );

    // Code comment
    await waitTx(
      await token.write.approve([cErc20.address, parseEther("2000")], {
        account: borrower.account,
      })
    );

    await waitTx(
      await cErc20.write.mint([parseEther("2000")], {
        account: borrower.account,
      })
    );

    // Code comment
    await waitTx(
      await comptroller.write.enterMarkets([[cErc20.address]], {
        account: borrower.account,
      })
    );

    // Code comment
    await waitTx(
      await cEth.write.borrow([parseEther("0.5")], {
        account: borrower.account,
      })
    );

    const beforeLiq = await comptroller.read.getAccountLiquidity([
      borrower.account.address,
    ]);

    // Code comment
    assert.equal(beforeLiq[2], 0n);

    // Code comment
    await waitTx(
      await oracle.write.setUnderlyingPrice(
        [cErc20.address, parseEther("0.4")],
        { account: liquidator.account }
      )
    );

    const afterDrop = await comptroller.read.getAccountLiquidity([
      borrower.account.address,
    ]);

    // Code comment
    assert.ok(afterDrop[2] > 0n, "borrower should have shortfall");

    const liquidatorCTokenBefore = await cErc20.read.balanceOf([
      liquidator.account.address,
    ]);

    // Code comment
    await waitTx(
      await cEth.write.liquidateBorrow(
        [borrower.account.address, cErc20.address],
        {
          account: liquidator.account,
          value: parseEther("0.25"),
        }
      )
    );

    const liquidatorCTokenAfter = await cErc20.read.balanceOf([
      liquidator.account.address,
    ]);

    const borrowerBorrowAfter = await cEth.read.borrowBalanceStored([
      borrower.account.address,
    ]);

    assert.ok(
      liquidatorCTokenAfter > liquidatorCTokenBefore,
      "liquidator should receive seized collateral"
    );

    assert.ok(
      borrowerBorrowAfter < parseEther("0.5"),
      "borrow balance should decrease after liquidation"
    );
  });
});