import assert from "assert";
import { parseAbiItem } from "viem";
import type { EthereumClient } from "../../core/components/EthereumClient.js";
import type { ButlerConfig } from "../../core/config/index.js";
import { extractAttesterAddresses } from "../../core/utils/keystoreOperations.js";
import {
  loadScraperConfig,
  loadCoinbaseCache,
  saveCoinbaseCache,
} from "../../core/utils/scraperConfigOperations.js";
import type {
  CoinbaseMappingCache,
  MappedCoinbase,
} from "../../types/scraper-config.js";

interface ScrapeCoinbasesOptions {
  network: string;
  startBlock?: bigint;
  keystorePaths?: string[];
  configPath?: string;
  outputPath?: string;
  providerId?: bigint;
}

// Default deployment blocks for StakingRegistryContract
const DEFAULT_START_BLOCKS: Record<string, bigint> = {
  testnet: 9595580n, // Sepolia
  mainnet: 23786836n,
};

const STAKED_WITH_PROVIDER_EVENT = parseAbiItem(
  "event StakedWithProvider(uint256 indexed providerIdentifier, address indexed rollupAddress, address indexed attester, address coinbaseSplitContractAddress, address stakerImplementation)",
);

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

  if (options.keystorePaths) {
    console.log(`Loading ${options.keystorePaths.length} keystore file(s)...`);
    const { loadKeystoresFromPaths } = await import(
      "../../core/utils/keystoreOperations.js"
    );
    const keystores = await loadKeystoresFromPaths(options.keystorePaths);
    attesterAddresses = extractAttesterAddresses(keystores);
  } else if (options.configPath) {
    console.log(`Loading from scraper config: ${options.configPath}`);
    const scraperConfig = await loadScraperConfig(
      options.network,
      options.configPath,
    );
    attesterAddresses = scraperConfig.attesters.map((a) => a.address);
  } else {
    throw new Error(
      "Must provide either keystore paths or config path to get attester addresses",
    );
  }

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

  // 3. Determine start block
  const startBlock =
    options.startBlock ?? DEFAULT_START_BLOCKS[options.network] ?? 0n;
  console.log(`\nStart block: ${startBlock}`);

  // 4. Check if archive client is available
  const archiveClient = ethClient.getArchiveClient();
  if (!archiveClient && !config.ETHEREUM_ARCHIVE_NODE_URL) {
    throw new Error(
      "ETHEREUM_ARCHIVE_NODE_URL is required for coinbase scraping.\n" +
        "Please configure an archive node URL in your config file.",
    );
  }

  const client = archiveClient || ethClient.getPublicClient();

  // 5. Get current block number
  const currentBlock = await client.getBlockNumber();
  console.log(`Current block: ${currentBlock}`);
  console.log(
    `Scraping range: ${startBlock} to ${currentBlock} (${currentBlock - startBlock} blocks)\n`,
  );

  // 6. Scrape StakedWithProvider events
  console.log("Scraping StakedWithProvider events...");

  const stakingRegistryAddress = ethClient.getStakingRegistryAddress();
  console.log(`Staking Registry: ${stakingRegistryAddress}\n`);

  const mappings: MappedCoinbase[] = [];
  const attesterSet = new Set(
    attesterAddresses.map((addr) => addr.toLowerCase()),
  );

  try {
    // Fetch logs in chunks to avoid RPC limits
    const CHUNK_SIZE = 10000n;
    let fromBlock = startBlock;

    while (fromBlock < currentBlock) {
      const toBlock =
        fromBlock + CHUNK_SIZE > currentBlock
          ? currentBlock
          : fromBlock + CHUNK_SIZE;

      console.log(`  Fetching logs: ${fromBlock} to ${toBlock}...`);

      const logs = await client.getLogs({
        address: stakingRegistryAddress,
        event: STAKED_WITH_PROVIDER_EVENT,
        args: {
          providerIdentifier: providerId,
        },
        fromBlock,
        toBlock,
      });

      console.log(`  Found ${logs.length} StakedWithProvider event(s)`);

      for (const log of logs) {
        const attester = log.args.attester!;
        const coinbase = log.args.coinbaseSplitContractAddress!;

        // Only include attesters we're tracking
        if (attesterSet.has(attester.toLowerCase())) {
          // Get block details for timestamp
          const block = await client.getBlock({ blockNumber: log.blockNumber });

          mappings.push({
            attesterAddress: attester,
            coinbaseAddress: coinbase,
            blockNumber: log.blockNumber,
            blockHash: log.blockHash,
            timestamp: Number(block.timestamp),
          });

          console.log(`    ✅ ${attester} -> ${coinbase}`);
        }
      }

      fromBlock = toBlock + 1n;
    }
  } catch (error) {
    console.error("\n❌ Error scraping events:", error);
    throw error;
  }

  console.log(`\n✅ Found ${mappings.length} coinbase mapping(s)`);

  // 7. Check for missing attesters
  const mappedAttesters = new Set(
    mappings.map((m) => m.attesterAddress.toLowerCase()),
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

  // 8. Validate against existing cache
  console.log("\nValidating against existing cache...");
  const existingCache = await loadCoinbaseCache(options.network);

  if (existingCache) {
    console.log("  Existing cache found, checking for mismatches...");
    let mismatchCount = 0;

    for (const mapping of mappings) {
      const existing = existingCache.mappings.find(
        (m) =>
          m.attesterAddress.toLowerCase() ===
          mapping.attesterAddress.toLowerCase(),
      );

      if (
        existing &&
        existing.coinbaseAddress.toLowerCase() !==
          mapping.coinbaseAddress.toLowerCase()
      ) {
        console.error(
          `\n❌ FATAL: Coinbase mismatch for ${mapping.attesterAddress}!`,
        );
        console.error(`  Cached:  ${existing.coinbaseAddress}`);
        console.error(`  Scraped: ${mapping.coinbaseAddress}`);
        mismatchCount++;
      }
    }

    if (mismatchCount > 0) {
      throw new Error(
        `Found ${mismatchCount} coinbase mismatch(es). This indicates a serious problem!`,
      );
    }

    console.log("  ✅ No mismatches found");
  } else {
    console.log("  No existing cache found");
  }

  // 9. Save cache
  const cache: CoinbaseMappingCache = {
    network: options.network,
    stakingProviderId: providerId,
    lastScrapedBlock: currentBlock,
    mappings,
    scrapedAt: new Date().toISOString(),
    version: "1.0",
  };

  console.log("\nSaving coinbase cache...");
  const outputPath = await saveCoinbaseCache(cache, options.outputPath);

  console.log(`\n✅ Coinbase cache saved: ${outputPath}`);
  console.log(`\nSummary:`);
  console.log(`  Network: ${options.network}`);
  console.log(`  Provider ID: ${providerId}`);
  console.log(`  Start block: ${startBlock}`);
  console.log(`  End block: ${currentBlock}`);
  console.log(`  Blocks scraped: ${currentBlock - startBlock}`);
  console.log(`  Coinbase mappings: ${mappings.length}`);
  console.log(`  Missing mappings: ${missingAttesters.length}`);
  console.log(
    `\nYou can now use this cache when generating scraper config with generate-scraper-config command.`,
  );
};

export default command;
