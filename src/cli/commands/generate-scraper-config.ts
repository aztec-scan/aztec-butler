import type { EthereumClient } from "../../core/components/EthereumClient.js";
import type { ButlerConfig } from "../../core/config/index.js";
import {
  saveScraperConfig,
  loadScraperConfig,
  loadCoinbaseCache,
} from "../../core/utils/scraperConfigOperations.js";
import type {
  ScraperConfig,
  ScraperAttester,
} from "../../types/scraper-config.js";

interface GenerateScraperConfigOptions {
  network: string;
  l1ChainId: number;
  prodKeyfile?: string;
  outputPath?: string;
  providerId?: bigint;
}

interface ProdKeyfileValidator {
  attester: {
    eth: string;
    bls: string;
  };
  publisher?: string;
  coinbase?: string;
  feeRecipient: string;
}

interface ProdKeyfile {
  validators: ProdKeyfileValidator[];
  remoteSigner?: string;
}

const command = async (
  ethClient: EthereumClient,
  config: ButlerConfig,
  options: GenerateScraperConfigOptions,
) => {
  console.log("\n=== Generating Scraper Configuration ===\n");

  const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

  // Load or create scraper config
  let scraperConfig: ScraperConfig;
  let isNewConfig = false;

  try {
    scraperConfig = await loadScraperConfig(options.network);
    console.log(
      `✅ Loaded existing scraper config for network: ${scraperConfig.network}`,
    );
    console.log(`✅ Provider ID: ${scraperConfig.stakingProviderId}`);
    console.log(
      `✅ Found ${scraperConfig.attesters.length} existing attester(s)`,
    );
  } catch (error) {
    // Create new config if it doesn't exist
    console.log(`Creating new scraper config for network: ${options.network}`);
    isNewConfig = true;

    // Query staking provider ID from chain (or use provided ID)
    let providerData;
    if (options.providerId !== undefined) {
      console.log(`✅ Using Provider ID: ${options.providerId}`);
      providerData = {
        providerId: options.providerId,
        admin: config.AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS || "unknown",
      };
    } else {
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
      console.log(`✅ Staking provider ID: ${providerData.providerId}`);
      console.log(`   Admin: ${providerData.admin}`);
    }

    scraperConfig = {
      network: options.network,
      l1ChainId: options.l1ChainId as 1 | 11155111,
      stakingProviderId: providerData.providerId,
      stakingProviderAdmin:
        config.AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS || providerData.admin,
      attesters: [],
      publishers: [],
      lastUpdated: new Date().toISOString(),
      version: "1.1",
    };
  }

  // Create a map of existing attesters for merging
  const existingAttestersMap = new Map<string, ScraperAttester>(
    scraperConfig.attesters.map((a) => [a.address.toLowerCase(), a]),
  );

  // Load coinbase cache (optional)
  console.log("\nLoading cached coinbase mappings...");
  const coinbaseCache = await loadCoinbaseCache(options.network);

  const coinbaseMap = new Map<string, string>();
  if (coinbaseCache) {
    console.log(
      `✅ Loaded ${coinbaseCache.mappings.length} coinbase mapping(s)`,
    );
    for (const mapping of coinbaseCache.mappings) {
      coinbaseMap.set(
        mapping.attesterAddress.toLowerCase(),
        mapping.coinbaseAddress,
      );
    }
  } else {
    console.log("⚠️  No coinbase cache found");
  }

  // Update existing attesters with coinbase mappings from cache
  if (coinbaseCache) {
    console.log("\nUpdating existing attesters with cached coinbases...");
    let updatedCount = 0;
    let newCoinbaseCount = 0;

    for (const [address, attester] of existingAttestersMap) {
      const cachedCoinbase = coinbaseMap.get(address);

      if (cachedCoinbase && cachedCoinbase !== ZERO_ADDRESS) {
        if (!attester.coinbase) {
          newCoinbaseCount++;
          console.log(
            `  ✅ New coinbase for ${attester.address}: ${cachedCoinbase}`,
          );

          // Set lastSeenState to IN_STAKING_QUEUE for attesters with coinbase
          if (!attester.lastSeenState) {
            attester.lastSeenState = "IN_STAKING_QUEUE";
          }
        } else if (attester.coinbase !== cachedCoinbase) {
          updatedCount++;
          console.log(
            `  🔄 Updated coinbase for ${attester.address}: ${attester.coinbase} → ${cachedCoinbase}`,
          );
        }
        attester.coinbase = cachedCoinbase;
      }

      // Ensure lastSeenState is set (default to NEW if not set)
      if (!attester.lastSeenState) {
        attester.lastSeenState = attester.coinbase ? "IN_STAKING_QUEUE" : "NEW";
      }
    }

    if (newCoinbaseCount > 0 || updatedCount > 0) {
      console.log(
        `  Summary: ${newCoinbaseCount} new coinbase(s), ${updatedCount} updated`,
      );
    }
  }

  // Load and merge production keyfile if provided
  if (options.prodKeyfile) {
    console.log(`\nLoading production keyfile from: ${options.prodKeyfile}`);
    const fs = await import("fs/promises");
    let prodData: ProdKeyfile;

    try {
      const content = await fs.readFile(options.prodKeyfile, "utf-8");
      prodData = JSON.parse(content);
    } catch (error) {
      throw new Error(
        `Failed to load production keyfile: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (!prodData.validators || !Array.isArray(prodData.validators)) {
      throw new Error(
        "Invalid production keyfile: must contain a 'validators' array",
      );
    }

    console.log(
      `✅ Loaded ${prodData.validators.length} validator(s) from production keyfile`,
    );

    // Merge/add attesters from production keyfile
    console.log("\nMerging attesters from production keyfile...");
    let addedCount = 0;
    let skippedCount = 0;
    const uniquePublishers = new Set<string>(scraperConfig.publishers);

    for (const validator of prodData.validators) {
      const attesterAddr = validator.attester.eth;
      const attesterAddrLower = attesterAddr.toLowerCase();

      // Collect unique publishers
      if (validator.publisher) {
        uniquePublishers.add(validator.publisher);
      }

      // Check if attester already exists
      const existing = existingAttestersMap.get(attesterAddrLower);

      if (existing) {
        skippedCount++;
        // Keep existing attester (already has up-to-date coinbase from cache)
        continue;
      }

      // Add new attester
      addedCount++;

      // Determine coinbase (prefer cache, fallback to keyfile)
      const cachedCoinbase = coinbaseMap.get(attesterAddrLower);
      const coinbase = cachedCoinbase || validator.coinbase;

      const newAttester: ScraperAttester = {
        address: attesterAddr,
        lastSeenState: "NEW", // Default for new attesters
      };

      // Only add coinbase if it exists and is not zero address
      if (coinbase && coinbase !== ZERO_ADDRESS) {
        newAttester.coinbase = coinbase;
        // Update lastSeenState to IN_STAKING_QUEUE if has coinbase
        newAttester.lastSeenState = "IN_STAKING_QUEUE";
      }

      existingAttestersMap.set(attesterAddrLower, newAttester);
      console.log(
        `  ✅ Added ${attesterAddr} (state: ${newAttester.lastSeenState})`,
      );
    }

    console.log(
      `  Summary: ${addedCount} added, ${skippedCount} already exist (no duplicates)`,
    );

    // Update publishers
    scraperConfig.publishers = Array.from(uniquePublishers);
  }

  // Update scraper config
  scraperConfig.attesters = Array.from(existingAttestersMap.values());
  scraperConfig.lastUpdated = new Date().toISOString();
  scraperConfig.version = "1.1";

  // Save config
  console.log("\nSaving scraper configuration...");
  const outputPath = await saveScraperConfig(scraperConfig, options.outputPath);

  console.log(
    `\n✅ Scraper config ${isNewConfig ? "created" : "updated"}: ${outputPath}`,
  );
  console.log(`\nSummary:`);
  console.log(`  Network: ${options.network}`);
  console.log(`  Staking Provider ID: ${scraperConfig.stakingProviderId}`);
  console.log(`  Attesters: ${scraperConfig.attesters.length}`);
  console.log(`  Publishers: ${scraperConfig.publishers.length}`);

  // Show state breakdown
  const stateBreakdown = new Map<string, number>();
  for (const attester of scraperConfig.attesters) {
    const state = attester.lastSeenState || "UNKNOWN";
    stateBreakdown.set(state, (stateBreakdown.get(state) || 0) + 1);
  }

  console.log(`\nAttester states:`);
  for (const [state, count] of stateBreakdown) {
    console.log(`  ${state}: ${count}`);
  }

  console.log(`\nYou can now copy this file to your monitoring server.`);
};

export default command;
