import fs from "fs/promises";
import path from "path";
import envPath from "env-paths";
import { PACKAGE_NAME } from "../config/index.js";
import {
  ScraperConfigSchema,
  CoinbaseMappingCacheSchema,
  type ScraperConfig,
  type CoinbaseMappingCache,
} from "../../types/scraper-config.js";

const getDataDir = (): string => {
  return envPath(PACKAGE_NAME, { suffix: "" }).data;
};

/**
 * Load scraper configuration for a specific network
 */
export async function loadScraperConfig(
  network: string,
  customPath?: string,
): Promise<ScraperConfig> {
  const filePath =
    customPath || path.join(getDataDir(), `${network}-scrape-config.json`);

  try {
    const content = await fs.readFile(filePath, "utf-8");
    const data = JSON.parse(content);
    return ScraperConfigSchema.parse(data);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `Scraper config not found for network "${network}" at ${filePath}.\n` +
          `Please run: aztec-butler generate-scraper-config --network ${network}`,
      );
    }
    throw error;
  }
}

/**
 * Save scraper configuration
 */
export async function saveScraperConfig(
  config: ScraperConfig,
  customPath?: string,
): Promise<string> {
  // Validate config before saving
  const validated = ScraperConfigSchema.parse(config);

  const filePath =
    customPath ||
    path.join(getDataDir(), `${validated.network}-scrape-config.json`);

  // Ensure directory exists
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  // Write with pretty formatting (convert BigInt to string for JSON)
  await fs.writeFile(
    filePath,
    JSON.stringify(
      validated,
      (key, value) => (typeof value === "bigint" ? value.toString() : value),
      2,
    ),
    "utf-8",
  );

  return filePath;
}

/**
 * Validate scraper configuration without saving
 */
export function validateScraperConfig(config: unknown): ScraperConfig {
  return ScraperConfigSchema.parse(config);
}

/**
 * Load coinbase mapping cache for a specific network
 */
export async function loadCoinbaseCache(
  network: string,
  customPath?: string,
): Promise<CoinbaseMappingCache | null> {
  const filePath =
    customPath || path.join(getDataDir(), `${network}-mapped-coinbases.json`);

  try {
    const content = await fs.readFile(filePath, "utf-8");
    const data = JSON.parse(content);
    return CoinbaseMappingCacheSchema.parse(data);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null; // Cache doesn't exist yet, which is okay
    }
    throw error;
  }
}

/**
 * Save coinbase mapping cache
 */
export async function saveCoinbaseCache(
  cache: CoinbaseMappingCache,
  customPath?: string,
): Promise<string> {
  // Validate cache before saving
  const validated = CoinbaseMappingCacheSchema.parse(cache);

  const filePath =
    customPath ||
    path.join(getDataDir(), `${validated.network}-mapped-coinbases.json`);

  // Ensure directory exists
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  // Write with pretty formatting (convert BigInt to string for JSON)
  await fs.writeFile(
    filePath,
    JSON.stringify(
      validated,
      (key, value) => (typeof value === "bigint" ? value.toString() : value),
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
