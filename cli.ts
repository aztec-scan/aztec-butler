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
  .option("--update-config", "Update scraper config with new keys", false)
  .action(async (keystorePath: string, options: { updateConfig: boolean }) => {
    const globalOpts = program.opts();
    const config = await initConfig({ network: globalOpts.network });
    const ethClient = await initEthClient(config);

    await command.getAddKeysToStakingProviderCalldata(ethClient, config, {
      keystorePath,
      network: config.NETWORK,
      updateConfig: options.updateConfig,
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

// Parse and handle errors
program.parseAsync(process.argv).catch((error) => {
  console.error("❌ Error:\n");
  console.error(formatError(error));
  process.exit(1);
});
