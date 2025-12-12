import assert from "assert";
import fs from "fs/promises";
import path from "path";
import { formatEther } from "viem";
import type { EthereumClient } from "../../core/components/EthereumClient.js";
import type { ButlerConfig } from "../../core/config/index.js";
import {
  loadScraperConfig,
  saveScraperConfig,
} from "../../core/utils/scraperConfigOperations.js";
import type { ScraperConfig, ScraperAttester } from "../../types/index.js";

interface PrepareDeploymentOptions {
  productionKeys: string;
  newPublicKeys: string;
  availablePublishers: string;
  highAvailabilityCount?: number;
  outputPath?: string;
  network: string;
}

interface KeystoreValidator {
  attester: {
    eth: string;
    bls: string;
  };
  publisher?: string | string[];
  coinbase?: string;
  feeRecipient: string;
}

interface KeystoreFile {
  schemaVersion?: number;
  remoteSigner?: string;
  validators: KeystoreValidator[];
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const command = async (
  ethClient: EthereumClient,
  config: ButlerConfig,
  options: PrepareDeploymentOptions,
) => {
  console.log("\n=== Prepare Deployment ===\n");

  // 1. Load and validate input files
  console.log("Loading input files...");

  let productionData: KeystoreFile;
  try {
    const content = await fs.readFile(options.productionKeys, "utf-8");
    productionData = JSON.parse(content);
  } catch (error) {
    throw new Error(
      `Failed to load production keys file: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!productionData.validators || !Array.isArray(productionData.validators)) {
    throw new Error(
      "Invalid production keys file: must contain a 'validators' array",
    );
  }

  if (!productionData.remoteSigner) {
    throw new Error(
      "Invalid production keys file: must contain 'remoteSigner' field",
    );
  }

  console.log(
    `✅ Loaded ${productionData.validators.length} existing validator(s) from production keys`,
  );

  let newPublicKeysData: KeystoreFile;
  try {
    const content = await fs.readFile(options.newPublicKeys, "utf-8");
    newPublicKeysData = JSON.parse(content);
  } catch (error) {
    throw new Error(
      `Failed to load new public keys file: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (
    !newPublicKeysData.validators ||
    !Array.isArray(newPublicKeysData.validators)
  ) {
    throw new Error(
      "Invalid new public keys file: must contain a 'validators' array",
    );
  }

  console.log(
    `✅ Loaded ${newPublicKeysData.validators.length} new validator(s) from public keys file`,
  );

  let availablePublishers: string[];
  try {
    const content = await fs.readFile(options.availablePublishers, "utf-8");
    availablePublishers = JSON.parse(content);
  } catch (error) {
    throw new Error(
      `Failed to load available publishers file: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!Array.isArray(availablePublishers)) {
    throw new Error(
      "Invalid available publishers file: must be a JSON array of addresses",
    );
  }

  console.log(`✅ Loaded ${availablePublishers.length} publisher address(es)`);

  // 2. Duplicate check
  console.log("\nChecking for duplicate attesters...");

  const allAttesterAddresses = [
    ...productionData.validators.map((v) => v.attester.eth.toLowerCase()),
    ...newPublicKeysData.validators.map((v) => v.attester.eth.toLowerCase()),
  ];

  const addressCounts = new Map<string, number>();
  for (const addr of allAttesterAddresses) {
    addressCounts.set(addr, (addressCounts.get(addr) || 0) + 1);
  }

  const duplicates = Array.from(addressCounts.entries())
    .filter(([, count]) => count > 1)
    .map(([addr]) => addr);

  if (duplicates.length > 0) {
    throw new Error(
      `FATAL: Found duplicate attester addresses:\n${duplicates.map((addr) => `  - ${addr}`).join("\n")}`,
    );
  }

  console.log("✅ No duplicate attesters found");

  // 3. Coinbase validation
  console.log("\nValidating coinbase addresses...");

  const zeroCoinbases: string[] = [];

  for (const validator of [
    ...productionData.validators,
    ...newPublicKeysData.validators,
  ]) {
    if (validator.coinbase === ZERO_ADDRESS) {
      zeroCoinbases.push(validator.attester.eth);
    }
  }

  if (zeroCoinbases.length > 0) {
    throw new Error(
      `FATAL: Found validators with zero-address coinbase:\n${zeroCoinbases.map((addr) => `  - ${addr}`).join("\n")}`,
    );
  }

  console.log("✅ No zero-address coinbases found");

  // 4. Publisher funding check
  console.log("\nChecking publisher funding...");

  const minEthPerAttester = BigInt(
    Math.floor(parseFloat(config.MIN_ETH_PER_ATTESTER) * 1e18),
  );

  const publicClient = ethClient.getPublicClient();

  for (const publisherAddr of availablePublishers) {
    const balance = await publicClient.getBalance({
      address: publisherAddr as `0x${string}`,
    });
    const balanceEth = formatEther(balance);

    if (balance === 0n) {
      throw new Error(`FATAL: Publisher ${publisherAddr} has 0 ETH balance!`);
    }

    if (balance < minEthPerAttester) {
      console.warn(
        `⚠️  Publisher ${publisherAddr} has low balance: ${balanceEth} ETH (min: ${config.MIN_ETH_PER_ATTESTER} ETH)`,
      );
    } else {
      console.log(`  ${publisherAddr}: ${balanceEth} ETH ✅`);
    }
  }

  console.log("✅ All publishers have ETH");

  // 5. High availability validation
  const haCount = options.highAvailabilityCount || 1;

  if (haCount > 1) {
    console.log(`\nValidating high availability setup (count: ${haCount})...`);

    if (availablePublishers.length < haCount) {
      throw new Error(
        `FATAL: Not enough publishers for high availability.\n` +
          `Need ${haCount} publishers but only have ${availablePublishers.length}`,
      );
    }

    console.log(
      `✅ Sufficient publishers for ${haCount}-way high availability`,
    );
  }

  // 6. Generate output file(s)
  console.log("\nGenerating output file(s)...");

  const outputBasePath =
    options.outputPath || path.basename(options.productionKeys);
  const outputDir = path.dirname(options.outputPath || options.productionKeys);

  // Merge all validators (without publishers yet)
  const mergedValidators: KeystoreValidator[] = [
    ...productionData.validators.map((v) => ({
      attester: v.attester,
      coinbase: v.coinbase,
      feeRecipient: v.feeRecipient,
    })),
    ...newPublicKeysData.validators.map((v) => ({
      attester: v.attester,
      feeRecipient: v.feeRecipient,
      // No coinbase for new validators
    })),
  ];

  // Function to assign publishers using round-robin
  const assignPublishers = (
    validators: KeystoreValidator[],
    publishers: string[],
  ): KeystoreValidator[] => {
    return validators.map((v, i) => ({
      ...v,
      publisher: publishers[i % publishers.length]!,
    }));
  };

  const outputFiles: { filename: string; data: KeystoreFile }[] = [];

  if (haCount === 1) {
    // Single file output
    let outputFilename = `${outputBasePath}.new`;
    let outputPath = path.join(outputDir, outputFilename);

    // Check if .new exists, create .new2 instead
    try {
      await fs.access(outputPath);
      outputFilename = `${outputBasePath}.new2`;
      outputPath = path.join(outputDir, outputFilename);
      console.log(`  .new file exists, creating ${outputFilename} instead`);
    } catch {
      // File doesn't exist, use .new
    }

    const validatorsWithPublishers = assignPublishers(
      mergedValidators,
      availablePublishers,
    );

    outputFiles.push({
      filename: outputPath,
      data: {
        schemaVersion: productionData.schemaVersion || 1,
        remoteSigner: productionData.remoteSigner,
        validators: validatorsWithPublishers,
      },
    });
  } else {
    // High availability mode - multiple files with non-overlapping publishers
    const publishersPerFile = Math.floor(availablePublishers.length / haCount);
    const prefixes = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

    for (let i = 0; i < haCount; i++) {
      const prefix = prefixes[i];
      const startIdx = i * publishersPerFile;
      const endIdx =
        i === haCount - 1
          ? availablePublishers.length
          : (i + 1) * publishersPerFile;
      const filePublishers = availablePublishers.slice(startIdx, endIdx);

      const outputFilename = `${prefix}_${outputBasePath}.new`;
      const outputPath = path.join(outputDir, outputFilename);

      const validatorsWithPublishers = assignPublishers(
        mergedValidators,
        filePublishers,
      );

      outputFiles.push({
        filename: outputPath,
        data: {
          schemaVersion: productionData.schemaVersion || 1,
          remoteSigner: productionData.remoteSigner,
          validators: validatorsWithPublishers,
        },
      });

      console.log(`  ${outputFilename}: ${filePublishers.length} publisher(s)`);
    }
  }

  // Write all output files
  for (const { filename, data } of outputFiles) {
    await fs.writeFile(filename, JSON.stringify(data, null, 2) + "\n");
    console.log(`✅ Created ${filename}`);
  }

  // 7. Update scraper config
  console.log("\nUpdating scraper config...");

  let scraperConfig: ScraperConfig;
  try {
    scraperConfig = await loadScraperConfig(options.network);
    console.log(`  Loaded existing scraper config for ${options.network}`);
  } catch (error) {
    // Create new config if it doesn't exist
    console.log(
      `  No existing scraper config found, creating new one for ${options.network}`,
    );

    assert(
      config.AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS,
      "Staking provider admin address must be provided",
    );

    const stakingProviderData = await ethClient.getStakingProvider(
      config.AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS,
    );

    if (!stakingProviderData) {
      throw new Error(
        `Staking provider not found for admin address: ${config.AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS}`,
      );
    }

    scraperConfig = {
      network: options.network,
      l1ChainId: config.ETHEREUM_CHAIN_ID as 1 | 11155111,
      stakingProviderId: stakingProviderData.providerId,
      stakingProviderAdmin: config.AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS,
      attesters: [],
      lastUpdated: new Date().toISOString(),
      version: "1.0",
    };
  }

  // Use publishers from the first/A file
  const firstFileValidators = outputFiles[0]!.data.validators;

  // Create a map of existing attesters for deduplication
  const existingAttestersMap = new Map<string, ScraperAttester>(
    scraperConfig.attesters.map((a) => [a.address.toLowerCase(), a]),
  );

  // Add/update attesters from the new validators
  for (const validator of firstFileValidators) {
    const attesterAddr = validator.attester.eth.toLowerCase();
    const existing = existingAttestersMap.get(attesterAddr);

    const newAttester: ScraperAttester = {
      address: validator.attester.eth,
      publisher: validator.publisher as string, // We know it's assigned at this point
      coinbase: validator.coinbase || ZERO_ADDRESS,
      lastSeenState: existing?.lastSeenState || "NEW",
    };

    // Prefer non-zero coinbase when merging
    if (
      existing &&
      existing.coinbase !== ZERO_ADDRESS &&
      newAttester.coinbase === ZERO_ADDRESS
    ) {
      newAttester.coinbase = existing.coinbase;
    }

    existingAttestersMap.set(attesterAddr, newAttester);
  }

  scraperConfig.attesters = Array.from(existingAttestersMap.values());
  scraperConfig.lastUpdated = new Date().toISOString();

  const savedPath = await saveScraperConfig(scraperConfig);
  console.log(`✅ Updated scraper config: ${savedPath}`);

  // Summary
  console.log("\n=== Summary ===");
  console.log(
    `Total validators: ${mergedValidators.length} (${productionData.validators.length} existing + ${newPublicKeysData.validators.length} new)`,
  );
  console.log(`Publishers: ${availablePublishers.length}`);
  console.log(`Output files: ${outputFiles.length}`);
  for (const { filename } of outputFiles) {
    console.log(`  - ${filename}`);
  }
  console.log(`Scraper config: ${savedPath}`);
  console.log("\n✅ Deployment preparation complete!");
};

export default command;
