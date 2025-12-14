import type { EthereumClient } from "../../core/components/EthereumClient.js";
import {
  CoinbaseScraper,
  CoinbaseScraperError,
} from "../../core/components/CoinbaseScraper.js";
import type { ButlerConfig } from "../../core/config/index.js";
import { loadScraperConfig } from "../../core/utils/scraperConfigOperations.js";

interface ScrapeCoinbasesOptions {
  network: string;
  fromBlock?: bigint;
  fullRescrape?: boolean;
  configPath?: string;
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

  // 1. Load scraper config
  console.log("Loading scraper configuration...");
  const scraperConfig = await loadScraperConfig(
    options.network,
    options.configPath,
  );

  console.log(`✅ Loaded config for network: ${scraperConfig.network}`);
  console.log(`✅ Provider ID: ${scraperConfig.stakingProviderId}`);
  console.log(
    `✅ Found ${scraperConfig.attesters.length} attester(s) in config`,
  );

  // Extract attester addresses from config
  const attesterAddresses = scraperConfig.attesters.map((a) => a.address);

  // 2. Determine scrape mode and start block
  const defaultStartBlock = DEFAULT_START_BLOCKS[options.network] ?? 0n;

  // 3. Initialize CoinbaseScraper
  const scraper = new CoinbaseScraper({
    network: options.network,
    ethClient,
    providerId: scraperConfig.stakingProviderId,
    attesterAddresses,
    defaultStartBlock,
    ...(options.outputPath ? { outputPath: options.outputPath } : {}),
  });

  // 4. Perform scraping based on mode
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

  // 5. Check for missing attesters
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

  // 6. Print summary
  console.log(`\nSummary:`);
  console.log(`  Network: ${options.network}`);
  console.log(`  Provider ID: ${scraperConfig.stakingProviderId}`);
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
