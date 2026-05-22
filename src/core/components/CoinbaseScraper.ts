import { parseAbiItem } from "viem";
import type { EthereumClient } from "./EthereumClient.js";
import {
  loadCoinbaseCache,
  saveCoinbaseCache,
} from "../utils/scraperConfigOperations.js";
import type {
  CoinbaseMappingCache,
  MappedCoinbase,
} from "../../types/scraper-config.js";

const STAKED_WITH_PROVIDER_EVENT = parseAbiItem(
  "event StakedWithProvider(uint256 indexed providerIdentifier, address indexed rollupAddress, address indexed attester, address coinbaseSplitContractAddress, address stakerImplementation)",
);

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export interface CoinbaseScraperOptions {
  network: string;
  ethClient: EthereumClient;
  providerId: bigint;
  attesterAddresses: string[];
  defaultStartBlock: bigint;
  outputPath?: string;
}

export interface ScrapeResult {
  mappings: MappedCoinbase[];
  startBlock: bigint;
  endBlock: bigint;
  newMappings: number;
  updatedMappings: number;
  conflictBlock?: bigint;
}

export class CoinbaseScraperError extends Error {
  constructor(
    message: string,
    public readonly conflictBlock?: bigint,
  ) {
    super(message);
    this.name = "CoinbaseScraperError";
  }
}

/**
 * Shared component for scraping coinbase addresses from StakingRegistry events.
 *
 * This uses event-based scraping (StakedWithProvider events) which requires an
 * archive node for historical data.
 */
export class CoinbaseScraper {
  constructor(private options: CoinbaseScraperOptions) { }

  /**
   * Scrape coinbase addresses incrementally from last scraped block to current.
   * If no cache exists, performs a full scrape automatically.
   */
  async scrapeIncremental(): Promise<ScrapeResult> {
    console.log("\n=== Incremental Coinbase Scrape ===\n");

    // Try to load existing cache
    const existingCache = await loadCoinbaseCache(this.options.network);

    if (!existingCache) {
      console.log("No existing cache found, performing full scrape...");
      return await this.scrapeFull();
    }

    const startBlock = existingCache.lastScrapedBlock + 1n;
    const currentBlock = await this.options.ethClient.getArchiveBlockNumber();

    if (startBlock > currentBlock) {
      console.log(
        `Cache is up to date (last scraped: ${existingCache.lastScrapedBlock}, current: ${currentBlock})`,
      );
      return {
        mappings: existingCache.mappings,
        startBlock: existingCache.lastScrapedBlock,
        endBlock: currentBlock,
        newMappings: 0,
        updatedMappings: 0,
      };
    }

    console.log(`Scraping from block ${startBlock} to ${currentBlock}`);
    console.log(
      `Incremental range: ${currentBlock - startBlock + 1n} blocks\n`,
    );

    // Scrape the incremental range
    const newMappings = await this.scrapeRange(startBlock, currentBlock);

    // Merge with existing cache
    const mergeResult = this.mergeMappings(
      existingCache.mappings,
      newMappings,
      false, // not a full rescrape
    );

    // Save updated cache
    const cache: CoinbaseMappingCache = {
      network: this.options.network,
      stakingProviderId: this.options.providerId,
      lastScrapedBlock: currentBlock,
      mappings: mergeResult.merged,
      scrapedAt: new Date().toISOString(),
      version: "1.0",
    };

    const outputPath = await saveCoinbaseCache(cache, this.options.outputPath);
    console.log(`\n✅ Cache updated: ${outputPath}`);

    return {
      mappings: mergeResult.merged,
      startBlock,
      endBlock: currentBlock,
      newMappings: mergeResult.newCount,
      updatedMappings: mergeResult.updatedCount,
    };
  }

  /**
   * Perform a full scrape from the default start block to current.
   * Validates against existing cache if it exists.
   */
  async scrapeFull(): Promise<ScrapeResult> {
    console.log("\n=== Full Coinbase Scrape ===\n");

    const startBlock = this.options.defaultStartBlock;
    const currentBlock = await this.options.ethClient.getArchiveBlockNumber();

    console.log(`Scraping from block ${startBlock} to ${currentBlock}`);
    console.log(`Full range: ${currentBlock - startBlock + 1n} blocks\n`);

    // Scrape the full range
    const scrapedMappings = await this.scrapeRange(startBlock, currentBlock);

    // Check if cache exists for validation
    const existingCache = await loadCoinbaseCache(this.options.network);

    let finalMappings: MappedCoinbase[];
    let newCount = 0;
    let updatedCount = 0;

    if (existingCache) {
      console.log("\nValidating against existing cache...");
      const mergeResult = this.mergeMappings(
        existingCache.mappings,
        scrapedMappings,
        true, // is a full rescrape - strict validation
      );
      finalMappings = mergeResult.merged;
      newCount = mergeResult.newCount;
      updatedCount = mergeResult.updatedCount;
      console.log("✅ Validation passed");
    } else {
      console.log("\nNo existing cache to validate against");
      finalMappings = scrapedMappings;
      newCount = scrapedMappings.length;
    }

    // Save cache
    const cache: CoinbaseMappingCache = {
      network: this.options.network,
      stakingProviderId: this.options.providerId,
      lastScrapedBlock: currentBlock,
      mappings: finalMappings,
      scrapedAt: new Date().toISOString(),
      version: "1.0",
    };

    const outputPath = await saveCoinbaseCache(cache, this.options.outputPath);
    console.log(`\n✅ Cache saved: ${outputPath}`);

    return {
      mappings: finalMappings,
      startBlock,
      endBlock: currentBlock,
      newMappings: newCount,
      updatedMappings: updatedCount,
    };
  }

  /**
   * Scrape a specific block range.
   */
  async scrapeRange(
    fromBlock: bigint,
    toBlock: bigint,
  ): Promise<MappedCoinbase[]> {
    const stakingRegistryAddress =
      this.options.ethClient.getStakingRegistryAddress();

    console.log(`Staking Registry: ${stakingRegistryAddress}`);

    const attesterSet = new Set(
      this.options.attesterAddresses.map((addr) => addr.toLowerCase()),
    );
    // Empty attester list = discover-all mode: the StakedWithProvider getLogs
    // is already filtered by providerIdentifier, so every event belongs to us.
    const discoverAll = attesterSet.size === 0;

    // Chunked, rate-limit-retrying getLogs on the archive node. A non-rate-limit
    // RPC error fails loud rather than being silently retried.
    const logs = await this.options.ethClient.getArchiveEventLogs({
      address: stakingRegistryAddress,
      event: STAKED_WITH_PROVIDER_EVENT,
      args: { providerIdentifier: this.options.providerId },
      fromBlock,
      toBlock,
    });
    console.log(`  Found ${logs.length} StakedWithProvider event(s)`);

    const mappings: MappedCoinbase[] = [];
    for (const log of logs) {
      const attester = log.args.attester!;
      const coinbase = log.args.coinbaseSplitContractAddress!;

      // Include attesters we're tracking (or all, in discover-all mode)
      if (discoverAll || attesterSet.has(attester.toLowerCase())) {
        const timestamp = await this.options.ethClient.getArchiveBlockTimestamp(
          log.blockNumber,
        );

        mappings.push({
          attesterAddress: attester,
          coinbaseAddress: coinbase,
          blockNumber: log.blockNumber,
          blockHash: log.blockHash,
          timestamp: Number(timestamp),
        });

        console.log(`    ✅ ${attester} -> ${coinbase}`);
      }
    }

    console.log(`\n✅ Found ${mappings.length} coinbase mapping(s)`);

    return mappings;
  }

  /**
   * Merge new mappings with existing cache.
   * Validates for conflicts and applies appropriate merge strategy.
   */
  private mergeMappings(
    existingMappings: MappedCoinbase[],
    newMappings: MappedCoinbase[],
    _isFullRescrape: boolean,
  ): {
    merged: MappedCoinbase[];
    newCount: number;
    updatedCount: number;
  } {
    const existingMap = new Map<string, MappedCoinbase>();
    for (const mapping of existingMappings) {
      existingMap.set(mapping.attesterAddress.toLowerCase(), mapping);
    }

    let newCount = 0;
    let updatedCount = 0;
    let conflictBlock: bigint | undefined;

    for (const newMapping of newMappings) {
      const attesterKey = newMapping.attesterAddress.toLowerCase();
      const existing = existingMap.get(attesterKey);

      if (!existing) {
        // New attester - add it
        existingMap.set(attesterKey, newMapping);
        newCount++;
        continue;
      }

      const existingCoinbase = existing.coinbaseAddress.toLowerCase();
      const newCoinbase = newMapping.coinbaseAddress.toLowerCase();

      // Case 1: Same coinbase - update to latest block/timestamp
      if (existingCoinbase === newCoinbase) {
        if (newMapping.blockNumber > existing.blockNumber) {
          existingMap.set(attesterKey, newMapping);
          updatedCount++;
        }
        continue;
      }

      // Case 2: Existing is zero address - always override
      if (existingCoinbase === ZERO_ADDRESS.toLowerCase()) {
        console.log(
          `  Overriding zero address for ${newMapping.attesterAddress}`,
        );
        console.log(`    ${ZERO_ADDRESS} -> ${newMapping.coinbaseAddress}`);
        existingMap.set(attesterKey, newMapping);
        updatedCount++;
        continue;
      }

      // Case 3: New is zero address - keep existing non-zero
      if (newCoinbase === ZERO_ADDRESS.toLowerCase()) {
        console.log(
          `  Keeping existing non-zero coinbase for ${newMapping.attesterAddress}`,
        );
        // Don't update
        continue;
      }

      // Case 4: Different non-zero coinbases - CONFLICT!
      conflictBlock = newMapping.blockNumber;
      throw new CoinbaseScraperError(
        `\n❌ FATAL: Coinbase conflict detected for ${newMapping.attesterAddress}!\n` +
        `  Cached:  ${existing.coinbaseAddress} (block ${existing.blockNumber})\n` +
        `  Scraped: ${newMapping.coinbaseAddress} (block ${newMapping.blockNumber})\n` +
        `  Conflict detected at block: ${conflictBlock}\n` +
        `\n` +
        `This indicates a serious problem. Coinbase addresses should not change.\n` +
        `Please investigate manually before proceeding.`,
        conflictBlock,
      );
    }

    const merged = Array.from(existingMap.values());

    console.log(
      `\nMerge summary: ${newCount} new, ${updatedCount} updated, ${merged.length} total`,
    );

    return {
      merged,
      newCount,
      updatedCount,
    };
  }
}
