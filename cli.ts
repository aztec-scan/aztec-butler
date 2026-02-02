#!/usr/bin/env node
/**
 * CLI entry point for individual commands
 * Usage: node --import 'data:text/javascript,import { register } from "node:module"; import { pathToFileURL } from "node:url"; register("ts-node/esm", pathToFileURL("./"));' cli.ts <command> [options]
 */

import { Command } from "commander";
import {
  initConfig,
  PACKAGE_VERSION,
  type ButlerConfig,
} from "./src/core/config/index.js";
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
    // Check for nested cause
    let message = error.stack || error.message;
    if (error.cause) {
      message += `\n\nCaused by: ${formatError(error.cause)}`;
    }
    return message;
  }

  // Handle objects with error-like properties
  if (error && typeof error === "object") {
    const err = error as any;

    // Check for common RPC/fetch error patterns
    if (err.code && err.message) {
      return `${err.code}: ${err.message}${err.details ? `\n  Details: ${err.details}` : ""}`;
    }

    // Try common error properties
    if (err.message) return String(err.message);
    if (err.reason) return String(err.reason);
    if (err.shortMessage) return String(err.shortMessage);

    // Check for response/status from fetch errors
    if (err.status || err.statusText) {
      return `HTTP ${err.status || "?"}: ${err.statusText || "Unknown error"}${err.url ? ` (${err.url})` : ""}`;
    }

    // Try JSON.stringify (with custom replacer for BigInt)
    try {
      const json = JSON.stringify(
        error,
        (key, value) => (typeof value === "bigint" ? value.toString() : value),
        2,
      );
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

// Global error handlers to catch uncaught exceptions and unhandled rejections
process.on("uncaughtException", (error) => {
  console.error("❌ Uncaught Exception:\n");
  console.error(formatError(error));
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("❌ Unhandled Rejection:\n");
  console.error(formatError(reason));
  process.exit(1);
});

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

  let nodeInfo;
  try {
    nodeInfo = await aztecClient.getNodeInfo();
  } catch (error) {
    throw new Error(
      `Failed to connect to Aztec node at ${config.AZTEC_NODE_URL}\n` +
        `Please check:\n` +
        `  1. The node is running and accessible\n` +
        `  2. AZTEC_NODE_URL is correctly configured\n` +
        `  3. Network connectivity to the node\n\n` +
        `Original error: ${formatError(error)}`,
    );
  }

  // Initialize Ethereum client
  const ethClient = new EthereumClient({
    rpcUrl: config.ETHEREUM_NODE_URL,
    ...(config.ETHEREUM_ARCHIVE_NODE_URL
      ? { archiveRpcUrl: config.ETHEREUM_ARCHIVE_NODE_URL }
      : {}),
    chainId: nodeInfo.l1ChainId,
    rollupAddress: nodeInfo.l1ContractAddresses.rollupAddress.toString(),
  });

  try {
    await ethClient.verifyChainId();
  } catch (error) {
    throw new Error(
      `Failed to verify Ethereum chain ID at ${config.ETHEREUM_NODE_URL}\n` +
        `Expected chain ID: ${nodeInfo.l1ChainId}\n\n` +
        `Original error: ${formatError(error)}`,
    );
  }

  return ethClient;
}

// Setup Commander program
const program = new Command();

program
  .name("aztec-butler-cli")
  .description("Aztec Butler CLI - Individual command execution")
  .version(PACKAGE_VERSION)
  .option("--network <network>", "Network to use (mainnet, testnet, etc.)");

// Command: get-provider-id
program
  .command("get-provider-id <admin-address>")
  .description("Get staking provider ID for an admin address")
  .action(async (adminAddress: string) => {
    const globalOpts = program.opts();
    const config = await initConfig({ network: globalOpts.network });
    const ethClient = await initEthClient(config);
    await command.getProviderId(ethClient, { adminAddress });
  });

// Command: check-publisher-eth
program
  .command("check-publisher-eth")
  .description("Check publisher ETH balances")
  .action(async () => {
    const globalOpts = program.opts();
    const config = await initConfig({ network: globalOpts.network });
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
  .action(async (keystorePath: string) => {
    const globalOpts = program.opts();
    const config = await initConfig({ network: globalOpts.network });
    const ethClient = await initEthClient(config);

    await command.getAddKeysToStakingProviderCalldata(ethClient, config, {
      keystorePath,
      network: config.NETWORK,
    });
  });

// Command: scrape-coinbases
program
  .command("scrape-coinbases")
  .description("Scrape coinbase addresses from chain")
  .option(
    "--config <path>",
    "Path to scraper config file (defaults to standard path for network)",
  )
  .option("--output <path>", "Output file path for coinbase data")
  .option("--full", "Perform full rescrape from deployment block", false)
  .option(
    "--from-block <block>",
    "Start from specific block number",
    parseBigInt,
  )
  .action(
    async (options: {
      config?: string;
      output?: string;
      full: boolean;
      fromBlock?: bigint;
    }) => {
      const globalOpts = program.opts();
      const config = await initConfig({ network: globalOpts.network });
      const ethClient = await initEthClient(config);

      await command.scrapeCoinbases(ethClient, config, {
        network: config.NETWORK,
        fullRescrape: options.full,
        ...(options.config ? { configPath: options.config } : {}),
        ...(options.output ? { outputPath: options.output } : {}),
        ...(options.fromBlock !== undefined
          ? { fromBlock: options.fromBlock }
          : {}),
      });
    },
  );

// Command: scrape-attester-status
program
  .command("scrape-attester-status")
  .description("Scrape attester on-chain status and automatically update cache")
  .option("--active", "Show only active attesters from cache", false)
  .option("--queued", "Show only queued attesters from cache", false)
  .option(
    "--provider-queue",
    "Show only provider queue attesters from cache",
    false,
  )
  .option("--all-active", "Scrape all active attesters on-chain", false)
  .option("--all-queued", "Scrape all queued attesters on-chain", false)
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
      providerQueue: boolean;
      allActive: boolean;
      allQueued: boolean;
      address: string[];
    }) => {
      const globalOpts = program.opts();
      const config = await initConfig({ network: globalOpts.network });
      const ethClient = await initEthClient(config);

      await command.scrapeAttesterStatus(ethClient, config, {
        allActive: options.allActive,
        allQueued: options.allQueued,
        active: options.active,
        queued: options.queued,
        providerQueue: options.providerQueue,
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
    const globalOpts = program.opts();
    const config = await initConfig({ network: globalOpts.network });
    const ethClient = await initEthClient(config);

    await command.processPrivateKeys(ethClient, config, {
      privateKeyFile,
      ...(options.output ? { outputFile: options.output } : {}),
    });
  });

// Command: prepare-deployment
program
  .command("prepare-deployment")
  .description(
    "Merge production keys with new public keys and prepare for deployment",
  )
  .requiredOption(
    "--production-keys <path>",
    "Path to existing production keyfile",
  )
  .requiredOption(
    "--new-public-keys <path>",
    "Path to new public keys file from process-private-keys",
  )
  .requiredOption(
    "--available-publishers <path>",
    "Path to JSON array of available publisher addresses",
  )
  .option(
    "-o, --output <path>",
    "Output file path (default: [production-keys].new)",
  )
  .action(
    async (options: {
      productionKeys: string;
      newPublicKeys: string;
      availablePublishers: string;
      output?: string;
    }) => {
      const globalOpts = program.opts();
      const config = await initConfig({ network: globalOpts.network });
      const ethClient = await initEthClient(config);

      await command.prepareDeployment(ethClient, config, {
        productionKeys: options.productionKeys,
        newPublicKeys: options.newPublicKeys,
        availablePublishers: options.availablePublishers,
        network: config.NETWORK,
        ...(options.output ? { outputPath: options.output } : {}),
      });
    },
  );

// Command: fill-coinbases
program
  .command("fill-coinbases")
  .description("Fill coinbase addresses into a keys file from cache")
  .requiredOption("--keys-file <path>", "Path to keys file to update")
  .option(
    "--increment-version",
    "Create a new version instead of overwriting",
    false,
  )
  .action(async (options: { keysFile: string; incrementVersion?: boolean }) => {
    const globalOpts = program.opts();
    const config = await initConfig({ network: globalOpts.network });
    const ethClient = await initEthClient(config);

    await command.fillCoinbases(ethClient, config, {
      network: config.NETWORK,
      keysFile: options.keysFile,
      ...(options.incrementVersion
        ? { incrementVersion: options.incrementVersion }
        : {}),
    });
  });

// Command: get-queue-stats
program
  .command("get-queue-stats")
  .description("Get entry queue statistics and timing estimates")
  .option("--json", "Output as JSON", false)
  .action(async (options: { json: boolean }) => {
    const globalOpts = program.opts();
    const config = await initConfig({ network: globalOpts.network });
    const ethClient = await initEthClient(config);

    await command.getQueueStats(ethClient, config, {
      network: config.NETWORK,
      json: options.json,
    });
  });

// Command: check-hosts
program
  .command("check-hosts")
  .description("Check host connection status and service availability")
  .option("--config <path>", "Path to hosts config file")
  .option("--host <name>", "Check specific host only")
  .option("--check <type>", "Check specific type (dns, p2p, rpc, all)")
  .option("--json", "Output as JSON", false)
  .action(
    async (options: {
      config?: string;
      host?: string;
      check?: "dns" | "p2p" | "rpc" | "all";
      json: boolean;
    }) => {
      const globalOpts = program.opts();
      const config = await initConfig({ network: globalOpts.network });
      await command.checkHosts(config, options);
    },
  );

// Parse and handle errors
program.parseAsync(process.argv).catch((error) => {
  console.error("❌ Error:\n");
  console.error(formatError(error));
  process.exit(1);
});
