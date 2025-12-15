import fs from "fs/promises";
import path from "path";
import type { EthereumClient } from "../../core/components/EthereumClient.js";
import type { ButlerConfig } from "../../core/config/index.js";
import {
  loadKeysFile,
  generateVersionedFilename,
  getDataDir,
} from "../../core/utils/keysFileOperations.js";
import { loadCoinbaseCache } from "../../core/utils/scraperConfigOperations.js";
import type { Keystore } from "../../types/keystore.js";

interface FillCoinbasesOptions {
  network: string;
  keysFile: string;
  incrementVersion?: boolean;
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const command = async (
  _ethClient: EthereumClient,
  _config: ButlerConfig,
  options: FillCoinbasesOptions,
) => {
  console.log("\n=== Fill Coinbases ===\n");

  // 1. Load keys file
  console.log(`Loading keys file: ${options.keysFile}`);

  // Check if file path is absolute or relative
  const keysFilePath = path.isAbsolute(options.keysFile)
    ? options.keysFile
    : path.join(getDataDir(), options.keysFile);

  let keystore: Keystore;
  try {
    keystore = await loadKeysFile(keysFilePath);
  } catch (error) {
    throw new Error(
      `Failed to load keys file: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  console.log(
    `✅ Loaded ${keystore.validators.length} validator(s) from keys file`,
  );

  // 2. Load coinbase cache
  console.log(`\nLoading coinbase cache for network: ${options.network}`);

  const coinbaseCache = await loadCoinbaseCache(options.network);
  if (!coinbaseCache) {
    throw new Error(
      `No coinbase cache found for network "${options.network}".\n` +
        `Run 'aztec-butler scrape-coinbases --network ${options.network}' to create it.`,
    );
  }

  if (coinbaseCache.mappings.length === 0) {
    console.warn(`⚠️  Coinbase cache is empty. No coinbases to fill.`);
    return;
  }

  console.log(`✅ Loaded ${coinbaseCache.mappings.length} coinbase mapping(s)`);

  // 3. Build coinbase map for quick lookup
  const coinbaseMap = new Map<string, string>();
  for (const mapping of coinbaseCache.mappings) {
    coinbaseMap.set(
      mapping.attesterAddress.toLowerCase(),
      mapping.coinbaseAddress,
    );
  }

  // 4. Process each validator
  console.log(`\nProcessing validators...`);

  let addedCount = 0;
  let alreadySetCount = 0;
  let conflictCount = 0;
  let missingCount = 0;
  const warnings: string[] = [];

  for (const validator of keystore.validators) {
    const attesterAddr = validator.attester.eth;
    const cachedCoinbase = coinbaseMap.get(attesterAddr.toLowerCase());

    if (!cachedCoinbase) {
      // No coinbase found in cache
      missingCount++;
      continue;
    }

    // Validate coinbase is not zero address
    if (cachedCoinbase === ZERO_ADDRESS) {
      warnings.push(
        `  ⚠️  Attester ${attesterAddr}: Coinbase is zero address, skipping`,
      );
      continue;
    }

    if (validator.coinbase) {
      // Coinbase already set
      if (validator.coinbase.toLowerCase() === cachedCoinbase.toLowerCase()) {
        // Same value, already correct
        alreadySetCount++;
      } else {
        // Different value, conflict
        conflictCount++;
        warnings.push(
          `  ⚠️  Attester ${attesterAddr}: Coinbase mismatch\n` +
            `      Current: ${validator.coinbase}\n` +
            `      Cache:   ${cachedCoinbase}\n` +
            `      Keeping current value`,
        );
      }
    } else {
      // No coinbase set, add it
      validator.coinbase = cachedCoinbase;
      addedCount++;
      console.log(`  ✅ Added coinbase for ${attesterAddr}: ${cachedCoinbase}`);
    }
  }

  // 5. Print warnings
  if (warnings.length > 0) {
    console.log(`\n${warnings.join("\n")}`);
  }

  // 6. Determine output path
  let outputPath: string;
  if (options.incrementVersion) {
    // Extract server ID from filename and generate new version
    const filename = path.basename(keysFilePath);
    const match = filename.match(/^([^-]+)-keys-([^-]+)-v\d+\.json$/);
    if (!match) {
      throw new Error(
        `Cannot increment version: Keys file doesn't match naming pattern [network]-keys-[serverId]-v[N].json`,
      );
    }
    const network = match[1];
    const serverId = match[2];
    const dir = path.dirname(keysFilePath);

    outputPath = await generateVersionedFilename(network!, serverId!, dir);
    console.log(`\nWill create new version: ${path.basename(outputPath)}`);
  } else {
    // Overwrite existing file
    outputPath = keysFilePath;
    console.log(`\nWill update existing file: ${path.basename(outputPath)}`);
  }

  // 7. Write updated keys file
  if (addedCount > 0 || options.incrementVersion) {
    await fs.writeFile(outputPath, JSON.stringify(keystore, null, 2) + "\n");
    console.log(`✅ Wrote updated keys file: ${outputPath}`);
  } else {
    console.log(`\n No changes needed, file not modified.`);
  }

  // 8. Summary
  console.log(`\n=== Summary ===`);
  console.log(`Total validators: ${keystore.validators.length}`);
  console.log(`Coinbases added: ${addedCount}`);
  console.log(`Already set: ${alreadySetCount}`);
  console.log(`Conflicts (kept existing): ${conflictCount}`);
  console.log(`Missing from cache: ${missingCount}`);

  if (missingCount > 0) {
    console.log(
      `\n⚠️  ${missingCount} validator(s) have no coinbase mapping in cache.`,
    );
    console.log(
      `   These attesters may not have been staked yet, or the cache may need updating.`,
    );
  }

  if (addedCount === 0 && missingCount === 0 && conflictCount === 0) {
    console.log(`\n✅ All validators already have correct coinbase addresses!`);
  } else if (addedCount > 0) {
    console.log(`\n✅ Successfully filled ${addedCount} coinbase address(es)!`);
  }
};

export default command;
