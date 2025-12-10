# Coinbase Scraping Improvements Plan

## Overview

Implement incremental coinbase scraping to reduce scrape time from minutes to seconds for subsequent runs after initial full scrape.

## Current State

- CLI command `scrape-coinbases` always does full scrape from deployment block
- Cache file `{network}-mapped-coinbases.json` stores `lastScrapedBlock` but isn't used
- Full scrapes take several minutes (9.6M blocks on testnet, 23.8M on mainnet)
- Only CLI mode scrapes coinbases (server uses pre-generated configs)

## Implementation Plan

### 1. Create Shared CoinbaseScraper Component

**File:** `src/core/components/CoinbaseScraper.ts`

Reusable component with:

- `scrapeIncremental()`: Scrape from lastScrapedBlock + 1 to current
- `scrapeFull()`: Full scrape from deployment block
- `scrapeRange(fromBlock, toBlock)`: Scrape specific range
- `mergeMappings()`: Merge new mappings with existing cache
- `validateMappings()`: Validate no conflicts with existing data

### 2. Update CLI Command

**File:** `src/cli/commands/scrape-coinbases.ts`

Add CLI flags:

- Default (no flags): **Incremental scrape** from lastScrapedBlock
- `--full`: Force full rescrape from deployment block
- `--from-block <block>`: Manual block range control

### 3. Smart Merge Logic

**Merge Strategy:**

- Load existing cache mappings
- Scrape new events from `lastScrapedBlock + 1` to current
- For each new mapping:
  - If attester not in cache: Add new mapping
  - If attester in cache:
    - Same coinbase: Update to latest block/timestamp
    - Coinbase is `0x0000000000000000000000000000000000000000`: **Override** with new coinbase
    - Different non-zero coinbase: **THROW ERROR** and store current block

**Validation Rules:**

- When running `--full` with existing cache:
  - If any non-zero coinbase differs from cache: **THROW ERROR** and store current block
  - Zero address overwrites are always allowed
- All other cases: merge normally
- Log which block processing stopped at on error

### 4. Update Bash Scripts

**File:** `scripts/scrape-coinbases.sh`

Add support for passing flags:

```bash
# Default incremental
./scripts/scrape-coinbases.sh

# Full rescrape
./scripts/scrape-coinbases.sh --full

# From specific block
./scripts/scrape-coinbases.sh --from-block 12345678
```

## Architecture Decisions

### CLI-Only Scraping

- Server mode continues to use static scraper configs
- Operators control coinbase updates via CLI
- Coinbase changes are rare (only when adding new attesters)
- Keeps server simple and stateless

### Default Incremental Mode

- Most common use case: check for new attesters
- Dramatically faster (seconds vs minutes)
- Safe: validates against existing cache
- Can always force full rescrape with `--full`

### Error Handling for Conflicts

- Coinbase conflicts indicate serious issues
- Store block number where conflict detected
- Throw error to require manual investigation
- Exception: Zero address can always be overridden

### No Archive Node Changes

- Keep existing archive node requirement
- Future enhancement could add partial scraping with regular nodes
- Not in scope for this implementation

## Performance Impact

**Before:**

- Every run: Full scrape (minutes)
- Testnet: ~9.6M blocks
- Mainnet: ~23.8M blocks

**After:**

- First run: Full scrape (minutes) - creates cache
- Subsequent runs: Incremental (seconds) - ~1-100 blocks typically
- Can force full with `--full` flag

## Implementation Order

1. ✅ Write plan document
2. Create `CoinbaseScraper` shared component
3. Refactor CLI command to use shared component
4. Add CLI flags (`--full`, `--from-block`)
5. Implement merge logic with validation
6. Update bash script
7. Test incremental and full modes
8. Update project-stars-align/overview.md to mark as completed

## Testing Checklist

- [ ] Incremental scrape with existing cache (happy path)
- [ ] Full scrape with `--full` flag
- [ ] First-time scrape (no cache exists) - should auto full-scrape
- [ ] Conflict detection (non-zero coinbase differs)
- [ ] Zero address override works correctly
- [ ] Block number stored on error
- [ ] Merge updates block numbers and timestamps correctly
- [ ] Missing attesters warning still works

## Files Modified

- `src/core/components/CoinbaseScraper.ts` (NEW)
- `src/cli/commands/scrape-coinbases.ts` (MODIFY)
- `scripts/scrape-coinbases.sh` (MODIFY)
- `cli.ts` (MODIFY - add flag parsing)
- `project-stars-align/overview.md` (UPDATE - mark completed)
