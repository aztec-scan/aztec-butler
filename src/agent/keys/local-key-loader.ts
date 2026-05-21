/**
 * Registry-aware loader for the host-local registered-key files.
 *
 * Unlike the server's {@link loadAndMergeKeysFiles}, the agent reads ONLY
 * the files belonging to its own host and preserves placement data
 * (`host`, `registry`) per attester instead of flattening it away.
 *
 * Layout:
 *   {dataDir}/{network}/{host}/native-registered-keys.json -> registry "native"
 *   {dataDir}/{network}/{host}/olla-registered-keys.json   -> registry "olla"
 */

import fs from "node:fs/promises";
import path from "node:path";
import { getDataDir, loadKeysFile } from "../../core/utils/keysFileOperations.js";
import { STAKING_REGISTRY_TARGETS, type StakingRegistryTarget } from "../../types/index.js";

export type Registry = StakingRegistryTarget;

export interface LocalAttesterKey {
  network: string;
  host: string;
  registry: Registry;
  attesterAddress: string;
  coinbase?: string;
  publishers: string[];
  filePath: string;
}

const REGISTERED_KEYS_SUFFIX = "-registered-keys.json";

/**
 * Parse the registry from a `<registry>-registered-keys.json` filename.
 * Throws on unknown prefixes — we intentionally do not silently accept
 * registries we have no read path for.
 */
export const parseRegistryFromFilename = (filename: string): Registry => {
  if (!filename.endsWith(REGISTERED_KEYS_SUFFIX)) {
    throw new Error(`Not a registered-keys file: "${filename}"`);
  }
  const prefix = filename.slice(0, -REGISTERED_KEYS_SUFFIX.length);
  if (!STAKING_REGISTRY_TARGETS.includes(prefix as Registry)) {
    throw new Error(
      `Unknown registry prefix "${prefix}" in "${filename}". ` +
        `Expected one of: ${STAKING_REGISTRY_TARGETS.join(", ")}.`,
    );
  }
  return prefix as Registry;
};

/** True when `filename` is a `<registry>-registered-keys.json` file for a known registry. */
export const isRegisteredKeysFilename = (filename: string): boolean => {
  try {
    parseRegistryFromFilename(filename);
    return true;
  } catch {
    return false;
  }
};

export interface LoadLocalRegisteredKeysResult {
  keys: LocalAttesterKey[];
  filesLoaded: string[];
  /** File names skipped because they used an unrecognised registry prefix. */
  filesSkipped: string[];
}

/**
 * Load the registered-key files for a single host directory.
 *
 * @param network  network name (e.g. "mainnet")
 * @param host     this sequencer's host name (e.g. "beast-3")
 * @param dataDir  data directory root (defaults to the Butler data dir)
 */
export const loadLocalRegisteredKeys = async (
  network: string,
  host: string,
  dataDir: string = getDataDir(),
): Promise<LoadLocalRegisteredKeysResult> => {
  const hostDir = path.join(dataDir, network, host);
  const keys: LocalAttesterKey[] = [];
  const filesLoaded: string[] = [];
  const filesSkipped: string[] = [];

  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(hostDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      console.warn(
        `[agent] No host key directory at ${hostDir} — agent will report zero local attesters.`,
      );
      return { keys, filesLoaded, filesSkipped };
    }
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(REGISTERED_KEYS_SUFFIX)) {
      continue;
    }

    let registry: Registry;
    try {
      registry = parseRegistryFromFilename(entry.name);
    } catch (error) {
      filesSkipped.push(entry.name);
      console.warn(
        `[agent] Skipping ${entry.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }

    const filePath = path.join(hostDir, entry.name);
    const keystore = await loadKeysFile(filePath);

    for (const validator of keystore.validators) {
      const publishers = Array.isArray(validator.publisher)
        ? validator.publisher
        : [validator.publisher];

      const key: LocalAttesterKey = {
        network,
        host,
        registry,
        attesterAddress: validator.attester.eth,
        publishers,
        filePath,
      };
      if (validator.coinbase) {
        key.coinbase = validator.coinbase;
      }
      keys.push(key);
    }

    filesLoaded.push(filePath);
  }

  keys.sort((a, b) => a.attesterAddress.toLowerCase().localeCompare(b.attesterAddress.toLowerCase()));
  return { keys, filesLoaded, filesSkipped };
};

/** Collect the unique publisher addresses across a set of local keys. */
export const collectLocalPublishers = (keys: LocalAttesterKey[]): string[] => {
  const seen = new Map<string, string>(); // lowercase -> original casing
  for (const key of keys) {
    for (const publisher of key.publishers) {
      const lower = publisher.toLowerCase();
      if (!seen.has(lower)) {
        seen.set(lower, publisher);
      }
    }
  }
  return Array.from(seen.values());
};
