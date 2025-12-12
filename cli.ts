#!/usr/bin/env node
/**
 * CLI entry point for individual commands
 * Usage: node --import 'data:text/javascript,import { register } from "node:module"; import { pathToFileURL } from "node:url"; register("ts-node/esm", pathToFileURL("./"));' cli.ts <command> [options]
 */

import { Command } from "commander";
import { initConfig, type ButlerConfig } from "./src/core/config/index.js";
import { AztecClient } from "./src/core/components/AztecClient.js";
import { EthereumClient } from "./src/core/components/EthereumClient.js";
import * as command from "./src/cli/commands/index.js";
import { glob } from "glob";
import { inspect } from "util";

/**
 * Format any error type into a readable string with stack trace
 */
function formatError(error: unknown): string {
  // Handle standard Error instances
  if (error instanceof Error) {
    return error.stack || error.message;
  }

  // Handle objects with error-like properties
  if (error && typeof error === "object") {
    const err = error as any;
    // Try common error properties
    if (err.message) return String(err.message);
    if (err.reason) return String(err.reason);
    if (err.shortMessage) return String(err.shortMessage);

    // Try JSON.stringify
    try {
      const json = JSON.stringify(error, null, 2);
      if (json && json !== "{}") return json;
    } catch {}

    // Fallback to util.inspect for objects that can't be stringified
    // Use showHidden: false to avoid issues with internal symbols
    try {
      return inspect(error, { depth: 3, colors: false, showHidden: false });
    } catch {
      // If inspect fails, return a basic string representation
      return `[Object: ${Object.prototype.toString.call(error)}]`;
    }
  }

  // Primitive types
  return String(error);
}

/**
 * Helper to parse BigInt values from command-line arguments
 */
function parseBigInt(value: string): bigint {
  return BigInt(value);
}

/**
 * Helper to collect multiple values for repeatable options
 */
function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

/**
 * Initialize Ethereum client with Aztec node info
 */
async function initEthClient(config: ButlerConfig): Promise<EthereumClient> {
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
  return ethClient;
}

// Setup Commander program
const program = new Command();

program
  .name("aztec-butler-cli")
  .description("Aztec Butler CLI - Individual command execution")
  .version("2.0.0");

// Command: get-provider-id
program
  .command("get-provider-id <admin-address>")
  .description("Get staking provider ID for an admin address")
  .action(async (adminAddress: string) => {
    const config = await initConfig();
    const ethClient = await initEthClient(config);
    await command.getProviderId(ethClient, { adminAddress });
  });

// Command: check-publisher-eth
program
  .command("check-publisher-eth")
  .description("Check publisher ETH balances")
  .action(async () => {
    const config = await initConfig();
    const ethClient = await initEthClient(config);

    const keystorePaths = await glob("keystores/**/*.json", {
      cwd: process.cwd(),
      absolute: true,
    });

    if (keystorePaths.length === 0) {
      console.error("❌ No keystore files found in ./keystores/");
      process.exit(1);
    }

    await command.getPublisherEth(ethClient, { keystorePaths });
  });

// Command: add-keys
program
  .command("add-keys <keystore-path>")
  .description("Generate calldata to add keys to staking provider")
  .option("--update-config", "Update scraper config with new keys", false)
  .action(async (keystorePath: string, options: { updateConfig: boolean }) => {
    const config = await initConfig();
    const ethClient = await initEthClient(config);

    await command.getAddKeysToStakingProviderCalldata(ethClient, config, {
      keystorePath,
      network: config.NETWORK,
      updateConfig: options.updateConfig,
    });
  });

// Command: generate-scraper-config
program
  .command("generate-scraper-config")
  .description("Generate scraper configuration from keystores")
  .option("--input <path>", "Input keystore file path or glob pattern")
  .option("--output <path>", "Output file path for scraper config")
  .option("--provider-id <id>", "Staking provider ID", parseBigInt)
  .action(
    async (options: {
      input?: string;
      output?: string;
      providerId?: bigint;
    }) => {
      const config = await initConfig();
      const ethClient = await initEthClient(config);

      // Handle input keystore paths
      let keystorePaths: string[];
      if (options.input) {
        // Check if it's a glob pattern or single file
        if (options.input.includes("*")) {
          keystorePaths = await glob(options.input, {
            cwd: process.cwd(),
            absolute: true,
          });
        } else {
          // Treat as single file path
          keystorePaths = [options.input];
        }
      } else {
        // Default behavior
        keystorePaths = await glob("keystores/**/*.json", {
          cwd: process.cwd(),
          absolute: true,
        });
      }

      if (keystorePaths.length === 0) {
        console.error("❌ No keystore files found");
        process.exit(1);
      }

      await command.generateScraperConfig(ethClient, config, {
        network: config.NETWORK,
        l1ChainId: config.ETHEREUM_CHAIN_ID,
        keystorePaths,
        includeZeroCoinbases: true,
        ...(options.output ? { outputPath: options.output } : {}),
        ...(options.providerId !== undefined
          ? { providerId: options.providerId }
          : {}),
      });
    },
  );

// Command: scrape-coinbases
program
  .command("scrape-coinbases")
  .description("Scrape coinbase addresses from chain")
  .option("--input <path>", "Input keystore file path or glob pattern")
  .option("--output <path>", "Output file path for coinbase data")
  .option("--full", "Perform full rescrape from deployment block", false)
  .option(
    "--from-block <block>",
    "Start from specific block number",
    parseBigInt,
  )
  .option("--provider-id <id>", "Staking provider ID", parseBigInt)
  .action(
    async (options: {
      input?: string;
      output?: string;
      full: boolean;
      fromBlock?: bigint;
      providerId?: bigint;
    }) => {
      const config = await initConfig();
      const ethClient = await initEthClient(config);

      // Handle input keystore paths
      let keystorePaths: string[];
      if (options.input) {
        if (options.input.includes("*")) {
          keystorePaths = await glob(options.input, {
            cwd: process.cwd(),
            absolute: true,
          });
        } else {
          keystorePaths = [options.input];
        }
      } else {
        keystorePaths = await glob("keystores/**/*.json", {
          cwd: process.cwd(),
          absolute: true,
        });
      }

      if (keystorePaths.length === 0) {
        console.error("❌ No keystore files found");
        process.exit(1);
      }

      await command.scrapeCoinbases(ethClient, config, {
        network: config.NETWORK,
        keystorePaths,
        fullRescrape: options.full,
        ...(options.output ? { outputPath: options.output } : {}),
        ...(options.fromBlock !== undefined
          ? { fromBlock: options.fromBlock }
          : {}),
        ...(options.providerId !== undefined
          ? { providerId: options.providerId }
          : {}),
      });
    },
  );

// Command: scrape-attester-status
program
  .command("scrape-attester-status")
  .description("Scrape attester on-chain status (defaults to config attesters)")
  .option("--active", "Check active attesters from config", false)
  .option("--queued", "Check queued attesters from config", false)
  .option("--all-active", "Check all active attesters on-chain", false)
  .option("--all-queued", "Check all queued attesters on-chain", false)
  .option(
    "--address <address>",
    "Specific attester address to check (can be repeated)",
    collect,
    [],
  )
  .action(
    async (options: {
      active: boolean;
      queued: boolean;
      allActive: boolean;
      allQueued: boolean;
      address: string[];
    }) => {
      const config = await initConfig();
      const ethClient = await initEthClient(config);

      await command.scrapeAttesterStatus(ethClient, {
        allActive: options.allActive,
        allQueued: options.allQueued,
        active: options.active,
        queued: options.queued,
        network: config.NETWORK,
        ...(options.address.length > 0 ? { addresses: options.address } : {}),
      });
    },
  );

// Command: process-private-keys
program
  .command("process-private-keys <private-key-file>")
  .description(
    "Process private keys to generate public keys and check provider queue",
  )
  .option(
    "-o, --output <file>",
    "Output file path (default: public-[input-file].json)",
  )
  .action(async (privateKeyFile: string, options: { output?: string }) => {
    const config = await initConfig();
    const ethClient = await initEthClient(config);

    await command.processPrivateKeys(ethClient, config, {
      privateKeyFile,
      ...(options.output ? { outputFile: options.output } : {}),
    });
  });

// Parse and handle errors
program.parseAsync(process.argv).catch((error) => {
  console.error("❌ Error:\n");
  console.error(formatError(error));
  process.exit(1);
});
