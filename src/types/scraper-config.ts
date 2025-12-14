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
      "COINBASE_NEEDED",
      "IN_STAKING_QUEUE",
      "ACTIVE",
      "NO_LONGER_ACTIVE",
    ])
    .optional(),
});

export const ScraperConfigSchema = z
  .object({
    network: z.string(),
    l1ChainId: z.union([z.literal(1), z.literal(11155111)]), // TODO: use named constants from somehwere (mainnet and sepolia)
    stakingProviderId: z.coerce.bigint(),
    stakingProviderAdmin: z.string().startsWith("0x").length(42),
    attesters: z.array(ScraperAttesterSchema),
    publishers: z.array(z.string().startsWith("0x").length(42)),
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
      const publishers = config.publishers.map((p) => p.toLowerCase());
      const uniquePublishers = new Set(publishers);
      return publishers.length === uniquePublishers.size;
    },
    {
      message: "Scraper config contains duplicate publisher addresses",
    },
  );

export type ScraperConfig = z.infer<typeof ScraperConfigSchema>;
export type ScraperAttester = z.infer<typeof ScraperAttesterSchema>;

// Cached Attesters Schema (v2.0)

export const CachedAttestersSchema = z.object({
  attesters: z.array(ScraperAttesterSchema),
  lastUpdated: z.string().datetime(),
  version: z.literal("2.0"),
});

export type CachedAttesters = z.infer<typeof CachedAttestersSchema>;

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
