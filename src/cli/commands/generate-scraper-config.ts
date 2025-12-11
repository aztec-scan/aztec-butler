import type { EthereumClient } from "../../core/components/EthereumClient.js";
import type { ButlerConfig } from "../../core/config/index.js";
import {
  extractPublisherAddresses,
  extractAttesterDataWithPublisher,
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
  providerId?: bigint;
}

const command = async (
  ethClient: EthereumClient,
  config: ButlerConfig,
  options: GenerateScraperConfigOptions,
) => {
  console.log("\n=== Generating Scraper Configuration ===\n");

  // 1. Load keystores from provided paths
  console.log(`Loading ${options.keystorePaths.length} keystore file(s)...`);
  const { loadKeystoresFromPaths } = await import(
    "../../core/utils/keystoreOperations.js"
  );
  const keystores = await loadKeystoresFromPaths(options.keystorePaths);
  console.log(`✅ Loaded ${keystores.length} keystore file(s)`);

  // 2. Extract attester data with publisher mappings
  console.log("\nExtracting attester addresses...");
  const attesterData = extractAttesterDataWithPublisher(keystores);
  console.log(`✅ Found ${attesterData.length} attester(s)`);

  // 3. Load cached coinbase mappings if available
  console.log("\nChecking for cached coinbase mappings...");
  const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
  const attesters: ScraperAttester[] = [];

  for (const data of attesterData) {
    let coinbase = data.coinbase;

    // Try to load from cache if coinbase is not set
    if (!coinbase) {
      const cached = await getCachedCoinbase(options.network, data.address);
      if (cached) {
        coinbase = cached.coinbaseAddress;
        console.log(
          `  ✅ Loaded cached coinbase for ${data.address}: ${coinbase}`,
        );
      } else {
        // Use zero address if no coinbase found
        coinbase = ZERO_ADDRESS;
        console.log(
          `  ⚠️  No coinbase found for ${data.address}, using ${ZERO_ADDRESS}`,
        );
      }
    }

    attesters.push({
      address: data.address,
      coinbase: coinbase,
      publisher: data.publisher,
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

  // 5. Query staking provider ID from chain (or use provided ID)
  let providerData;
  let stakingProviderAdmin: string | undefined;

  if (options.providerId !== undefined) {
    console.log(`\n✅ Using Provider ID: ${options.providerId}`);
    providerData = {
      providerId: options.providerId,
      admin: config.AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS || "unknown",
      takeRate: 0,
      rewardsRecipient: "0x0000000000000000000000000000000000000000",
    };
    stakingProviderAdmin = config.AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS;
  } else {
    // Fall back to querying from AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS
    if (!config.AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS) {
      throw new Error(
        "Either --provider-id flag or AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS config must be set",
      );
    }

    console.log("\nQuerying staking provider from chain...");
    const queriedData = await ethClient.getStakingProvider(
      config.AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS,
    );

    if (!queriedData) {
      throw new Error(
        `Staking provider not found for admin address: ${config.AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS}\n` +
          `Please ensure the staking provider is registered on-chain.`,
      );
    }

    providerData = queriedData;
    stakingProviderAdmin = config.AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS;
    console.log(`✅ Staking provider ID: ${providerData.providerId}`);
    console.log(`   Admin: ${providerData.admin}`);
    console.log(`   Take Rate: ${providerData.takeRate}`);
  }

  // 6. Generate config
  const scraperConfig: ScraperConfig = {
    network: options.network,
    l1ChainId: options.l1ChainId as 1 | 11155111,
    stakingProviderId: providerData.providerId,
    stakingProviderAdmin: stakingProviderAdmin || "unknown",
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
