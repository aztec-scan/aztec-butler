import fs from "fs/promises";
import path from "path";
import { KeystoreDataSchema, type KeystoreData } from "../../types/keystore.js";
import { privateKeyToAccount } from "viem/accounts";
import type { HexString } from "../../types/common.js";

export interface Keystore {
  path: string;
  id: string;
  data: KeystoreData;
}

/**
 * Load keystores from specified file paths
 * Used by new CLI interface
 */
export async function loadKeystoresFromPaths(
  keystorePaths: string[],
): Promise<Keystore[]> {
  const keystores: Keystore[] = [];
  const notNumbers = /[^0-9]/g;

  for (const keystorePath of keystorePaths) {
    try {
      const content = await fs.readFile(keystorePath, "utf-8");
      const data = JSON.parse(content);

      // Validate with Zod schema
      const validated = KeystoreDataSchema.parse(data);

      keystores.push({
        path: keystorePath,
        id: path.basename(keystorePath).replace(notNumbers, "") || keystorePath,
        data: validated,
      });
    } catch (error) {
      console.warn(
        `Warning: Failed to parse keystore ${keystorePath}: ${error}`,
      );
      // Continue with other files
    }
  }

  if (keystores.length === 0) {
    throw new Error(`No valid keystores found in provided paths`);
  }

  return keystores;
}

/**
 * Load keystores from a directory
 * Used by CLI mode only
 */
export async function loadKeystoresFromDirectory(
  keysDir: string,
): Promise<Keystore[]> {
  try {
    const files = await fs.readdir(keysDir);
    const jsonFiles = files.filter((f) => f.endsWith(".json"));

    if (jsonFiles.length === 0) {
      throw new Error(`No JSON keystore files found in ${keysDir}`);
    }

    const keystores: Keystore[] = [];
    const notNumbers = /[^0-9]/g;

    for (const jsonFile of jsonFiles) {
      const fullPath = path.join(keysDir, jsonFile);
      try {
        const content = await fs.readFile(fullPath, "utf-8");
        const data = JSON.parse(content);

        // Validate with Zod schema
        const validated = KeystoreDataSchema.parse(data);

        keystores.push({
          path: fullPath,
          id: jsonFile.replace(notNumbers, ""),
          data: validated,
        });
      } catch (error) {
        console.warn(`Warning: Failed to parse keystore ${jsonFile}: ${error}`);
        // Continue with other files
      }
    }

    if (keystores.length === 0) {
      throw new Error(`No valid keystores found in ${keysDir}`);
    }

    return keystores;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Keys directory not found: ${keysDir}`);
    }
    throw error;
  }
}

/**
 * Extract attester addresses from keystores
 * Note: attester.eth is a private key, we derive the address from it
 */
export function extractAttesterAddresses(keystores: Keystore[]): string[] {
  const addresses = new Set<string>();

  for (const keystore of keystores) {
    for (const validator of keystore.data.validators) {
      // Derive address from private key
      const address = getAddressFromPrivateKey(
        validator.attester.eth as HexString,
      );
      addresses.add(address);
    }
  }

  return Array.from(addresses);
}

/**
 * Extract publisher addresses from keystores
 * Publishers are derived from private keys
 */
export function extractPublisherAddresses(keystores: Keystore[]): string[] {
  const addresses = new Set<string>();

  for (const keystore of keystores) {
    for (const validator of keystore.data.validators) {
      if (typeof validator.publisher === "string") {
        // Single publisher key
        const address = getAddressFromPrivateKey(
          validator.publisher as HexString,
        );
        addresses.add(address);
      } else {
        // Array of publisher keys
        for (const privKey of validator.publisher) {
          const address = getAddressFromPrivateKey(privKey as HexString);
          addresses.add(address);
        }
      }
    }
  }

  return Array.from(addresses);
}

/**
 * Get Ethereum address from private key
 */
export function getAddressFromPrivateKey(privateKey: HexString): string {
  const account = privateKeyToAccount(privateKey);
  return account.address;
}

/**
 * Extract attester-coinbase pairs from keystores
 * Note: attester.eth is a private key, we derive the address from it
 */
export function extractAttesterCoinbasePairs(keystores: Keystore[]): Array<{
  address: string;
  coinbase: string;
}> {
  const pairs: Array<{ address: string; coinbase: string }> = [];

  for (const keystore of keystores) {
    for (const validator of keystore.data.validators) {
      const address = getAddressFromPrivateKey(
        validator.attester.eth as HexString,
      );
      pairs.push({
        address,
        coinbase:
          validator.coinbase || "0x0000000000000000000000000000000000000000",
      });
    }
  }

  return pairs;
}

/**
 * Extract attester data with publisher mappings from keystores
 * Returns complete attester info for scraper config generation
 */
export function extractAttesterDataWithPublisher(keystores: Keystore[]): Array<{
  address: string;
  coinbase: string | undefined;
  publisher: string;
}> {
  const attesterData: Array<{
    address: string;
    coinbase: string | undefined;
    publisher: string;
  }> = [];

  for (const keystore of keystores) {
    for (const validator of keystore.data.validators) {
      const attesterAddress = getAddressFromPrivateKey(
        validator.attester.eth as HexString,
      );

      // Extract publisher (handle both single and array cases)
      let publisherAddress: string;
      if (typeof validator.publisher === "string") {
        publisherAddress = getAddressFromPrivateKey(
          validator.publisher as HexString,
        );
      } else {
        // For array, use first publisher
        publisherAddress = getAddressFromPrivateKey(
          validator.publisher[0] as HexString,
        );
      }

      // Get coinbase, only set if not zero address
      const coinbaseRaw = validator.coinbase;
      const coinbase =
        coinbaseRaw &&
        coinbaseRaw !== "0x0000000000000000000000000000000000000000"
          ? coinbaseRaw
          : undefined;

      attesterData.push({
        address: attesterAddress,
        coinbase,
        publisher: publisherAddress,
      });
    }
  }

  return attesterData;
}
