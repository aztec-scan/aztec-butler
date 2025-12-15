import type { EthereumClient } from "../../core/components/EthereumClient.js";
import {
  CoinbaseScraper,
  CoinbaseScraperError,
} from "../../core/components/CoinbaseScraper.js";
import type { ButlerConfig } from "../../core/config/index.js";
import { loadAndMergeKeysFiles } from "../../core/utils/keysFileOperations.js";

interface ScrapeCoinbasesOptions {
  network: string;
  fromBlock?: bigint;
  fullRescrape?: boolean;
  outputPath?: string;
}

// Default deployment blocks for StakingRegistryContract
const DEFAULT_START_BLOCKS: Record<string, bigint> = {
  testnet: 9595580n, // Sepolia
  mainnet: 23786836n,
};

const command = async (
  ethClient: EthereumClient,
  config: ButlerConfig,
  options: ScrapeCoinbasesOptions,
) => {
  console.log("\n=== Scraping Coinbase Addresses ===\n");

  // Load keys files to get attester addresses
  console.log("Loading keys files...");
  const { attesters, filesLoaded } = await loadAndMergeKeysFiles(
    options.network,
  );

  if (filesLoaded.length === 0) {
    throw new Error(
      `No keys files found for network "${options.network}".\n` +
        `Expected pattern: ${options.network}-keys-*.json in data directory.`,
    );
  }

  console.log(
    `✅ Found ${attesters.length} attester(s) from ${filesLoaded.length} file(s)`,
  );

  // Get provider ID from config (must be set in .env)
  if (!config.STAKING_PROVIDER_ID) {
    throw new Error(
      `STAKING_PROVIDER_ID not configured for network "${options.network}".\n` +
        `Add STAKING_PROVIDER_ID to your ${options.network}-base.env file.`,
    );
  }

  const providerId = BigInt(config.STAKING_PROVIDER_ID);
  console.log(`✅ Provider ID: ${providerId}`);

  // Extract attester addresses
  const attesterAddresses = attesters.map((a) => a.address);

  // Determine scrape mode and start block
  const defaultStartBlock = DEFAULT_START_BLOCKS[options.network] ?? 0n;

  // Initialize CoinbaseScraper
  const scraper = new CoinbaseScraper({
    network: options.network,
    ethClient,
    providerId,
    attesterAddresses,
    defaultStartBlock,
    ...(options.outputPath ? { outputPath: options.outputPath } : {}),
  });

  // Perform scraping based on mode
  let result;

  try {
    if (options.fullRescrape) {
      console.log("Mode: Full rescrape (--full flag specified)");
      result = await scraper.scrapeFull();
    } else if (options.fromBlock !== undefined) {
      console.log(`Mode: Custom range (--from-block ${options.fromBlock})`);
      const client =
        ethClient.getArchiveClient() || ethClient.getPublicClient();
      const currentBlock = await client.getBlockNumber();
      const mappings = await scraper.scrapeRange(
        options.fromBlock,
        currentBlock,
      );
      result = {
        mappings,
        startBlock: options.fromBlock,
        endBlock: currentBlock,
        newMappings: mappings.length,
        updatedMappings: 0,
      };
    } else {
      console.log("Mode: Incremental (default)");
      result = await scraper.scrapeIncremental();
    }
  } catch (error) {
    if (error instanceof CoinbaseScraperError) {
      console.error(error.message);
      if (error.conflictBlock) {
        console.error(`\nProcessing stopped at block: ${error.conflictBlock}`);
      }
      process.exit(1);
    }
    throw error;
  }

  // Check for missing attesters
  const mappedAttesters = new Set(
    result.mappings.map((m) => m.attesterAddress.toLowerCase()),
  );
  const missingAttesters = attesterAddresses.filter(
    (addr) => !mappedAttesters.has(addr.toLowerCase()),
  );

  if (missingAttesters.length > 0) {
    console.log(
      `\n⚠️  Warning: ${missingAttesters.length} attester(s) have no coinbase mapping:`,
    );
    missingAttesters.forEach((addr) => console.log(`  - ${addr}`));
  }

  // Print summary
  console.log(`\nSummary:`);
  console.log(`  Network: ${options.network}`);
  console.log(`  Provider ID: ${providerId}`);
  console.log(`  Start block: ${result.startBlock}`);
  console.log(`  End block: ${result.endBlock}`);
  console.log(`  Blocks scraped: ${result.endBlock - result.startBlock + 1n}`);
  console.log(`  Total mappings: ${result.mappings.length}`);
  if (result.newMappings > 0) {
    console.log(`  New mappings: ${result.newMappings}`);
  }
  if (result.updatedMappings > 0) {
    console.log(`  Updated mappings: ${result.updatedMappings}`);
  }
  console.log(`  Missing mappings: ${missingAttesters.length}`);
  console.log(`\nCoinbase cache has been updated.`);
};

export default command;
