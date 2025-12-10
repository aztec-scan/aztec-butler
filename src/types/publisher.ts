import { z } from "zod";
import { HexStringSchema } from "./common.js";

/**
 * Schema for individual publisher data
 * Tracks balance and required top-up for each publisher
 * Load can be calculated at consumption time by counting attesters per publisher
 */
export const PublisherDataSchema = z.object({
  publisherAddress: z.string(), // Ethereum address derived from private key
  publisherPrivateKey: HexStringSchema, // Private key (kept for internal tracking)
  currentBalance: z.bigint(), // Current ETH balance in wei
  requiredTopup: z.bigint(), // Required ETH to reach recommended balance (0 if sufficient)
  lastUpdated: z.date(),
});

export type PublisherData = z.infer<typeof PublisherDataSchema>;

/**
 * Map of publisher private keys to their data
 */
export type PublisherDataMap = Map<string, PublisherData>;

export type PublisherDataEntry = z.infer<typeof PublisherDataSchema>;
