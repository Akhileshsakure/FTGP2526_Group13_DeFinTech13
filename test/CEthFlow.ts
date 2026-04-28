import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseEther } from "viem";

describe("CEth simple flow", async () => {
  it("should deploy, supply, borrow and repay", async () => {
    const { viem } = await network.connect();

    const publicClient = await viem.getPublicClient();
    const [deployer, supplier, borrower] = await viem.getWalletClients();

    async function waitTx(hash: `0x${string}`) {
      return await publicClient.waitForTransactionReceipt({ hash });
    }
    const oracle = await viem.deployContract("MockPriceOracle");
    const interestRateModel = await viem.deployContract(
      "AaveInterestRateStrategy",
      [
        deployer.account.address,
        parseEther("0.45"),  // optimalUsageRatio = 45%
        0n,                  // baseVariableBorrowRate
        parseEther("0.07"),  // variableRateSlope1 = 7%
        parseEther("3"),     // variableRateSlope2 = 300%
      ]
    );
    const comptroller = await viem.deployContract("Comptroller", [
      deployer.account.address,
      oracle.address,
      parseEther("0.5"),   // closeFactor = 50%
    ]);
    const cEth = await viem.deployContract("CEth", [
      deployer.account.address,
      "Compound ETH",
      "cETH",
      comptroller.address,
      interestRateModel.address,
      parseEther("1"),        // initialExchangeRateMantissa
      parseEther("0.1"),      // reserveFactorMantissa = 10%
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
        [
          cEth.address, 
          parseEther("0.5"),   // LTV 50%
          parseEther("0.6"),   // Liquidation Threshold 60%
          parseEther("1.05"),  // Liquidation Bonus 5%
        ],
        { account: deployer.account }
      )
    );
    await waitTx(
      await cEth.write.mint([], {
        account: supplier.account,
        value: parseEther("10"),
      })
    );
    await waitTx(
      await cEth.write.mint([], {
        account: borrower.account,
        value: parseEther("2"),
      })
    );
    await waitTx(
      await comptroller.write.enterMarkets([[cEth.address]], {
        account: borrower.account,
      })
    );
    await waitTx(
      await cEth.write.borrow([parseEther("0.5")], {
        account: borrower.account,
      })
    );

    const borrowAfter = await cEth.read.borrowBalanceStored([
      borrower.account.address,
    ]);

    assert.equal(
      borrowAfter,
      parseEther("0.5"),
      "borrow balance should be 0.5 ETH"
    );
    await waitTx(
      await cEth.write.repayBorrow([], {
        account: borrower.account,
        value: parseEther("0.5"),
      })
    );

    const borrowFinal = await cEth.read.borrowBalanceStored([
      borrower.account.address,
    ]);

    assert.ok(
      borrowFinal < 100000000000n,
      "borrow balance should be almost 0 after repay"
    );
    const cEthBalance = await cEth.read.balanceOf([
      borrower.account.address,
    ]);

    assert.ok(cEthBalance > 0n, "borrower should own cETH after mint");
  });

  it("should close ETH debt when full repay sends a small overpayment", async () => {
    const { viem } = await network.connect();

    const publicClient = await viem.getPublicClient();
    const [deployer, supplier, borrower] = await viem.getWalletClients();

    async function waitTx(hash: `0x${string}`) {
      return await publicClient.waitForTransactionReceipt({ hash });
    }

    const oracle = await viem.deployContract("MockPriceOracle");
    const interestRateModel = await viem.deployContract(
      "AaveInterestRateStrategy",
      [
        deployer.account.address,
        parseEther("0.45"),
        parseEther("0.02"),
        parseEther("0.07"),
        parseEther("3"),
      ]
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

    await waitTx(
      await cEth.write.mint([], {
        account: supplier.account,
        value: parseEther("10"),
      })
    );
    await waitTx(
      await cEth.write.mint([], {
        account: borrower.account,
        value: parseEther("2"),
      })
    );
    await waitTx(
      await comptroller.write.enterMarkets([[cEth.address]], {
        account: borrower.account,
      })
    );
    await waitTx(
      await cEth.write.borrow([parseEther("0.5")], {
        account: borrower.account,
      })
    );

    await waitTx(
      await cEth.write.repayBorrow([], {
        account: borrower.account,
        value: parseEther("0.501"),
      })
    );

    const borrowFinal = await cEth.read.borrowBalanceStored([
      borrower.account.address,
    ]);

    assert.equal(borrowFinal, 0n, "overpaid full repay should clear ETH debt");
  });
});
