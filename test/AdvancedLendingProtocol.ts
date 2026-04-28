import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseEther } from "viem";

describe("Advanced lending protocol", async () => {
  async function setup() {
    const { viem } = await network.connect();
    const publicClient = await viem.getPublicClient();
    const [deployer, supplier, borrower, secondRedeemer] = await viem.getWalletClients();

    async function waitTx(hash: `0x${string}`) {
      return await publicClient.waitForTransactionReceipt({ hash });
    }

    const oracle = await viem.deployContract("MockPriceOracle");
    const interestRateModel = await viem.deployContract("JumpRateInterestStrategy", [
      deployer.account.address,
      parseEther("0.02"),
      parseEther("0.12"),
      parseEther("1"),
      parseEther("0.8"),
    ]);

    const comptroller = await viem.deployContract("Comptroller", [
      deployer.account.address,
      oracle.address,
      parseEther("0.5"),
    ]);

    const usdc = await viem.deployContract("MockERC20", ["USD Coin", "USDC", 18]);
    const wbtc = await viem.deployContract("MockERC20", ["Wrapped Bitcoin", "WBTC", 18]);

    const cEth = await viem.deployContract("CEth", [
      deployer.account.address,
      "DeFinTech ETH",
      "dfETH",
      comptroller.address,
      interestRateModel.address,
      parseEther("1"),
      parseEther("0.1"),
      parseEther("0.000001"),
    ]);

    const cUsdc = await viem.deployContract("CErc20", [
      deployer.account.address,
      usdc.address,
      "DeFinTech USDC",
      "dfUSDC",
      comptroller.address,
      interestRateModel.address,
      parseEther("1"),
      parseEther("0.1"),
      parseEther("0.000001"),
    ]);

    const cWbtc = await viem.deployContract("CErc20", [
      deployer.account.address,
      wbtc.address,
      "DeFinTech WBTC",
      "dfWBTC",
      comptroller.address,
      interestRateModel.address,
      parseEther("1"),
      parseEther("0.1"),
      parseEther("0.000001"),
    ]);

    await waitTx(await oracle.write.setUnderlyingPrice([cEth.address, parseEther("2000")]));
    await waitTx(await oracle.write.setUnderlyingPrice([cUsdc.address, parseEther("1")]));
    await waitTx(await oracle.write.setUnderlyingPrice([cWbtc.address, parseEther("65000")]));

    for (const market of [cEth.address, cUsdc.address, cWbtc.address]) {
      await waitTx(
        await comptroller.write._supportMarket([
          market,
          parseEther("0.65"),
          parseEther("0.82"),
          parseEther("1.05"),
        ])
      );
      await waitTx(await comptroller.write._setMarketCaps([market, parseEther("1000000"), parseEther("500000")]));
    }

    const protocol = await viem.deployContract("AdvancedLendingProtocol", [
      deployer.account.address,
      comptroller.address,
      24n * 60n * 60n,
      deployer.account.address,
    ]);

    await waitTx(await comptroller.write.setRouter([protocol.address, true]));
    for (const market of [cEth, cUsdc, cWbtc]) {
      await waitTx(await market.write.setRouter([protocol.address, true]));
    }
    await waitTx(await protocol.write.setMarketNative([cEth.address, true]));

    await waitTx(await usdc.write.mint([supplier.account.address, parseEther("100000")]));
    await waitTx(await usdc.write.approve([cUsdc.address, parseEther("100000")], { account: supplier.account }));
    await waitTx(await cUsdc.write.mint([parseEther("100000")], { account: supplier.account }));

    return {
      publicClient,
      deployer,
      supplier,
      borrower,
      secondRedeemer,
      waitTx,
      oracle,
      comptroller,
      usdc,
      cEth,
      cUsdc,
      cWbtc,
      protocol,
    };
  }

  it("opens a perpetual cross-asset position, values PnL, and closes it", async () => {
    const { borrower, waitTx, oracle, usdc, cEth, cUsdc, protocol } = await setup();

    await waitTx(
      await protocol.write.openPosition(
        [cEth.address, true, parseEther("2"), cUsdc.address, false, parseEther("1000")],
        { account: borrower.account, value: parseEther("2") }
      )
    );

    const position = await protocol.read.positions([1n]);
    assert.equal(position[0].toLowerCase(), borrower.account.address.toLowerCase());
    assert.equal(await cUsdc.read.borrowBalanceStored([borrower.account.address]), parseEther("1000"));

    await waitTx(await oracle.write.setUnderlyingPrice([cEth.address, parseEther("2500")]));
    const valuation = await protocol.read.getPositionValue([1n]);
    assert.equal(valuation[0], parseEther("5000"));
    assert.equal(valuation[1], parseEther("1000"));
    assert.equal(valuation[2], parseEther("1000"));

    await waitTx(await usdc.write.mint([borrower.account.address, parseEther("10")]));
    await waitTx(await usdc.write.approve([protocol.address, parseEther("1010")], { account: borrower.account }));
    await waitTx(
      await protocol.write.closePosition([1n, parseEther("1010"), parseEther("2")], {
        account: borrower.account,
      })
    );

    assert.equal(await cUsdc.read.borrowBalanceStored([borrower.account.address]), 0n);
    const closedPosition = await protocol.read.positions([1n]);
    assert.equal(closedPosition[8], false);
  });

  it("charges liquidity-sensitive instant redemption fees and blocks instant exits in shutdown", async () => {
    const { borrower, deployer, waitTx, usdc, cUsdc, protocol } = await setup();

    await waitTx(await usdc.write.mint([borrower.account.address, parseEther("1000")]));
    await waitTx(await usdc.write.approve([cUsdc.address, parseEther("1000")], { account: borrower.account }));
    await waitTx(await cUsdc.write.mint([parseEther("1000")], { account: borrower.account }));

    await waitTx(await cUsdc.write.approve([protocol.address, parseEther("1000")], { account: borrower.account }));

    const feeRecipientBefore = await usdc.read.balanceOf([deployer.account.address]);
    await waitTx(await protocol.write.instantRedeem([cUsdc.address, false, parseEther("100")], { account: borrower.account }));
    const feeRecipientAfter = await usdc.read.balanceOf([deployer.account.address]);
    assert.equal(feeRecipientAfter - feeRecipientBefore, parseEther("0.1"));

    await waitTx(await protocol.write.setEmergencyShutdown([true]));
    let failed = false;
    try {
      await protocol.write.instantRedeem([cUsdc.address, false, parseEther("10")], { account: borrower.account });
    } catch {
      failed = true;
    }
    assert.ok(failed, "instant redemption should be disabled during shutdown");
  });

  it("executes scheduled redemptions pro-rata when liquidity is short", async () => {
    const { publicClient, supplier, borrower, secondRedeemer, waitTx, usdc, cEth, cUsdc, comptroller, protocol } = await setup();

    for (const user of [borrower, secondRedeemer]) {
      await waitTx(await usdc.write.mint([user.account.address, parseEther("1000")]));
      await waitTx(await usdc.write.approve([cUsdc.address, parseEther("1000")], { account: user.account }));
      await waitTx(await cUsdc.write.mint([parseEther("1000")], { account: user.account }));
      await waitTx(await cUsdc.write.approve([protocol.address, parseEther("1000")], { account: user.account }));
    }

    await waitTx(
      await protocol.write.requestScheduledRedemption([cUsdc.address, false, parseEther("1000")], {
        account: borrower.account,
      })
    );
    await waitTx(
      await protocol.write.requestScheduledRedemption([cUsdc.address, false, parseEther("1000")], {
        account: secondRedeemer.account,
      })
    );

    await waitTx(await cEth.write.mint([], { account: supplier.account, value: parseEther("100") }));
    await waitTx(await comptroller.write.enterMarkets([[cEth.address]], { account: supplier.account }));
    await waitTx(await cUsdc.write.borrow([parseEther("101000")], { account: supplier.account }));

    await publicClient.request({ method: "evm_increaseTime", params: [24 * 60 * 60 + 1] });
    await publicClient.request({ method: "evm_mine", params: [] });

    await waitTx(await protocol.write.processRedemptionBatch([1n]));

    const borrowerBefore = await usdc.read.balanceOf([borrower.account.address]);
    const secondBefore = await usdc.read.balanceOf([secondRedeemer.account.address]);
    await waitTx(await protocol.write.claimScheduledRedemption([1n], { account: borrower.account }));
    await waitTx(await protocol.write.claimScheduledRedemption([2n], { account: secondRedeemer.account }));
    const borrowerPaid = (await usdc.read.balanceOf([borrower.account.address])) - borrowerBefore;
    const secondPaid = (await usdc.read.balanceOf([secondRedeemer.account.address])) - secondBefore;

    assert.equal(borrowerPaid, parseEther("500"));
    assert.equal(secondPaid, parseEther("500"));
  });

  it("lets users cancel scheduled redemption early with a penalty", async () => {
    const { borrower, deployer, waitTx, usdc, cUsdc, protocol } = await setup();

    await waitTx(await usdc.write.mint([borrower.account.address, parseEther("1000")]));
    await waitTx(await usdc.write.approve([cUsdc.address, parseEther("1000")], { account: borrower.account }));
    await waitTx(await cUsdc.write.mint([parseEther("1000")], { account: borrower.account }));
    await waitTx(await cUsdc.write.approve([protocol.address, parseEther("1000")], { account: borrower.account }));

    await waitTx(
      await protocol.write.requestScheduledRedemption([cUsdc.address, false, parseEther("1000")], {
        account: borrower.account,
      })
    );

    const feeCTokensBefore = await cUsdc.read.balanceOf([deployer.account.address]);
    await waitTx(await protocol.write.cancelScheduledRedemption([1n], { account: borrower.account }));
    const feeCTokensAfter = await cUsdc.read.balanceOf([deployer.account.address]);

    assert.equal(feeCTokensAfter - feeCTokensBefore, parseEther("20"));
  });

  it("blocks new positions during emergency shutdown while allowing existing positions to close", async () => {
    const { borrower, waitTx, usdc, cEth, cUsdc, protocol } = await setup();

    await waitTx(
      await protocol.write.openPosition(
        [cEth.address, true, parseEther("2"), cUsdc.address, false, parseEther("1000")],
        { account: borrower.account, value: parseEther("2") }
      )
    );

    await waitTx(await protocol.write.setEmergencyShutdown([true]));

    let openFailed = false;
    try {
      await protocol.write.openPosition(
        [cEth.address, true, parseEther("1"), cUsdc.address, false, parseEther("100")],
        { account: borrower.account, value: parseEther("1") }
      );
    } catch {
      openFailed = true;
    }
    assert.ok(openFailed, "Emergency shutdown should block new perpetual positions");

    await waitTx(await usdc.write.mint([borrower.account.address, parseEther("10")]));
    await waitTx(await usdc.write.approve([protocol.address, parseEther("1010")], { account: borrower.account }));
    await waitTx(
      await protocol.write.closePosition([1n, parseEther("1010"), parseEther("2")], {
        account: borrower.account,
      })
    );

    assert.equal(await cUsdc.read.borrowBalanceStored([borrower.account.address]), 0n);
    const position = await protocol.read.positions([1n]);
    assert.equal(position[8], false);
  });
});
