#!/usr/bin/env node
/**
 * CLI entry point for individual commands
 * Usage: node --import 'data:text/javascript,import { register } from "node:module"; import { pathToFileURL } from "node:url"; register("ts-node/esm", pathToFileURL("./"));' cli.ts <command> [options]
 */

import { initConfig } from "./src/core/config/index.js";
import { AztecClient } from "./src/core/components/AztecClient.js";
import { EthereumClient } from "./src/core/components/EthereumClient.js";
import * as command from "./src/cli/commands/index.js";
import { glob } from "glob";

const args = process.argv.slice(2);
const commandName = args[0];

async function main() {
  if (!commandName || commandName === "help" || commandName === "--help") {
    console.log("Aztec Butler CLI");
    console.log("");
    console.log("Usage: npm run cli -- <command> [options]");
    console.log("");
    console.log("Commands:");
    console.log(
      "  generate-scraper-config              Generate scraper configuration from keystores",
    );
    console.log(
      "  scrape-coinbases                     Scrape coinbase addresses from chain",
    );
    console.log(
      "  add-keys <keystore> [--update-config] Generate calldata to add keys",
    );
    console.log(
      "  check-publisher-eth                  Check publisher ETH balances",
    );
    console.log("");
    console.log("Examples:");
    console.log("  npm run cli -- generate-scraper-config");
    console.log(
      "  npm run cli -- add-keys keystores/examples/key1.json --update-config",
    );
    console.log("  npm run cli -- check-publisher-eth");
    process.exit(0);
  }

  // Initialize config
  const config = await initConfig();

  // Initialize Aztec client
  const aztecClient = new AztecClient({
    nodeUrl: config.AZTEC_NODE_URL,
  });
  const nodeInfo = await aztecClient.getNodeInfo();

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

  switch (commandName) {
    case "generate-scraper-config": {
      const keystorePaths = await glob("keystores/**/*.json", {
        cwd: process.cwd(),
        absolute: true,
      });

      if (keystorePaths.length === 0) {
        console.error("❌ No keystore files found in ./keystores/");
        process.exit(1);
      }

      await command.generateScraperConfig(ethClient, config, {
        network: config.NETWORK,
        l1ChainId: config.ETHEREUM_CHAIN_ID,
        keystorePaths,
        includeZeroCoinbases: true,
      });
      break;
    }

    case "scrape-coinbases": {
      const keystorePaths = await glob("keystores/**/*.json", {
        cwd: process.cwd(),
        absolute: true,
      });

      if (keystorePaths.length === 0) {
        console.error("❌ No keystore files found in ./keystores/");
        process.exit(1);
      }

      await command.scrapeCoinbases(ethClient, config, {
        network: config.NETWORK,
        keystorePaths,
      });
      break;
    }

    case "add-keys": {
      const keystorePath = args[1];
      const updateConfig = args.includes("--update-config");

      if (!keystorePath) {
        console.error("❌ Error: Keystore path required");
        console.error("");
        console.error(
          "Usage: npm run cli -- add-keys <keystore-path> [--update-config]",
        );
        console.error("");
        console.error("Example:");
        console.error(
          "  npm run cli -- add-keys keystores/examples/key1.json --update-config",
        );
        process.exit(1);
      }

      await command.getAddKeysToStakingProviderCalldata(ethClient, config, {
        keystorePath,
        network: config.NETWORK,
        updateConfig,
      });
      break;
    }

    case "check-publisher-eth": {
      const keystorePaths = await glob("keystores/**/*.json", {
        cwd: process.cwd(),
        absolute: true,
      });

      if (keystorePaths.length === 0) {
        console.error("❌ No keystore files found in ./keystores/");
        process.exit(1);
      }

      await command.getPublisherEth(ethClient, {
        keystorePaths,
      });
      break;
    }

    default:
      console.error(`❌ Unknown command: ${commandName}`);
      console.error("");
      console.error("Run 'npm run cli -- help' to see available commands");
      process.exit(1);
  }
}

main().catch((error) => {
  console.error("❌ Error:", error.message);
  if (error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});
