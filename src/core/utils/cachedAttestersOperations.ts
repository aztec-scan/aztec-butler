import fs from "fs/promises";
import path from "path";
import envPath from "env-paths";
import { PACKAGE_NAME } from "../config/index.js";
import {
  CachedAttestersSchema,
  type CachedAttesters,
  type ScraperAttester,
} from "../../types/scraper-config.js";

const getDataDir = (): string => {
  return envPath(PACKAGE_NAME, { suffix: "" }).data;
};

/**
 * Load cached attesters for a specific network
 *
 * NOTE: This file format is DEPRECATED for server use.
 * The server now uses the unified keys file format (see keysFileOperations.ts).
 * This function is kept for CLI command compatibility only.
 */
export async function loadCachedAttesters(
  network: string,
  customPath?: string,
): Promise<CachedAttesters> {
  const filePath =
    customPath || path.join(getDataDir(), `${network}-cached-attesters.json`);

  try {
    const content = await fs.readFile(filePath, "utf-8");
    const data = JSON.parse(content);
    return CachedAttestersSchema.parse(data);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `Cached attesters not found for network "${network}" at ${filePath}.\n` +
          `This is normal if you haven't run scrape-attester-status yet. The file will be created automatically.`,
      );
    }
    throw error;
  }
}

/**
 * Save cached attesters
 */
export async function saveCachedAttesters(
  network: string,
  attesters: ScraperAttester[],
  customPath?: string,
): Promise<string> {
  const cache: CachedAttesters = {
    attesters,
    lastUpdated: new Date().toISOString(),
    version: "2.0",
  };

  // Validate before saving
  const validated = CachedAttestersSchema.parse(cache);

  const filePath =
    customPath || path.join(getDataDir(), `${network}-cached-attesters.json`);

  // Ensure directory exists
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  // Write with pretty formatting
  await fs.writeFile(filePath, JSON.stringify(validated, null, 2), "utf-8");

  return filePath;
}

/**
 * Validate cached attesters without saving
 */
export function validateCachedAttesters(data: unknown): CachedAttesters {
  return CachedAttestersSchema.parse(data);
}

/**
 * Available Publishers type
 * Maps server names to arrays of publisher addresses
 *
 * NOTE: This file format is DEPRECATED for server use.
 * The server now uses the unified keys file format (see keysFileOperations.ts).
 * These functions are kept for CLI command compatibility only.
 */
export interface AvailablePublishers {
  [server: string]: string[];
}

/**
 * Load available publishers for a specific network (for server use)
 * Always reads from data dir: {dataDir}/{network}-available-publishers.json
 */
export async function loadAvailablePublishers(
  network: string,
): Promise<AvailablePublishers> {
  const filePath = path.join(
    getDataDir(),
    `${network}-available-publishers.json`,
  );

  try {
    const content = await fs.readFile(filePath, "utf-8");
    const data = JSON.parse(content);

    // Validate structure
    if (typeof data !== "object" || Array.isArray(data) || data === null) {
      throw new Error(
        "Invalid available publishers file: must be a JSON object with server keys (e.g., {A: [], B: []})",
      );
    }

    // Validate all values are arrays
    for (const [server, publishers] of Object.entries(data)) {
      if (!Array.isArray(publishers)) {
        throw new Error(
          `Invalid available publishers file: server "${server}" must have an array of addresses`,
        );
      }
    }

    return data as AvailablePublishers;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `Available publishers not found for network "${network}" at ${filePath}.\n` +
          `The server will start without publishers. Copy your {network}-available-publishers.json to the data directory.`,
      );
    }
    throw error;
  }
}

/**
 * Load available publishers from a custom path (for CLI use)
 */
export async function loadAvailablePublishersFromPath(
  filePath: string,
): Promise<AvailablePublishers> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const data = JSON.parse(content);

    // Validate structure
    if (typeof data !== "object" || Array.isArray(data) || data === null) {
      throw new Error(
        "Invalid available publishers file: must be a JSON object with server keys (e.g., {A: [], B: []})",
      );
    }

    // Validate all values are arrays
    for (const [server, publishers] of Object.entries(data)) {
      if (!Array.isArray(publishers)) {
        throw new Error(
          `Invalid available publishers file: server "${server}" must have an array of addresses`,
        );
      }
    }

    return data as AvailablePublishers;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Available publishers file not found at ${filePath}`);
    }
    throw error;
  }
}
