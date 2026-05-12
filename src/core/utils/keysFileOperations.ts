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

export type KeySource = {
  filePath: string;
  network: string;
  serverId: string;
  host?: string;
  source?: string;
  format: "registered-nested";
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
 *   mainnet-keys-beast-3-v1.json -> "beast-3"
 */
export function extractServerIdFromFilename(filename: string): string {
  // Pattern: [network]-keys-[serverId]-v[N].json
  // Server ID can contain dashes, so we match everything between "keys-" and "-v"
  const match = filename.match(/^[^-]+-keys-(.+)-v\d+\.json$/);
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
 * Auto-discover all registered key sources for a network.
 * Pattern: {dataDir}/{network}/{host}/{source}-registered-keys.json
 *
 * The native source keeps the host as serverId. Other sources include the
 * source name so multiple registries on one host do not collide.
 */
export async function discoverKeysFiles(
  network: string,
  dataDir = getDataDir(),
): Promise<KeySource[]> {
  const networkDir = path.join(dataDir, network);
  const keySources: KeySource[] = [];

  try {
    const hosts = await fs.readdir(networkDir, { withFileTypes: true });

    for (const hostDirent of hosts) {
      if (!hostDirent.isDirectory()) {
        continue;
      }

      const host = hostDirent.name;
      const hostDir = path.join(networkDir, host);
      const files = await fs.readdir(hostDir, { withFileTypes: true });

      for (const fileDirent of files) {
        if (!fileDirent.isFile()) {
          continue;
        }

        const match = fileDirent.name.match(/^(.+)-registered-keys\.json$/);
        if (!match?.[1]) {
          continue;
        }

        const source = match[1];
        keySources.push({
          filePath: path.join(hostDir, fileDirent.name),
          network,
          serverId: source === "native" ? host : `${host}-${source}`,
          host,
          source,
          format: "registered-nested",
        });
      }
    }

    return keySources.sort((a, b) => a.filePath.localeCompare(b.filePath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return []; // Directory doesn't exist yet
    }
    throw error;
  }
}

/**
 * Load all keys files for a network and merge validators
 * Returns: merged attester list with coinbases, merged publisher list with server assignments and load counts
 */
export async function loadAndMergeKeysFiles(
  network: string,
  dataDir = getDataDir(),
): Promise<{
  attesters: Array<{
    address: string;
    coinbase?: string;
    serverId?: string;
  }>;
  publishers: Array<{
    address: string;
    serverId: string;
    attesterCount: number; // Number of attesters using this publisher
  }>;
  filesLoaded: string[];
}> {
  const keySources = await discoverKeysFiles(network, dataDir);

  if (keySources.length === 0) {
    console.warn(`No keys files found for network ${network}`);
    return { attesters: [], publishers: [], filesLoaded: [] };
  }

  console.log(
    `Found ${keySources.length} registered key source(s) for ${network}:`,
  );
  keySources.forEach((source) => {
    console.log(
      `  - ${path.relative(dataDir, source.filePath)} (serverId=${source.serverId})`,
    );
  });

  const attesterMap = new Map<string, { address: string; coinbase?: string }>();
  const publisherMap = new Map<
    string,
    { address: string; serverId: string; attesterCount: number }
  >();

  for (const keySource of keySources) {
    const keystore = await loadKeysFile(keySource.filePath);
    const serverId = keySource.serverId;

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

      // Collect publishers and count attesters per publisher
      const publisherAddrs = Array.isArray(validator.publisher)
        ? validator.publisher
        : [validator.publisher];

      for (const pubAddr of publisherAddrs) {
        const normalizedPub = pubAddr.toLowerCase();
        if (!publisherMap.has(normalizedPub)) {
          publisherMap.set(normalizedPub, {
            address: pubAddr,
            serverId,
            attesterCount: 0,
          });
        }
        // Increment attester count for this publisher
        const pubData = publisherMap.get(normalizedPub)!;
        pubData.attesterCount++;
      }
    }
  }

  return {
    attesters: Array.from(attesterMap.values()),
    publishers: Array.from(publisherMap.values()),
    filesLoaded: keySources.map((source) =>
      path.relative(dataDir, source.filePath),
    ),
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
