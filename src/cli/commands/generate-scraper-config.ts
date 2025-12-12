import type { EthereumClient } from "../../core/components/EthereumClient.js";
import type { ButlerConfig } from "../../core/config/index.js";
import { extractAttesterDataWithPublisher } from "../../core/utils/keystoreOperations.js";
import {
  saveScraperConfig,
  getCachedCoinbase,
} from "../../core/utils/scraperConfigOperations.js";
import type {
  ScraperConfig,
  ScraperAttester,
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
  const uniquePublishers = new Set<string>();

  for (const data of attesterData) {
    let coinbase = data.coinbase;

    // Collect unique publishers
    uniquePublishers.add(data.publisher);

    // Try to load from cache if coinbase is not set
    if (!coinbase) {
      const cached = await getCachedCoinbase(options.network, data.address);
      if (cached) {
        coinbase = cached.coinbaseAddress;
        console.log(
          `  ✅ Loaded cached coinbase for ${data.address}: ${coinbase}`,
        );
      } else {
        // Don't set coinbase if not found
        console.log(
          `  ⚠️  No coinbase found for ${data.address}, omitting from config`,
        );
      }
    }

    const attester: ScraperAttester = {
      address: data.address,
    };

    // Only add coinbase if it exists and is not zero address
    if (coinbase && coinbase !== ZERO_ADDRESS) {
      attester.coinbase = coinbase;
    }

    attesters.push(attester);
  }

  console.log(`\n✅ Including ${attesters.length} attester(s) in config`);

  // 4. Query staking provider ID from chain (or use provided ID)
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

  // 5. Generate config
  const scraperConfig: ScraperConfig = {
    network: options.network,
    l1ChainId: options.l1ChainId as 1 | 11155111,
    stakingProviderId: providerData.providerId,
    stakingProviderAdmin: stakingProviderAdmin || "unknown",
    attesters,
    publishers: Array.from(uniquePublishers),
    lastUpdated: new Date().toISOString(),
    version: "1.1",
  };

  // 6. Validate and save
  console.log("\nSaving scraper configuration...");
  const outputPath = await saveScraperConfig(scraperConfig, options.outputPath);

  console.log(`\n✅ Scraper config generated: ${outputPath}`);
  console.log(`\nSummary:`);
  console.log(`  Network: options.network}`);
  console.log(`  Staking Provider ID: ${providerData.providerId}`);
  console.log(`  Attesters: ${attesters.length}`);
  console.log(`  Publishers: ${uniquePublishers.size}`);
  console.log(`\nYou can now copy this file to your monitoring server.`);
};

export default command;
