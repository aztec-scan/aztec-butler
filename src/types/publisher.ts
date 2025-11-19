import { z } from "zod";
import { HexStringSchema } from "./common.js";

/**
 * Schema for individual publisher data
 * Tracks load, balance, and required top-up for each publisher
 */
export const PublisherDataSchema = z.object({
  publisherAddress: z.string(), // Ethereum address derived from private key
  publisherPrivateKey: HexStringSchema, // Private key (kept for internal tracking)
  load: z.number(), // Number of validators using this publisher (can be fractional)
  currentBalance: z.bigint(), // Current ETH balance in wei
  requiredTopup: z.bigint(), // Required ETH to reach recommended balance (0 if sufficient)
  lastUpdated: z.date(),
});

export type PublisherData = z.infer<typeof PublisherDataSchema>;

/**
 * Map of publisher private keys to their data
 */
export type PublisherDataMap = Map<string, PublisherData>;
