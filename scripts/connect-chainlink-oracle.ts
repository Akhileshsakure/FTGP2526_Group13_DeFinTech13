// scripts/connect-chainlink-oracle.ts
// Deploy a ChainlinkPriceOracle, connect every configured market feed, switch
// the existing Comptroller to it, and update frontend/.env.local.

import { network } from "hardhat";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_MAX_STALENESS_SECONDS = 7 * 24 * 60 * 60;

const FEEDS = {
  ETH_USD: process.env.CHAINLINK_ETH_USD_FEED ?? "0x694AA1769357215DE4FAC081bf1f309aDC325306",
  BTC_USD: process.env.CHAINLINK_BTC_USD_FEED ?? "0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43",
  USDC_USD: process.env.CHAINLINK_USDC_USD_FEED ?? "0xA2F78ab2355fe2f984D808B5CeE7FD0A93D5270E",
  DAI_USD: process.env.CHAINLINK_DAI_USD_FEED ?? "0x14866185B1962B63C3Ea9E03Bc1da838bab34C19",
  USDT_USD:
    process.env.CHAINLINK_USDT_USD_FEED ??
    process.env.CHAINLINK_USDC_USD_FEED ??
    "0xA2F78ab2355fe2f984D808B5CeE7FD0A93D5270E",
};

const REQUIRED_ENV_KEYS = [
  "NEXT_PUBLIC_COMPTROLLER_ADDRESS",
  "NEXT_PUBLIC_CETH_ADDRESS",
  "NEXT_PUBLIC_CUSDC_ADDRESS",
  "NEXT_PUBLIC_CDAI_ADDRESS",
  "NEXT_PUBLIC_CWETH_ADDRESS",
  "NEXT_PUBLIC_CWBTC_ADDRESS",
  "NEXT_PUBLIC_CUSDT_ADDRESS",
] as const;

function parseEnvFile(path: string): Map<string, string> {
  const entries = new Map<string, string>();
  const content = readFileSync(path, "utf8");

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    entries.set(trimmed.slice(0, separator), trimmed.slice(separator + 1));
  }

  return entries;
}

function requireEnv(env: Map<string, string>, key: (typeof REQUIRED_ENV_KEYS)[number]): string {
  const value = env.get(key) ?? process.env[key];
  if (!value) {
    throw new Error(`${key} is not set in frontend/.env.local or process env`);
  }
  return value;
}

function updateEnvFile(path: string, updates: Record<string, string>) {
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  const seen = new Set<string>();
  const nextLines = lines.map((line) => {
    const separator = line.indexOf("=");
    if (separator === -1) return line;

    const key = line.slice(0, separator);
    if (!(key in updates)) return line;

    seen.add(key);
    return `${key}=${updates[key]}`;
  });

  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) nextLines.push(`${key}=${value}`);
  }

  writeFileSync(path, nextLines.join("\n").replace(/\n*$/, "\n"), "utf8");
}

async function main() {
  const connection = (await network.connect()) as Awaited<ReturnType<typeof network.connect>> & {
    ethers: any;
  };
  const ethers = connection.ethers;
  const [deployer] = await ethers.getSigners();

  const frontendEnvPath = resolve(process.cwd(), "frontend", ".env.local");
  const frontendEnv = parseEnvFile(frontendEnvPath);

  const comptrollerAddress = requireEnv(frontendEnv, "NEXT_PUBLIC_COMPTROLLER_ADDRESS");
  const marketFeeds = [
    {
      label: "ETH",
      cToken: requireEnv(frontendEnv, "NEXT_PUBLIC_CETH_ADDRESS"),
      feed: FEEDS.ETH_USD,
    },
    {
      label: "USDC",
      cToken: requireEnv(frontendEnv, "NEXT_PUBLIC_CUSDC_ADDRESS"),
      feed: FEEDS.USDC_USD,
    },
    {
      label: "DAI",
      cToken: requireEnv(frontendEnv, "NEXT_PUBLIC_CDAI_ADDRESS"),
      feed: FEEDS.DAI_USD,
    },
    {
      label: "WETH",
      cToken: requireEnv(frontendEnv, "NEXT_PUBLIC_CWETH_ADDRESS"),
      feed: FEEDS.ETH_USD,
    },
    {
      label: "WBTC",
      cToken: requireEnv(frontendEnv, "NEXT_PUBLIC_CWBTC_ADDRESS"),
      feed: FEEDS.BTC_USD,
    },
    {
      label: "USDT",
      cToken: requireEnv(frontendEnv, "NEXT_PUBLIC_CUSDT_ADDRESS"),
      feed: FEEDS.USDT_USD,
    },
  ];

  const maxStaleness =
    Number(process.env.CHAINLINK_MAX_STALENESS_SECONDS ?? DEFAULT_MAX_STALENESS_SECONDS) || 0;

  console.log("Connecting Chainlink oracle with:", deployer.address);
  console.log("Comptroller:", comptrollerAddress);
  console.log("Max staleness:", maxStaleness, "seconds\n");

  const ChainlinkOracle = await ethers.getContractFactory("ChainlinkPriceOracle");
  const oracle = await ChainlinkOracle.deploy(deployer.address, maxStaleness);
  await oracle.waitForDeployment();
  const oracleAddress = await oracle.getAddress();
  console.log("ChainlinkPriceOracle:", oracleAddress);

  for (const market of marketFeeds) {
    console.log(`Setting ${market.label} feed: ${market.cToken} -> ${market.feed}`);
    await (await oracle.setFeed(market.cToken, market.feed)).wait();
  }

  const Comptroller = await ethers.getContractFactory("Comptroller");
  const comptroller = Comptroller.attach(comptrollerAddress);
  console.log("\nSwitching Comptroller oracle...");
  await (await comptroller._setPriceOracle(oracleAddress)).wait();

  updateEnvFile(frontendEnvPath, {
    NEXT_PUBLIC_ORACLE_ADDRESS: oracleAddress,
  });

  console.log("\nAll markets are connected to ChainlinkPriceOracle.");
  console.log("Updated frontend env file:", frontendEnvPath);
  console.log("NEXT_PUBLIC_ORACLE_ADDRESS=" + oracleAddress);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
