import fs from "fs/promises";
import path from "path";
import type { EthereumClient } from "../../core/components/EthereumClient.js";
import {
  CoinbaseScraper,
  CoinbaseScraperError,
} from "../../core/components/CoinbaseScraper.js";
import type { ButlerConfig } from "../../core/config/index.js";
import {
  getDataDir,
  loadAndMergeKeysFiles,
} from "../../core/utils/keysFileOperations.js";
import { KeystoreSchema, type Keystore } from "../../types/keystore.js";
import type { MappedCoinbase } from "../../types/scraper-config.js";

interface ScrapeCoinbasesOptions {
  network: string;
  fromBlock?: bigint;
  fullRescrape?: boolean;
  outputPath?: string;
  configPath?: string;
  keysFile?: string;
}

// Default deployment blocks for StakingRegistryContract
const DEFAULT_START_BLOCKS: Record<string, bigint> = {
  testnet: 9595580n, // Sepolia
  mainnet: 23786836n,
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const NATIVE_REGISTERED_KEYS_FILE = "native-registered-keys.json";

function resolveKeysFilePath(keysFile: string): string {
  return path.isAbsolute(keysFile)
    ? keysFile
    : path.join(getDataDir(), keysFile);
}

async function loadKeysFilePreservingOrder(filePath: string): Promise<Keystore> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const data: unknown = JSON.parse(content);

    // Validate the shape, but keep the original parsed object for writes.
    // KeystoreSchema.parse rebuilds objects in schema order, which would
    // unnecessarily reorder existing keys such as attester.eth/attester.bls.
    KeystoreSchema.parse(data);
    return data as Keystore;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Keys file not found: ${filePath}`);
    }
    throw new Error(
      `Failed to load keys file ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function loadAttesters(options: ScrapeCoinbasesOptions): Promise<{
  attesterAddresses: string[];
  filesLoaded: string[];
  targetKeysFilePath?: string;
  targetKeystore?: Keystore;
}> {
  if (options.keysFile) {
    const keysFilePath = resolveKeysFilePath(options.keysFile);

    if (path.basename(keysFilePath) !== NATIVE_REGISTERED_KEYS_FILE) {
      throw new Error(
        `--keys-file updates only ${NATIVE_REGISTERED_KEYS_FILE}. ` +
          `Non-native registries such as Olla use configured coinbases and should not be updated from native StakedWithProvider events.`,
      );
    }

    const keystore = await loadKeysFilePreservingOrder(keysFilePath);
    if (keystore.validators.length === 0) {
      throw new Error(`Keys file has no validators: ${keysFilePath}`);
    }

    return {
      attesterAddresses: keystore.validators.map(
        (validator) => validator.attester.eth,
      ),
      filesLoaded: [keysFilePath],
      targetKeysFilePath: keysFilePath,
      targetKeystore: keystore,
    };
  }

  const { attesters, filesLoaded } = await loadAndMergeKeysFiles(
    options.network,
  );
  return {
    attesterAddresses: attesters.map((a) => a.address),
    filesLoaded,
  };
}

async function updateKeysFileCoinbases(params: {
  keysFilePath: string;
  keystore: Keystore;
  mappings: MappedCoinbase[];
}): Promise<{
  addedCount: number;
  updatedCount: number;
  alreadyCorrectCount: number;
  missingCount: number;
  zeroAddressCount: number;
}> {
  const coinbaseMap = new Map<string, string>();
  for (const mapping of params.mappings) {
    coinbaseMap.set(
      mapping.attesterAddress.toLowerCase(),
      mapping.coinbaseAddress,
    );
  }

  let addedCount = 0;
  let updatedCount = 0;
  let alreadyCorrectCount = 0;
  let missingCount = 0;
  let zeroAddressCount = 0;

  console.log(`\nUpdating keys file coinbases: ${params.keysFilePath}`);

  for (const validator of params.keystore.validators) {
    const attesterAddr = validator.attester.eth;
    const scrapedCoinbase = coinbaseMap.get(attesterAddr.toLowerCase());

    if (!scrapedCoinbase) {
      missingCount++;
      continue;
    }

    if (scrapedCoinbase.toLowerCase() === ZERO_ADDRESS.toLowerCase()) {
      zeroAddressCount++;
      console.log(
        `  ⚠️  ${attesterAddr}: scraped coinbase is zero address, skipping`,
      );
      continue;
    }

    if (!validator.coinbase) {
      validator.coinbase = scrapedCoinbase;
      addedCount++;
      console.log(`  ✅ ${attesterAddr}: added ${scrapedCoinbase}`);
      continue;
    }

    if (validator.coinbase.toLowerCase() === scrapedCoinbase.toLowerCase()) {
      alreadyCorrectCount++;
      continue;
    }

    console.log(
      `  🔧 ${attesterAddr}: ${validator.coinbase} -> ${scrapedCoinbase}`,
    );
    validator.coinbase = scrapedCoinbase;
    updatedCount++;
  }

  if (addedCount > 0 || updatedCount > 0) {
    await fs.writeFile(
      params.keysFilePath,
      JSON.stringify(params.keystore, null, 2) + "\n",
      "utf-8",
    );
    console.log(`✅ Wrote updated keys file: ${params.keysFilePath}`);
  } else {
    console.log("No keys file changes needed.");
  }

  return {
    addedCount,
    updatedCount,
    alreadyCorrectCount,
    missingCount,
    zeroAddressCount,
  };
}

const command = async (
  ethClient: EthereumClient,
  config: ButlerConfig,
  options: ScrapeCoinbasesOptions,
) => {
  console.log("\n=== Scraping Coinbase Addresses ===\n");

  // Load keys files to get attester addresses
  console.log("Loading keys files...");
  const { attesterAddresses, filesLoaded, targetKeysFilePath, targetKeystore } =
    await loadAttesters(options);

  if (filesLoaded.length === 0) {
    throw new Error(
      `No keys files found for network "${options.network}".\n` +
        `Expected registered keys under ${options.network}/<host>/<source>-registered-keys.json in data directory.`,
    );
  }

  console.log(
    `✅ Found ${attesterAddresses.length} attester(s) from ${filesLoaded.length} file(s)`,
  );
  if (options.keysFile) {
    console.log(`   Target keys file: ${targetKeysFilePath}`);
  }

  // Get provider ID from config (must be set in .env)
  if (!config.AZTEC_STAKING_PROVIDER_ID) {
    throw new Error(
      `AZTEC_STAKING_PROVIDER_ID not configured for network "${options.network}".\n` +
        `Add AZTEC_STAKING_PROVIDER_ID to your ${options.network}-base.env file.`,
    );
  }

  const providerId = config.AZTEC_STAKING_PROVIDER_ID;
  console.log(`✅ Provider ID: ${providerId}`);

  // Determine scrape mode and start block
  const defaultStartBlock = DEFAULT_START_BLOCKS[options.network] ?? 0n;

  // Initialize CoinbaseScraper
  const scraper = new CoinbaseScraper({
    network: options.network,
    ethClient,
    providerId,
    attesterAddresses,
    defaultStartBlock,
    ...(options.outputPath ? { outputPath: options.outputPath } : {}),
  });

  // Perform scraping based on mode
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

  // Check for missing attesters
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

  let keysFileUpdateResult:
    | Awaited<ReturnType<typeof updateKeysFileCoinbases>>
    | undefined;
  if (targetKeysFilePath && targetKeystore) {
    keysFileUpdateResult = await updateKeysFileCoinbases({
      keysFilePath: targetKeysFilePath,
      keystore: targetKeystore,
      mappings: result.mappings,
    });
  }

  // Print summary
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
  if (keysFileUpdateResult) {
    console.log(
      `  Keys file coinbases added: ${keysFileUpdateResult.addedCount}`,
    );
    console.log(
      `  Keys file coinbases corrected: ${keysFileUpdateResult.updatedCount}`,
    );
    console.log(
      `  Keys file coinbases already correct: ${keysFileUpdateResult.alreadyCorrectCount}`,
    );
    console.log(
      `  Keys file validators missing scraped coinbase: ${keysFileUpdateResult.missingCount}`,
    );
    if (keysFileUpdateResult.zeroAddressCount > 0) {
      console.log(
        `  Keys file zero-address coinbases skipped: ${keysFileUpdateResult.zeroAddressCount}`,
      );
    }
  }
  console.log(`\nCoinbase cache has been updated.`);
};

export default command;
