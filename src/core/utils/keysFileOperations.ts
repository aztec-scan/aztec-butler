import fs from "fs/promises";
import path from "path";
import envPath from "env-paths";
import { PACKAGE_NAME } from "../config/index.js";
import { KeystoreSchema, type Keystore } from "../../types/keystore.js";

/**
 * Get the data directory path
 */
export const getDataDir = (): string => {
  return envPath(PACKAGE_NAME, { suffix: "" }).data;
};

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Extract server ID from filename
 * Examples:
 *   mainnet-keys-A-v1.json -> "A"
 *   mainnet-keys-validator1-v2.json -> "validator1"
 */
export function extractServerIdFromFilename(filename: string): string {
  // Pattern: [network]-keys-[serverId]-v[N].json
  const match = filename.match(/^[^-]+-keys-([^-]+)-v\d+\.json$/);
  if (!match?.[1]) {
    throw new Error(`Invalid keys filename format: ${filename}`);
  }
  return match[1];
}

/**
 * Load and parse a single deployment keys file
 */
export async function loadKeysFile(filePath: string): Promise<Keystore> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const data = JSON.parse(content);
    return KeystoreSchema.parse(data);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Keys file not found: ${filePath}`);
    }
    throw new Error(
      `Failed to load keys file ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Auto-discover all keys files for a network
 * Pattern: {dataDir}/{network}-keys-*.json
 *
 * Returns only the latest version per server ID to avoid conflicts.
 */
export async function discoverKeysFiles(network: string): Promise<string[]> {
  const dataDir = getDataDir();

  try {
    const files = await fs.readdir(dataDir);

    // Group files by server ID
    const serverFiles = new Map<
      string,
      Array<{ file: string; version: number }>
    >();

    for (const file of files) {
      const match = file.match(
        new RegExp(`^${escapeRegex(network)}-keys-([^-]+)-v(\\d+)\\.json$`),
      );
      if (match) {
        const serverId = match[1]!;
        const version = parseInt(match[2]!, 10);

        if (!serverFiles.has(serverId)) {
          serverFiles.set(serverId, []);
        }
        serverFiles.get(serverId)!.push({ file, version });
      }
    }

    // Select highest version for each server
    const selectedFiles: string[] = [];
    for (const [serverId, versions] of serverFiles.entries()) {
      const latest = versions.reduce((max, curr) =>
        curr.version > max.version ? curr : max,
      );
      selectedFiles.push(path.join(dataDir, latest.file));

      if (versions.length > 1) {
        console.log(
          `[${network}] Server ${serverId}: Found ${versions.length} versions, using v${latest.version}`,
        );
      }
    }

    return selectedFiles.sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return []; // Directory doesn't exist yet
    }
    throw error;
  }
}

/**
 * Load all keys files for a network and merge validators
 * Returns: merged attester list with coinbases, merged publisher list with server assignments
 */
export async function loadAndMergeKeysFiles(network: string): Promise<{
  attesters: Array<{
    address: string;
    coinbase?: string;
    serverId?: string;
  }>;
  publishers: Array<{
    address: string;
    serverId: string;
  }>;
  filesLoaded: string[];
}> {
  const keyFiles = await discoverKeysFiles(network);

  if (keyFiles.length === 0) {
    console.warn(`No keys files found for network ${network}`);
    return { attesters: [], publishers: [], filesLoaded: [] };
  }

  console.log(`Found ${keyFiles.length} keys file(s) for ${network}:`);
  keyFiles.forEach((f) => console.log(`  - ${path.basename(f)}`));

  const attesterMap = new Map<string, { address: string; coinbase?: string }>();
  const publisherMap = new Map<string, { address: string; serverId: string }>();

  for (const filePath of keyFiles) {
    const keystore = await loadKeysFile(filePath);
    const serverId = extractServerIdFromFilename(path.basename(filePath));

    for (const validator of keystore.validators) {
      const attesterAddr = validator.attester.eth.toLowerCase();

      // Merge attester (last file wins for duplicates - this is normal and expected)
      const attesterEntry: { address: string; coinbase?: string } = {
        address: validator.attester.eth, // Keep original casing
      };
      if (validator.coinbase) {
        attesterEntry.coinbase = validator.coinbase;
      }
      attesterMap.set(attesterAddr, attesterEntry);

      // Collect publishers
      const publisherAddrs = Array.isArray(validator.publisher)
        ? validator.publisher
        : [validator.publisher];

      for (const pubAddr of publisherAddrs) {
        const normalizedPub = pubAddr.toLowerCase();
        if (!publisherMap.has(normalizedPub)) {
          publisherMap.set(normalizedPub, {
            address: pubAddr,
            serverId,
          });
        }
      }
    }
  }

  return {
    attesters: Array.from(attesterMap.values()),
    publishers: Array.from(publisherMap.values()),
    filesLoaded: keyFiles.map((f) => path.basename(f)),
  };
}

/**
 * Generate versioned filename for keys file
 * Pattern: [network]-keys-[serverId]-v[N].json
 *
 * Finds the highest existing version and returns the next version number
 */
export async function generateVersionedFilename(
  network: string,
  serverId: string,
  dir?: string,
): Promise<string> {
  const targetDir = dir || getDataDir();
  const baseWithoutExt = `${network}-keys-${serverId}`;

  // Find highest existing version
  const files = await fs.readdir(targetDir).catch(() => []);
  let highestVersion = 0;

  const regex = new RegExp(`^${escapeRegex(baseWithoutExt)}-v(\\d+)\\.json$`);

  for (const file of files) {
    const match = file.match(regex);
    if (match?.[1]) {
      const version = parseInt(match[1], 10);
      if (version > highestVersion) {
        highestVersion = version;
      }
    }
  }

  const nextVersion = highestVersion + 1;
  return path.join(targetDir, `${baseWithoutExt}-v${nextVersion}.json`);
}
