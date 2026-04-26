import { network } from "hardhat";
import { parseEther } from "viem";

async function main() {
  const { viem } = await network.connect();
  const publicClient = await viem.getPublicClient();

  console.log("Deploying MockPriceOracle...");
  const oracle = await viem.deployContract("MockPriceOracle");
  console.log(`MockPriceOracle deployed to: ${oracle.address}`);

  const CTOKEN_ADDRESS = "0x0000000000000000000000000000000000000001"; // Matches frontend index.html
  const [deployer] = await viem.getWalletClients();

  // Simulated price trend
  const prices = ["1800", "1850", "1790", "1900", "1950", "2000", "2050", "1980", "2100"];

  console.log("Feeding historical prices...");
  for (let i = 0; i < prices.length; i++) {
    // Advance blockchain time by 1 hour before each update for chart spacing
    const testClient = await viem.getTestClient();
    await testClient.increaseTime({ seconds: 3600 });
    await testClient.mine({ blocks: 1 });

    const price = parseEther(prices[i]);
    const hash = await oracle.write.setUnderlyingPrice([CTOKEN_ADDRESS, price], { account: deployer.account });

    // Wait for transaction confirmation
    await publicClient.waitForTransactionReceipt({ hash });

    console.log(`Set price to $${prices[i]} at block timestamp`);
  }

  console.log("\nOracle data is ready!");
  console.log("Please copy the following address and replace ORACLE_ADDRESS in your frontend/index.html:");
  console.log(`const ORACLE_ADDRESS = "${oracle.address}";`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
