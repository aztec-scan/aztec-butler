import { z } from "zod";

// Scraper Configuration Schemas

export const ScraperAttesterSchema = z.object({
  address: z.string().startsWith("0x").length(42),
  coinbase: z.string().startsWith("0x").length(42), // Required - use 0x0000000000000000000000000000000000000000 if not yet set
  publisher: z.string().startsWith("0x").length(42),
});

export const ScraperConfigSchema = z.object({
  network: z.string(),
  l1ChainId: z.union([z.literal(1), z.literal(11155111)]), // TODO: use named constants from somehwere (mainnet and sepolia)
  stakingProviderId: z.coerce.bigint(),
  stakingProviderAdmin: z.string().startsWith("0x").length(42),
  attesters: z.array(ScraperAttesterSchema),
  lastUpdated: z.string().datetime(),
  version: z.literal("1.0"),
});

export type ScraperConfig = z.infer<typeof ScraperConfigSchema>;
export type ScraperAttester = z.infer<typeof ScraperAttesterSchema>;

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
