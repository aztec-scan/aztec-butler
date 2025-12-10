#!/usr/bin/env node
/**
 * Test script for new CLI commands
 * Usage: node --import 'data:text/javascript,import { register } from "node:module"; import { pathToFileURL } from "node:url"; register("ts-node/esm", pathToFileURL("./"));' test-cli-commands.ts [command]
 */

import { initConfig } from "./src/core/config/index.js";
import { AztecClient } from "./src/core/components/AztecClient.js";
import { EthereumClient } from "./src/core/components/EthereumClient.js";
import * as command from "./src/cli/commands/index.js";
import { glob } from "glob";
import path from "path";

const commandName = process.argv[2] || "help";

async function main() {
  console.log(`\n=== Testing Command: ${commandName} ===\n`);

  // Initialize config
  const config = await initConfig();

  // Initialize Aztec client
  const aztecClient = new AztecClient({
    nodeUrl: config.AZTEC_NODE_URL,
  });
  const nodeInfo = await aztecClient.getNodeInfo();
  console.log("✅ Connected to Aztec node:", nodeInfo.nodeVersion);

  // Initialize Ethereum client
  const ethClient = new EthereumClient({
    rpcUrl: config.ETHEREUM_NODE_URL,
    ...(config.ETHEREUM_ARCHIVE_NODE_URL
      ? { archiveRpcUrl: config.ETHEREUM_ARCHIVE_NODE_URL }
      : {}),
    chainId: nodeInfo.l1ChainId,
    rollupAddress: nodeInfo.l1ContractAddresses.rollupAddress.toString(),
  });

  await ethClient.verifyChainId();
  console.log("✅ Connected to Ethereum\n");

  // Get all keystore files
  const keystorePaths = await glob("keystores/**/*.json", {
    cwd: process.cwd(),
    absolute: true,
  });

  if (keystorePaths.length === 0) {
    console.error("❌ No keystore files found in ./keystores/");
    process.exit(1);
  }

  console.log(`Found ${keystorePaths.length} keystore file(s):`);
  keystorePaths.forEach((p: string) =>
    console.log(`  - ${path.relative(process.cwd(), p)}`),
  );
  console.log();

  switch (commandName) {
    case "generate-scraper-config":
      await command.generateScraperConfig(ethClient, config, {
        network: config.NETWORK,
        l1ChainId: config.ETHEREUM_CHAIN_ID,
        keystorePaths,
        includeZeroCoinbases: true,
      });
      break;

    case "scrape-coinbases":
      await command.scrapeCoinbases(ethClient, config, {
        network: config.NETWORK,
        keystorePaths,
      });
      break;

    case "get-add-keys-to-staking-provider-calldata": {
      console.log("\n=== Getting Add Keys To Staking Provider Calldata ===\n");
      // Use first keystore as example
      if (keystorePaths.length === 0) {
        console.error("❌ No keystores found");
        break;
      }
      await command.getAddKeysToStakingProviderCalldata(ethClient, config, {
        keystorePath: keystorePaths[0]!,
        network: config.NETWORK,
        updateConfig: true,
      });
      break;
    }

    case "get-publisher-eth": {
      console.log("\n=== Checking Publisher ETH Balances ===\n");
      await command.getPublisherEth(ethClient, {
        keystorePaths,
      });
      break;
    }

    case "help":
    default:
      console.log("Available commands:");
      console.log(
        "  generate-scraper-config                   - Generate scraper configuration",
      );
      console.log(
        "  scrape-coinbases                          - Scrape coinbase addresses",
      );
      console.log(
        "  get-add-keys-to-staking-provider-calldata - Generate calldata for adding keys",
      );
      console.log(
        "  get-publisher-eth                         - Check publisher ETH balances",
      );
      console.log("\nUsage:");
      console.log("  npm run test:cli -- <command>");
      break;
  }
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
