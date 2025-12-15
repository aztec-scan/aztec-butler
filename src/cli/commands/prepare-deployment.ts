import fs from "fs/promises";
import path from "path";
import { formatEther } from "viem";
import type { EthereumClient } from "../../core/components/EthereumClient.js";
import type { ButlerConfig } from "../../core/config/index.js";
import type { Keystore, KeystoreValidator } from "../../types/keystore.js";
import { generateVersionedFilename } from "../../core/utils/keysFileOperations.js";
import { loadCoinbaseCache } from "../../core/utils/scraperConfigOperations.js";

interface PrepareDeploymentOptions {
  productionKeys: string;
  newPublicKeys: string;
  availablePublishers: string;
  outputPath?: string;
  network: string;
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

  let productionData: Keystore;
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

  let newPublicKeysData: Keystore;
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

  // 5. Server detection
  console.log("\nDetecting servers from available publishers...");

  const serverIds = Object.keys(serverPublishers).filter(
    (key) => serverPublishers[key]!.length > 0,
  );

  if (serverIds.length === 0) {
    throw new Error(
      `FATAL: No servers with publishers found in available publishers file.\n` +
        `At least one server with publisher addresses is required.`,
    );
  }

  console.log(
    `✅ Found ${serverIds.length} server(s): ${serverIds.join(", ")}`,
  );

  // 6. Load coinbase cache (optional)
  console.log("\nLoading coinbase cache...");

  const coinbaseMap = new Map<string, string>();
  try {
    const coinbaseCache = await loadCoinbaseCache(options.network);
    if (coinbaseCache) {
      for (const mapping of coinbaseCache.mappings) {
        coinbaseMap.set(
          mapping.attesterAddress.toLowerCase(),
          mapping.coinbaseAddress,
        );
      }
      console.log(
        `✅ Loaded ${coinbaseMap.size} coinbase mapping(s) from cache`,
      );
    }
  } catch (error) {
    console.warn(
      `⚠️  No coinbase cache found for network "${options.network}". Validators will be created without coinbase addresses.`,
    );
    console.warn(
      `   Run 'aztec-butler scrape-coinbases --network ${options.network}' to create the cache, then use 'fill-coinbases' to add them.`,
    );
  }

  // 7. Generate output file(s)
  console.log("\nGenerating output file(s)...");

  const outputDir = path.dirname(options.outputPath || options.productionKeys);

  // Merge all validators (without publishers yet)
  // Helper to create validator entry with optional coinbase
  const createValidatorEntry = (
    attester: { eth: string; bls: string },
    feeRecipient: string,
    existingCoinbase?: string,
  ): Omit<KeystoreValidator, "publisher"> => {
    const entry: Omit<KeystoreValidator, "publisher"> = {
      attester,
      feeRecipient,
    };

    // Use existing coinbase from production, or lookup in cache
    const coinbase =
      existingCoinbase || coinbaseMap.get(attester.eth.toLowerCase());
    if (coinbase) {
      entry.coinbase = coinbase;
    }

    return entry;
  };

  const mergedValidators: Omit<KeystoreValidator, "publisher">[] = [
    ...productionData.validators.map((v) =>
      createValidatorEntry(v.attester, v.feeRecipient, v.coinbase),
    ),
    ...newPublicKeysData.validators.map((v) =>
      createValidatorEntry(v.attester, v.feeRecipient),
    ),
  ];

  // Function to assign publishers using round-robin
  const assignPublishers = (
    validators: Omit<KeystoreValidator, "publisher">[],
    publishers: string[],
  ): KeystoreValidator[] => {
    return validators.map((v, i) => ({
      ...v,
      publisher: publishers[i % publishers.length]!,
    }));
  };

  const outputFiles: { filename: string; data: Keystore }[] = [];

  // Generate one file per server
  for (const serverId of serverIds) {
    const filePublishers = serverPublishers[serverId]!;

    if (filePublishers.length === 0) {
      console.warn(`⚠️  Skipping server ${serverId}: no publishers configured`);
      continue;
    }

    const outputPath = await generateVersionedFilename(
      options.network,
      serverId,
      outputDir,
    );

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
      `  ${path.basename(outputPath)}: ${filePublishers.length} publisher(s) from server ${serverId}`,
    );
  }

  if (outputFiles.length === 0) {
    throw new Error(
      `FATAL: No output files generated. Ensure at least one server has publishers configured.`,
    );
  }

  // Write all output files
  for (const { filename, data } of outputFiles) {
    await fs.writeFile(filename, JSON.stringify(data, null, 2) + "\n");
    console.log(`✅ Created ${filename}`);
  }

  // Count validators with/without coinbase
  const validatorsWithCoinbase = mergedValidators.filter(
    (v) => v.coinbase,
  ).length;
  const validatorsWithoutCoinbase =
    mergedValidators.length - validatorsWithCoinbase;

  // Summary
  console.log("\n=== Summary ===");
  console.log(
    `Total validators: ${mergedValidators.length} (${productionData.validators.length} existing + ${newPublicKeysData.validators.length} new)`,
  );
  console.log(`Validators with coinbase: ${validatorsWithCoinbase}`);
  if (validatorsWithoutCoinbase > 0) {
    console.log(`Validators without coinbase: ${validatorsWithoutCoinbase}`);
  }

  // Show publishers per server
  console.log(`Servers detected: ${serverIds.length}`);
  for (const serverId of serverIds) {
    const publishers = serverPublishers[serverId]!;
    console.log(`  - Server ${serverId}: ${publishers.length} publisher(s)`);
  }

  console.log(`\nOutput files generated: ${outputFiles.length}`);
  for (const { filename } of outputFiles) {
    console.log(`  - ${path.basename(filename)}`);
  }

  if (validatorsWithoutCoinbase > 0) {
    console.log(
      `\n⚠️  Warning: ${validatorsWithoutCoinbase} validator(s) do not have coinbase addresses set.`,
    );
    console.log(`   To populate them:`);
    console.log(
      `   1. Run: aztec-butler scrape-coinbases --network ${options.network}`,
    );
    console.log(`   2. Then run fill-coinbases on each keys file:`);
    for (const { filename } of outputFiles) {
      console.log(
        `      aztec-butler fill-coinbases --network ${options.network} --keys-file ${path.basename(filename)}`,
      );
    }
  }

  console.log("\n✅ Deployment preparation complete!");
};

export default command;
