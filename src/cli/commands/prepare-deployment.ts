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

interface ServerPublishers {
  [server: string]: string[]; // e.g., { A: [...], B: [...] }
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

  let serverPublishers: ServerPublishers;
  try {
    const content = await fs.readFile(options.availablePublishers, "utf-8");
    serverPublishers = JSON.parse(content);
  } catch (error) {
    throw new Error(
      `Failed to load available publishers file: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Validate structure
  if (
    typeof serverPublishers !== "object" ||
    Array.isArray(serverPublishers) ||
    serverPublishers === null
  ) {
    throw new Error(
      "Invalid available publishers file: must be a JSON object with server keys (e.g., {A: [], B: []})",
    );
  }

  // Validate all values are arrays
  for (const [server, publishers] of Object.entries(serverPublishers)) {
    if (!Array.isArray(publishers)) {
      throw new Error(
        `Invalid available publishers file: server "${server}" must have an array of addresses`,
      );
    }
  }

  console.log(
    `✅ Loaded publishers for server(s): ${Object.keys(serverPublishers).join(", ")}`,
  );

  // Validate no publisher addresses are shared between servers
  console.log("\nValidating publisher assignments across servers...");

  const publisherToServers = new Map<string, string[]>();

  for (const [server, publishers] of Object.entries(serverPublishers)) {
    for (const publisher of publishers) {
      const normalizedAddr = publisher.toLowerCase();
      if (!publisherToServers.has(normalizedAddr)) {
        publisherToServers.set(normalizedAddr, []);
      }
      publisherToServers.get(normalizedAddr)!.push(server);
    }
  }

  const sharedPublishers = Array.from(publisherToServers.entries())
    .filter(([, servers]) => servers.length > 1)
    .map(([addr, servers]) => ({ address: addr, servers }));

  if (sharedPublishers.length > 0) {
    const errorMsg = sharedPublishers
      .map(
        ({ address, servers }) =>
          `  - ${address} appears in servers: ${servers.join(", ")}`,
      )
      .join("\n");

    throw new Error(
      `FATAL: Publisher addresses cannot be shared between servers:\n${errorMsg}\n\n` +
        `Each server must have its own unique set of publisher addresses.`,
    );
  }

  console.log("✅ No publisher addresses shared between servers");

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

  // Collect all unique publishers across all servers
  const allPublishers = new Set<string>();
  for (const publishers of Object.values(serverPublishers)) {
    for (const addr of publishers) {
      allPublishers.add(addr);
    }
  }

  for (const publisherAddr of allPublishers) {
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

    const prefixes = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").slice(0, haCount);
    const availableServers = Object.keys(serverPublishers).filter(
      (key) => serverPublishers[key]!.length > 0,
    );

    if (availableServers.length < haCount) {
      throw new Error(
        `FATAL: Not enough servers configured for high availability.\n` +
          `Need ${haCount} servers (${prefixes.join(", ")}) but only have ${availableServers.length} configured: ${availableServers.join(", ")}`,
      );
    }

    console.log(
      `✅ Sufficient servers configured for ${haCount}-way high availability`,
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
    // Single file output - use server "A"
    if (!serverPublishers.A) {
      throw new Error(
        `FATAL: Server "A" not found in available publishers file.\n` +
          `When running without high availability, publishers for server "A" are required.`,
      );
    }

    const availablePublishers = serverPublishers.A;

    if (availablePublishers.length === 0) {
      throw new Error(
        `FATAL: Server "A" has no publisher addresses.\n` +
          `At least one publisher address is required for server "A".`,
      );
    }

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

    console.log(
      `✅ Using ${availablePublishers.length} publisher(s) from server A`,
    );
  } else {
    // High availability mode - use specified server keys
    const prefixes = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").slice(0, haCount);

    // Validate all required servers have publishers
    const missingServers = prefixes.filter(
      (server) =>
        !serverPublishers[server] || serverPublishers[server].length === 0,
    );

    if (missingServers.length > 0) {
      throw new Error(
        `FATAL: Missing or empty publisher arrays for server(s): ${missingServers.join(", ")}\n` +
          `High availability count of ${haCount} requires publishers for servers: ${prefixes.join(", ")}`,
      );
    }

    for (let i = 0; i < haCount; i++) {
      const prefix = prefixes[i]!;
      const filePublishers = serverPublishers[prefix]!;

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

      console.log(
        `  ${outputFilename}: ${filePublishers.length} publisher(s) from server ${prefix}`,
      );
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
      publishers: [],
      lastUpdated: new Date().toISOString(),
      version: "1.1",
    };
  }

  // Use publishers from the first/A file
  const firstFileValidators = outputFiles[0]!.data.validators;

  // Collect unique publishers from the first file
  const uniquePublishers = new Set<string>();
  for (const validator of firstFileValidators) {
    if (validator.publisher) {
      uniquePublishers.add(validator.publisher as string);
    }
  }

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
  scraperConfig.publishers = Array.from(uniquePublishers);
  scraperConfig.lastUpdated = new Date().toISOString();
  scraperConfig.version = "1.1";

  const savedPath = await saveScraperConfig(scraperConfig);
  console.log(`✅ Updated scraper config: ${savedPath}`);

  // Summary
  console.log("\n=== Summary ===");
  console.log(
    `Total validators: ${mergedValidators.length} (${productionData.validators.length} existing + ${newPublicKeysData.validators.length} new)`,
  );

  // Show publishers per server
  console.log(`Servers configured:`);
  for (const [server, publishers] of Object.entries(serverPublishers)) {
    console.log(`  - Server ${server}: ${publishers.length} publisher(s)`);
  }

  console.log(`Output files: ${outputFiles.length}`);
  for (const { filename } of outputFiles) {
    console.log(`  - ${filename}`);
  }
  console.log(`Scraper config: ${savedPath}`);
  console.log("\n✅ Deployment preparation complete!");
};

export default command;
