import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseEther, zeroAddress } from "viem";

describe("Security and edge-case tests", async () => {
  async function setup() {
    const { viem } = await network.connect();
    const publicClient = await viem.getPublicClient();
    const [deployer, user, attacker, supplier] = await viem.getWalletClients();

    async function waitTx(hash: `0x${string}`) {
      return publicClient.waitForTransactionReceipt({ hash });
    }

    const oracle = await viem.deployContract("MockPriceOracle");

    const interestRateModel = await viem.deployContract("AaveInterestRateStrategy", [
      deployer.account.address,
      parseEther("0.45"),
      0n,
      parseEther("0.07"),
      parseEther("3"),
    ]);

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

    await waitTx(await oracle.write.setUnderlyingPrice([cErc20.address, parseEther("1")]));
    await waitTx(await oracle.write.setUnderlyingPrice([cEth.address, parseEther("2000")]));

    await waitTx(
      await comptroller.write._supportMarket([
        cErc20.address,
        parseEther("0.75"),
        parseEther("0.8"),
        parseEther("1.05"),
      ])
    );

    await waitTx(
      await comptroller.write._supportMarket([
        cEth.address,
        parseEther("0.5"),
        parseEther("0.6"),
        parseEther("1.05"),
      ])
    );

    return {
      deployer,
      user,
      attacker,
      supplier,
      waitTx,
      oracle,
      comptroller,
      token,
      cErc20,
      cEth,
    };
  }

  it("should prevent non-admin users from changing market caps", async () => {
    const { attacker, comptroller, cEth } = await setup();

    let failed = false;
    try {
      await comptroller.write._setMarketCaps(
        [cEth.address, parseEther("1"), parseEther("1")],
        { account: attacker.account }
      );
    } catch {
      failed = true;
    }

    assert.ok(failed, "non-admin should not be able to set market caps");
  });

  it("should prevent non-admin users from pausing a market", async () => {
    const { attacker, comptroller, cEth } = await setup();

    let failed = false;
    try {
      await comptroller.write._setMarketPause([cEth.address, true], {
        account: attacker.account,
      });
    } catch {
      failed = true;
    }

    assert.ok(failed, "non-admin should not be able to pause market");
  });

  it("should reject zero amount operations", async () => {
    const { user, cEth, cErc20 } = await setup();

    let ethMintFailed = false;
    try {
      await cEth.write.mint([], { account: user.account, value: 0n });
    } catch {
      ethMintFailed = true;
    }
    assert.ok(ethMintFailed, "minting zero ETH should fail");

    let erc20MintFailed = false;
    try {
      await cErc20.write.mint([0n], { account: user.account });
    } catch {
      erc20MintFailed = true;
    }
    assert.ok(erc20MintFailed, "minting zero ERC20 should fail");

    let borrowFailed = false;
    try {
      await cEth.write.borrow([0n], { account: user.account });
    } catch {
      borrowFailed = true;
    }
    assert.ok(borrowFailed, "borrowing zero should fail");

    let redeemFailed = false;
    try {
      await cEth.write.redeemUnderlying([0n], { account: user.account });
    } catch {
      redeemFailed = true;
    }
    assert.ok(redeemFailed, "redeeming zero should fail");
  });

  it("should reject borrowing without collateral", async () => {
    const { user, supplier, waitTx, cEth } = await setup();

    await waitTx(
      await cEth.write.mint([], {
        account: supplier.account,
        value: parseEther("10"),
      })
    );

    let failed = false;
    try {
      await cEth.write.borrow([parseEther("1")], { account: user.account });
    } catch {
      failed = true;
    }

    assert.ok(failed, "borrow without collateral should fail");
  });

  it("should reject redeem that would make account undercollateralized", async () => {
    const { user, supplier, waitTx, comptroller, cEth } = await setup();

    await waitTx(
      await cEth.write.mint([], {
        account: supplier.account,
        value: parseEther("20"),
      })
    );

    await waitTx(
      await cEth.write.mint([], {
        account: user.account,
        value: parseEther("2"),
      })
    );

    await waitTx(
      await comptroller.write.enterMarkets([[cEth.address]], {
        account: user.account,
      })
    );

    await waitTx(
      await cEth.write.borrow([parseEther("0.8")], {
        account: user.account,
      })
    );

    let failed = false;
    try {
      await cEth.write.redeemUnderlying([parseEther("2")], {
        account: user.account,
      });
    } catch {
      failed = true;
    }

    assert.ok(failed, "redeem should fail when it causes insufficient liquidity");
  });

  it("should reject oracle price of zero in liquidity-sensitive paths", async () => {
    const { user, waitTx, oracle, comptroller, token, cErc20, cEth } = await setup();

    await waitTx(await token.write.mint([user.account.address, parseEther("1000")]));
    await waitTx(
      await token.write.approve([cErc20.address, parseEther("1000")], {
        account: user.account,
      })
    );

    await waitTx(
      await cErc20.write.mint([parseEther("1000")], {
        account: user.account,
      })
    );

    await waitTx(
      await comptroller.write.enterMarkets([[cErc20.address]], {
        account: user.account,
      })
    );

    await waitTx(await oracle.write.setUnderlyingPrice([cErc20.address, 0n]));

    const liquidity = await comptroller.read.getAccountLiquidity([user.account.address]);
    assert.notEqual(liquidity[0], 0n, "liquidity calculation should return oracle price error");

    let failed = false;
    try {
      await cEth.write.borrow([parseEther("0.1")], { account: user.account });
    } catch {
      failed = true;
    }

    assert.ok(failed, "borrow should fail when collateral oracle price is zero");
  });

  it("should reject zero router addresses", async () => {
    const { comptroller, cEth } = await setup();

    let comptrollerRouterFailed = false;
    try {
      await comptroller.write.setRouter([zeroAddress, true]);
    } catch {
      comptrollerRouterFailed = true;
    }
    assert.ok(comptrollerRouterFailed, "comptroller should reject zero router");

    let cTokenRouterFailed = false;
    try {
      await cEth.write.setRouter([zeroAddress, true]);
    } catch {
      cTokenRouterFailed = true;
    }
    assert.ok(cTokenRouterFailed, "cToken should reject zero router");
  });
});
