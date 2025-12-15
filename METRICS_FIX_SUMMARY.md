# Metrics Fix - Complete Implementation

## Problem Summary

**Symptom:** Attester state metrics didn't match reality
- Metrics showed: 82 in `ROLLUP_ENTRY_QUEUE`, 30 in `IN_STAKING_PROVIDER_QUEUE`
- Reality (on-chain): 102 in entry queue, 10 in provider queue
- **20 attesters were stuck in the wrong state**

## Root Causes Found

### 1. State Machine Was Coin base-Dependent ❌
The state machine used coinbase configuration to trigger transitions. This is wrong - state should be **purely from on-chain data**.

### 2. Incomplete Transition Logic ❌  
When attesters left the provider queue, they didn't transition unless they had a coinbase configured.

## Solution Implemented

### Part 1: Debug Logging & Monitoring
Added comprehensive logging to diagnose issues:
- Prometheus scrape request logging
- Metrics callback invocation logging  
- State data read logging
- New staleness metrics to detect stale data

### Part 2: Fixed State Machine (Main Fix)
**Completely rewrote state transitions to be purely on-chain based:**

```typescript
// OLD (Broken - coinbase dependent)
case IN_STAKING_PROVIDER_QUEUE:
  if (hasCoinbase) {
    transition_to(ROLLUP_ENTRY_QUEUE);
  }
  // Stays stuck if no coinbase!

// NEW (Fixed - purely on-chain)
case IN_STAKING_PROVIDER_QUEUE:
  if (!isInProviderQueue) {
    if (onChainView.status === VALIDATING) {
      transition_to(ACTIVE);
    } else if (onChainView.status === NONE) {
      transition_to(ROLLUP_ENTRY_QUEUE);
    }
  }
```

## New State Machine (On-Chain Only)

States are now **purely derived from on-chain data**:

- **NEW**: Not in any on-chain queue
- **IN_STAKING_PROVIDER_QUEUE**: In `stakingProvider.queue[]` (from staking contract)
- **ROLLUP_ENTRY_QUEUE**: Has `onChainView` with `status = NONE` (in queue, not yet validating)
- **ACTIVE**: Has `onChainView` with `status = VALIDATING`
- **NO_LONGER_ACTIVE**: Has `onChainView` with `status = ZOMBIE or EXITING`

**Coinbase configuration is now completely separate from state - tracked independently for operational awareness only.**

## Files Changed

1. `src/server/state/transitions.ts` - **Complete rewrite** (on-chain only state machine)
2. `src/server/scrapers/staking-provider-scraper.ts` - Removed coinbase dependency
3. `src/server/metrics/*.ts` - Added debug logging + staleness metrics
4. `src/server/state/index.ts` - Added state access logging

## Deployment & Testing

### Deploy
```bash
cd /path/to/aztec-butler
npm run build
sudo systemctl restart aztec-butler
```

### Verify Fix
Within 60 seconds, you should see:
```
[mainnet] Attester 0x... left provider queue, now in rollup entry queue
[staking-provider] Attester States: ProviderId 4
  IN_STAKING_PROVIDER_QUEUE: 10      ← Fixed! (was 30)
  ROLLUP_ENTRY_QUEUE: 102            ← Fixed! (was 82)
```

### New Metrics Available
```
aztec_butler_attester_states_last_updated_timestamp  
aztec_butler_entry_queue_last_scraped_timestamp
aztec_butler_staking_provider_last_scraped_timestamp
```

Use these to set up staleness alerts in Prometheus.

## Rollback
```bash
git revert HEAD && npm run build && sudo systemctl restart aztec-butler
```
