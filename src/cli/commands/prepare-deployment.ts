import assert from "assert";
import fs from "fs/promises";
import path from "path";
import { formatEther } from "viem";
import type { EthereumClient } from "../../core/components/EthereumClient.js";
import type { ButlerConfig } from "../../core/config/index.js";

interface PrepareDeploymentOptions {
  productionKeys: string;
  newPublicKeys: string;
  availablePublishers: string;
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

  // 6. Generate output file(s)
  console.log("\nGenerating output file(s)...");

  const outputBasePath =
    options.outputPath || path.basename(options.productionKeys);
  const outputDir = path.dirname(options.outputPath || options.productionKeys);

  // Helper function to find highest existing version for a server
  const findHighestVersion = async (
    baseWithoutExt: string,
    serverId: string,
    dir: string,
  ): Promise<number> => {
    const files = await fs.readdir(dir).catch(() => []);

    let highestVersion = 0;
    const regex = new RegExp(
      `^${baseWithoutExt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}_${serverId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}_v(\\d+)\\.json$`,
    );

    for (const file of files) {
      const match = file.match(regex);
      if (match && match[1]) {
        const version = parseInt(match[1], 10);
        if (version > highestVersion) {
          highestVersion = version;
        }
      }
    }

    return highestVersion;
  };

  // Helper function to generate versioned filename
  const generateVersionedFilename = async (
    basePath: string,
    serverId: string,
    dir: string,
  ): Promise<string> => {
    // Remove .json extension if present
    const baseWithoutExt = basePath.endsWith(".json")
      ? basePath.slice(0, -5)
      : basePath;

    // Find highest existing version and increment
    const highestVersion = await findHighestVersion(
      baseWithoutExt,
      serverId,
      dir,
    );
    const nextVersion = highestVersion + 1;

    const filename = `${baseWithoutExt}_${serverId}_v${nextVersion}.json`;
    return path.join(dir, filename);
  };

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

  // Generate one file per server
  for (const serverId of serverIds) {
    const filePublishers = serverPublishers[serverId]!;

    if (filePublishers.length === 0) {
      console.warn(`⚠️  Skipping server ${serverId}: no publishers configured`);
      continue;
    }

    const outputPath = await generateVersionedFilename(
      outputBasePath,
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

  // Summary
  console.log("\n=== Summary ===");
  console.log(
    `Total validators: ${mergedValidators.length} (${productionData.validators.length} existing + ${newPublicKeysData.validators.length} new)`,
  );

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
  console.log("\n✅ Deployment preparation complete!");
};

export default command;
