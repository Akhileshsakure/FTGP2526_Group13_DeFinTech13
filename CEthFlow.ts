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

    // Code comment
    const oracle = await viem.deployContract("MockPriceOracle");

    // Code comment
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

    // Code comment
    const comptroller = await viem.deployContract("Comptroller", [
      deployer.account.address,
      oracle.address,
      parseEther("0.5"),   // closeFactor = 50%
    ]);

    // Code comment
    const cEth = await viem.deployContract("CEth", [
      deployer.account.address,
      "Compound ETH",
      "cETH",
      comptroller.address,
      interestRateModel.address,
      parseEther("1"),        // initialExchangeRateMantissa
      parseEther("0.1"),      // reserveFactorMantissa = 10%
      parseEther("0.000001"), // Code comment
    ]);

    // Code comment
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

    // Code comment
    await waitTx(
      await comptroller.write.enterMarkets([[cEth.address]], {
        account: borrower.account,
      })
    );

    // Code comment
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

    // Code comment
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

    // Code comment
    const cEthBalance = await cEth.read.balanceOf([
      borrower.account.address,
    ]);

    assert.ok(cEthBalance > 0n, "borrower should own cETH after mint");
  });
});