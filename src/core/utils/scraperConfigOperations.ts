import fs from "fs/promises";
import path from "path";
import envPath from "env-paths";
import { PACKAGE_NAME } from "../config/index.js";
import {
  CoinbaseMappingCacheSchema,
  type CoinbaseMappingCache,
} from "../../types/scraper-config.js";

const getDataDir = (): string => {
  return envPath(PACKAGE_NAME, { suffix: "" }).data;
};

/**
 * Load coinbase mapping cache for a specific network
 * Now reads from {network}-cached-coinbases.json (renamed for consistency)
 * Falls back to old filename for backwards compatibility
 */
export async function loadCoinbaseCache(
  network: string,
  customPath?: string,
): Promise<CoinbaseMappingCache | null> {
  // Try new filename first
  const newFilePath =
    customPath || path.join(getDataDir(), `${network}-cached-coinbases.json`);

  try {
    const content = await fs.readFile(newFilePath, "utf-8");
    const data = JSON.parse(content);
    return CoinbaseMappingCacheSchema.parse(data);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      // Try old filename for backwards compatibility
      if (!customPath) {
        const oldFilePath = path.join(
          getDataDir(),
          `${network}-mapped-coinbases.json`,
        );
        try {
          const content = await fs.readFile(oldFilePath, "utf-8");
          const data = JSON.parse(content);
          return CoinbaseMappingCacheSchema.parse(data);
        } catch (oldError) {
          if ((oldError as NodeJS.ErrnoException).code === "ENOENT") {
            return null; // Cache doesn't exist yet, which is okay
          }
          throw oldError;
        }
      }
      return null; // Cache doesn't exist yet, which is okay
    }
    throw error;
  }
}

/**
 * Save coinbase mapping cache
 * Now saves to {network}-cached-coinbases.json (renamed for consistency)
 */
export async function saveCoinbaseCache(
  cache: CoinbaseMappingCache,
  customPath?: string,
): Promise<string> {
  // Validate cache before saving
  const validated = CoinbaseMappingCacheSchema.parse(cache);

  const filePath =
    customPath ||
    path.join(getDataDir(), `${validated.network}-cached-coinbases.json`);

  // Ensure directory exists
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  // Write with pretty formatting (convert BigInt to string for JSON)
  await fs.writeFile(
    filePath,
    JSON.stringify(
      validated,
      (_, value) => (typeof value === "bigint" ? value.toString() : value),
      2,
    ),
    "utf-8",
  );

  return filePath;
}

/**
 * Get cached coinbase for a specific attester
 */
export async function getCachedCoinbase(
  network: string,
  attesterAddress: string,
): Promise<{ coinbaseAddress: string; blockNumber: bigint } | null> {
  const cache = await loadCoinbaseCache(network);
  if (!cache) {
    return null;
  }

  const mapping = cache.mappings.find(
    (m) => m.attesterAddress.toLowerCase() === attesterAddress.toLowerCase(),
  );

  if (!mapping) {
    return null;
  }

  return {
    coinbaseAddress: mapping.coinbaseAddress,
    blockNumber: mapping.blockNumber,
  };
}
