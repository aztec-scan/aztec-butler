import assert from "assert";
import type { EthereumClient } from "../../core/components/EthereumClient.js";
import type { ButlerConfig } from "../../core/config/index.js";
import {
  extractPublisherAddresses,
  extractAttesterCoinbasePairs,
} from "../../core/utils/keystoreOperations.js";
import {
  saveScraperConfig,
  getCachedCoinbase,
} from "../../core/utils/scraperConfigOperations.js";
import type {
  ScraperConfig,
  ScraperAttester,
  ScraperPublisher,
} from "../../types/scraper-config.js";

interface GenerateScraperConfigOptions {
  network: string;
  l1ChainId: number;
  keystorePaths: string[];
  outputPath?: string;
  includeZeroCoinbases?: boolean;
}

const command = async (
  ethClient: EthereumClient,
  config: ButlerConfig,
  options: GenerateScraperConfigOptions,
) => {
  console.log("\n=== Generating Scraper Configuration ===\n");

  assert(
    config.PROVIDER_ADMIN_ADDRESS,
    "PROVIDER_ADMIN_ADDRESS must be configured",
  );

  // 1. Load keystores from provided paths
  console.log(`Loading ${options.keystorePaths.length} keystore file(s)...`);
  const { loadKeystoresFromPaths } = await import(
    "../../core/utils/keystoreOperations.js"
  );
  const keystores = await loadKeystoresFromPaths(options.keystorePaths);
  console.log(`✅ Loaded ${keystores.length} keystore file(s)`);

  // 2. Extract attester addresses with coinbases
  console.log("\nExtracting attester addresses...");
  const attesterPairs = extractAttesterCoinbasePairs(keystores);
  console.log(`✅ Found ${attesterPairs.length} attester(s)`);

  // 3. Load cached coinbase mappings if available
  console.log("\nChecking for cached coinbase mappings...");
  const attesters: ScraperAttester[] = [];
  for (const pair of attesterPairs) {
    let coinbase = pair.coinbase;

    // Try to load from cache if current is zero address
    if (coinbase === "0x0000000000000000000000000000000000000000") {
      const cached = await getCachedCoinbase(options.network, pair.address);
      if (cached) {
        coinbase = cached.coinbaseAddress;
        console.log(
          `  ✅ Loaded cached coinbase for ${pair.address}: ${coinbase}`,
        );
      } else {
        console.log(
          `  ⚠️  No coinbase found for ${pair.address} (using 0x0...0)`,
        );
      }
    }

    // Skip zero coinbases if not included
    if (
      !options.includeZeroCoinbases &&
      coinbase === "0x0000000000000000000000000000000000000000"
    ) {
      console.log(
        `  ⏭️  Skipping ${pair.address} (zero coinbase, use --include-zero-coinbases to include)`,
      );
      continue;
    }

    attesters.push({
      address: pair.address,
      coinbase: coinbase,
    });
  }

  console.log(`\n✅ Including ${attesters.length} attester(s) in config`);

  // 4. Extract publisher addresses
  console.log("\nExtracting publisher addresses...");
  const publisherAddresses = extractPublisherAddresses(keystores);
  const publishers: ScraperPublisher[] = publisherAddresses.map((addr) => ({
    address: addr,
  }));
  console.log(`✅ Found ${publishers.length} unique publisher(s)`);

  // 5. Query staking provider ID from chain
  console.log("\nQuerying staking provider from chain...");
  const providerData = await ethClient.getStakingProvider(
    config.PROVIDER_ADMIN_ADDRESS,
  );

  if (!providerData) {
    throw new Error(
      `Staking provider not found for admin address: ${config.PROVIDER_ADMIN_ADDRESS}\n` +
        `Please ensure the staking provider is registered on-chain.`,
    );
  }

  console.log(`✅ Staking provider ID: ${providerData.providerId}`);
  console.log(`   Admin: ${providerData.admin}`);
  console.log(`   Take Rate: ${providerData.takeRate}`);

  // 6. Generate config
  const scraperConfig: ScraperConfig = {
    network: options.network,
    l1ChainId: options.l1ChainId as 1 | 11155111,
    stakingProviderId: providerData.providerId,
    stakingProviderAdmin: config.PROVIDER_ADMIN_ADDRESS,
    attesters,
    publishers,
    lastUpdated: new Date().toISOString(),
    version: "1.0",
  };

  // 7. Validate and save
  console.log("\nSaving scraper configuration...");
  const outputPath = await saveScraperConfig(scraperConfig, options.outputPath);

  console.log(`\n✅ Scraper config generated: ${outputPath}`);
  console.log(`\nSummary:`);
  console.log(`  Network: ${options.network}`);
  console.log(`  Staking Provider ID: ${providerData.providerId}`);
  console.log(`  Attesters: ${attesters.length}`);
  console.log(`  Publishers: ${publishers.length}`);
  console.log(`\nYou can now copy this file to your monitoring server.`);
};

export default command;
