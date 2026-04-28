import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseEther } from "viem";

describe("Oracle implementations", async () => {
  it("uses MockPriceOracle for tests", async () => {
    const { viem } = await network.connect();
    const [deployer] = await viem.getWalletClients();
    const oracle = await viem.deployContract("MockPriceOracle");
    const market = deployer.account.address;

    await oracle.write.setUnderlyingPrice([market, parseEther("123")]);
    assert.equal(await oracle.read.getUnderlyingPrice([market]), parseEther("123"));
  });

  it("uses ChainlinkPriceOracle for production feeds with stale-price checks", async () => {
    const { viem } = await network.connect();
    const publicClient = await viem.getPublicClient();
    const [deployer] = await viem.getWalletClients();
    const market = deployer.account.address;

    const feed = await viem.deployContract("MockV3Aggregator", [8, 2000_00000000n]);
    const oracle = await viem.deployContract("ChainlinkPriceOracle", [
      deployer.account.address,
      60n * 60n,
    ]);

    await oracle.write.setFeed([market, feed.address]);
    assert.equal(await oracle.read.getUnderlyingPrice([market]), parseEther("2000"));

    const block = await publicClient.getBlock();
    await feed.write.setUpdatedAt([block.timestamp - 2n * 60n * 60n]);

    let failed = false;
    try {
      await oracle.read.getUnderlyingPrice([market]);
    } catch {
      failed = true;
    }
    assert.ok(failed, "stale production feed should be rejected");
  });
});
