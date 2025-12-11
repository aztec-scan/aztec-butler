# Plan: Fix --from-block Cache Behavior

## Goal

Make `--from-block` mode save results to cache (currently it doesn't).

## Current Behavior

```typescript
// Line 101-116 in scrape-coinbases.ts
else if (options.fromBlock !== undefined) {
  console.log(`Mode: Custom range (--from-block ${options.fromBlock})`);
  const mappings = await scraper.scrapeRange(options.fromBlock, currentBlock);
  result = {
    mappings,
    startBlock: options.fromBlock,
    endBlock: currentBlock,
    newMappings: mappings.length,
    updatedMappings: 0,
  };
  // ❌ Never calls saveCoinbaseCache()!
}
```

## Problem

- Results are printed but never saved
- User expects cache to be updated
- Inconsistent with `--full` and incremental modes

## Proposed Solution

### Option A: Save to Cache (Recommended)

Update `--from-block` mode to merge and save like other modes:

```typescript
else if (options.fromBlock !== undefined) {
  console.log(`Mode: Custom range (--from-block ${options.fromBlock})`);

  // Load existing cache
  const existingCache = await loadCoinbaseCache(options.network);
  const scrapedMappings = await scraper.scrapeRange(options.fromBlock, currentBlock);

  // Merge with existing (if any)
  const mergeResult = existingCache
    ? mergeMappings(existingCache.mappings, scrapedMappings)
    : { merged: scrapedMappings, newCount: scrapedMappings.length, updatedCount: 0 };

  // Save updated cache
  const cache = {
    network: options.network,
    stakingProviderId: providerId,
    lastScrapedBlock: currentBlock,
    mappings: mergeResult.merged,
    scrapedAt: new Date().toISOString(),
    version: "1.0",
  };
  await saveCoinbaseCache(cache, options.outputPath);

  result = {
    mappings: mergeResult.merged,
    startBlock: options.fromBlock,
    endBlock: currentBlock,
    newMappings: mergeResult.newCount,
    updatedMappings: mergeResult.updatedCount,
  };
}
```

## Use Case

**Manual Testing & Recovery:**

- Test scraping from specific block without full rescrape
- Recover from interruption at known block
- Debug specific block ranges
- Update cache after manual fixes

## Alternative: Add to CoinbaseScraper

Could add `scrapeFromBlock()` method to CoinbaseScraper that handles caching:

```typescript
async scrapeFromBlock(fromBlock: bigint): Promise<ScrapeResult>
```
