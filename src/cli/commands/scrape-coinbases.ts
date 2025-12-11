import assert from "assert";
import type { EthereumClient } from "../../core/components/EthereumClient.js";
import {
  CoinbaseScraper,
  CoinbaseScraperError,
} from "../../core/components/CoinbaseScraper.js";
import type { ButlerConfig } from "../../core/config/index.js";
import { extractAttesterAddresses } from "../../core/utils/keystoreOperations.js";

interface ScrapeCoinbasesOptions {
  network: string;
  fromBlock?: bigint;
  fullRescrape?: boolean;
  keystorePaths?: string[];
  outputPath?: string;
  providerId?: bigint;
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

  assert(
    config.PROVIDER_ADMIN_ADDRESS,
    "PROVIDER_ADMIN_ADDRESS must be configured",
  );

  // 1. Get attester addresses
  console.log("Loading attester addresses...");
  let attesterAddresses: string[];

  if (!options.keystorePaths) {
    throw new Error("Keystore paths are required");
  }

  console.log(`Loading ${options.keystorePaths.length} keystore file(s)...`);
  const { loadKeystoresFromPaths } = await import(
    "../../core/utils/keystoreOperations.js"
  );
  const keystores = await loadKeystoresFromPaths(options.keystorePaths);
  attesterAddresses = extractAttesterAddresses(keystores);

  console.log(`✅ Found ${attesterAddresses.length} attester(s) to check`);

  // 2. Get provider ID
  let providerId = options.providerId;
  if (!providerId) {
    console.log("\nQuerying staking provider from chain...");
    const providerData = await ethClient.getStakingProvider(
      config.PROVIDER_ADMIN_ADDRESS,
    );
    if (!providerData) {
      throw new Error(
        `Staking provider not found for admin address: ${config.PROVIDER_ADMIN_ADDRESS}`,
      );
    }
    providerId = providerData.providerId;
    console.log(`✅ Provider ID: ${providerId}`);
  }

  // 3. Determine scrape mode and start block
  const defaultStartBlock = DEFAULT_START_BLOCKS[options.network] ?? 0n;

  // 4. Initialize CoinbaseScraper
  const scraper = new CoinbaseScraper({
    network: options.network,
    ethClient,
    providerId,
    attesterAddresses,
    defaultStartBlock,
    ...(options.outputPath ? { outputPath: options.outputPath } : {}),
  });

  // 5. Perform scraping based on mode
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

  // 6. Check for missing attesters
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

  // 7. Print summary
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
  console.log(
    `\nYou can now use this cache when generating scraper config with generate-scraper-config command.`,
  );
};

export default command;
