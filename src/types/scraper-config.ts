import { z } from "zod";

// Scraper Configuration Schemas

export const ScraperAttesterSchema = z.object({
  address: z.string().startsWith("0x").length(42),
  coinbase: z
    .string()
    .startsWith("0x")
    .length(42)
    .refine((val) => val !== "0x0000000000000000000000000000000000000000", {
      message: "Coinbase cannot be zero address",
    })
    .optional(), // Optional - omit if not yet set
  lastSeenState: z
    .enum([
      "NEW",
      "IN_STAKING_PROVIDER_QUEUE",
      "ROLLUP_ENTRY_QUEUE",
      "ACTIVE",
      "NO_LONGER_ACTIVE",
    ])
    .optional(),
});

export const ScraperPublisherSchema = z.object({
  address: z.string().startsWith("0x").length(42),
  serverId: z.string(),
  attesterCount: z.number().int().nonnegative().optional().default(0), // Number of attesters using this publisher
});

export const ScraperConfigSchema = z
  .object({
    network: z.string(),
    serverId: z.string().optional(), // Optional server identifier for multi-server deployments (deprecated - use publishers[].serverId)
    l1ChainId: z.union([z.literal(1), z.literal(11155111)]), // TODO: use named constants from somehwere (mainnet and sepolia)
    stakingProviderId: z.coerce.bigint(),
    stakingProviderAdmin: z.string().startsWith("0x").length(42),
    attesters: z.array(ScraperAttesterSchema),
    publishers: z.array(ScraperPublisherSchema),
    lastUpdated: z.string().datetime(),
    version: z.literal("1.1"),
  })
  .refine(
    (config) => {
      // Check for duplicate attester addresses (case-insensitive)
      const addresses = config.attesters.map((a) => a.address.toLowerCase());
      const uniqueAddresses = new Set(addresses);
      return addresses.length === uniqueAddresses.size;
    },
    {
      message: "Scraper config contains duplicate attester addresses",
    },
  )
  .refine(
    (config) => {
      // Check for duplicate publisher addresses (case-insensitive)
      const publishers = config.publishers.map((p) => p.address.toLowerCase());
      const uniquePublishers = new Set(publishers);
      return publishers.length === uniquePublishers.size;
    },
    {
      message: "Scraper config contains duplicate publisher addresses",
    },
  );

export type ScraperConfig = z.infer<typeof ScraperConfigSchema>;
export type ScraperAttester = z.infer<typeof ScraperAttesterSchema>;
export type ScraperPublisher = z.infer<typeof ScraperPublisherSchema>;

// Coinbase Mapping Cache Schemas

export const MappedCoinbaseSchema = z.object({
  attesterAddress: z.string().startsWith("0x").length(42),
  coinbaseAddress: z.string().startsWith("0x").length(42),
  blockNumber: z.coerce.bigint(),
  blockHash: z.string().startsWith("0x"),
  timestamp: z.number(),
});

export const CoinbaseMappingCacheSchema = z.object({
  network: z.string(),
  stakingProviderId: z.coerce.bigint(),
  lastScrapedBlock: z.coerce.bigint(),
  mappings: z.array(MappedCoinbaseSchema),
  scrapedAt: z.string().datetime(),
  version: z.literal("1.0"),
});

export type CoinbaseMappingCache = z.infer<typeof CoinbaseMappingCacheSchema>;
export type MappedCoinbase = z.infer<typeof MappedCoinbaseSchema>;
