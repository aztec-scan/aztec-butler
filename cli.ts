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
    console.log("  generate-scraper-config [--provider-id <id>]");
    console.log(
      "                                       Generate scraper configuration from keystores",
    );
    console.log(
      "  scrape-coinbases [--full] [--from-block <block>] [--provider-id <id>]",
    );
    console.log(
      "                                       Scrape coinbase addresses from chain",
    );
    console.log(
      "  add-keys <keystore> [--update-config] Generate calldata to add keys",
    );
    console.log(
      "  check-publisher-eth                  Check publisher ETH balances",
    );
    console.log(
      "  get-provider-id <admin-address>      Get staking provider ID for an admin address",
    );
    console.log("");
    console.log("Examples:");
    console.log("  npm run cli -- generate-scraper-config");
    console.log("  npm run cli -- generate-scraper-config --provider-id 123");
    console.log("  npm run cli -- scrape-coinbases");
    console.log("  npm run cli -- scrape-coinbases --full");
    console.log("  npm run cli -- scrape-coinbases --from-block 12345678");
    console.log("  npm run cli -- scrape-coinbases --provider-id 123");
    console.log(
      "  npm run cli -- add-keys keystores/examples/key1.json --update-config",
    );
    console.log("  npm run cli -- check-publisher-eth");
    console.log(
      "  npm run cli -- get-provider-id 0x1234567890abcdef1234567890abcdef12345678",
    );
    process.exit(0);
  }

  // Initialize config only after help check
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

      // Parse --provider-id flag
      const providerIdIndex = args.indexOf("--provider-id");
      const providerId =
        providerIdIndex !== -1 && args[providerIdIndex + 1]
          ? BigInt(args[providerIdIndex + 1])
          : undefined;

      await command.generateScraperConfig(ethClient, config, {
        network: config.NETWORK,
        l1ChainId: config.ETHEREUM_CHAIN_ID,
        keystorePaths,
        includeZeroCoinbases: true,
        ...(providerId !== undefined ? { providerId } : {}),
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

      // Parse flags
      const fullRescrape = args.includes("--full");
      const fromBlockIndex = args.indexOf("--from-block");
      const fromBlock =
        fromBlockIndex !== -1 && args[fromBlockIndex + 1]
          ? BigInt(args[fromBlockIndex + 1])
          : undefined;
      const providerIdIndex = args.indexOf("--provider-id");
      const providerId =
        providerIdIndex !== -1 && args[providerIdIndex + 1]
          ? BigInt(args[providerIdIndex + 1])
          : undefined;

      await command.scrapeCoinbases(ethClient, config, {
        network: config.NETWORK,
        keystorePaths,
        fullRescrape,
        fromBlock,
        ...(providerId !== undefined ? { providerId } : {}),
      });
      break;
    }

    case "get-provider-id": {
      const adminAddress = args[1];

      if (!adminAddress) {
        console.error("❌ Error: Admin address required");
        console.error("");
        console.error("Usage: npm run cli -- get-provider-id <admin-address>");
        console.error("");
        console.error("Example:");
        console.error(
          "  npm run cli -- get-provider-id 0x1234567890abcdef1234567890abcdef12345678",
        );
        process.exit(1);
      }

      await command.getProviderId(ethClient, { adminAddress });
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
  if (error instanceof Error) {
    console.error("❌ Error:", error.message);
    if (error.stack) {
      console.error(error.stack);
    }
  } else {
    console.error("❌ Error:", error);
  }
  process.exit(1);
});
