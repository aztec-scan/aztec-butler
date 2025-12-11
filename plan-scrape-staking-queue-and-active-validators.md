# Plan: Scrape Staking Queue and Active Validators

## Goal

Discover coinbase addresses by checking on-chain validator state instead of relying only on event scraping.

## Current Behavior

- **CoinbaseScraper**: Scrapes `StakedWithProvider` events from StakingRegistry (event-based)
- **RollupScraper**: Checks `getAttesterView()` for each attester from scraper config
- No connection between rollup state and coinbase discovery

## Problem

Event-based scraping has limitations:

- Misses attesters added before we started monitoring
- Requires archive node for historical events
- Events might be missed if RPC has issues

## Proposed Approach

### Query On-Chain State Directly

Instead of (or in addition to) event scraping:

1. **Query Staking Provider Queue**
   - Get all attesters queued to join provider
   - For each attester, query their registration data including coinbase

2. **Query Active Validators**
   - Get current committee/active validator set from AztecRollupContract
   - For each validator, query their coinbase from StakingRegistry
   - Match validators to our staking provider

3. **Compare with Cache**
   - Merge on-chain state with event-scraped cache
   - Validate consistency
   - Update missing coinbases

## Implementation Notes

**Key Methods Needed:**

- `StakingRegistry.getAttester(address)` - Get attester registration data
- `StakingRegistry.getProvidersInQueue(providerId)` - Get queued attesters
- `AztecRollup.getCurrentCommittee()` or similar - Get active validators
- Cross-reference with staking provider attesters

**Integration with CoinbaseScraper:**
Add comment/reference in `CoinbaseScraper.ts`:

```typescript
/**
 * Shared component for scraping coinbase addresses from StakingRegistry events.
 *
 * NOTE: This is event-based scraping. For an alternative approach that queries
 * on-chain state directly (queue + active validators), see:
 * plan-scrape-staking-queue-and-active-validators.md
 */
```

## Benefits

- Discover attesters without historical event scraping
- Works with regular RPC nodes (no archive needed)
- Validates event-scraped data against on-chain truth
- Can recover from missing events

## Use Cases

- Initial setup without full event scraping
- Validation of event-scraped cache
- Recovery from missed events
- Monitoring for unexpected attesters
