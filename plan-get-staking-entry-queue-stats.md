# Plan: Get Staking Entry Queue Statistics

**LOW PRIORITY, it's currently available on Dashtec**

## Goal

Provide statistics about the staking entry queue, including:

- How many attesters are currently in the queue
- How many can be flushed in the next epoch
- Estimated time for the last attester in queue to become active

## Available Contract Methods

### Queue Information

From Rollup contract (IStaking interface):

1. **`getEntryQueueLength()`** → Returns total number of attesters waiting in queue
2. **`getEntryQueueAt(index)`** → Returns DepositArgs for specific queue position
3. **`getAvailableValidatorFlushes()`** → How many validators can be flushed from queue now
4. **`getNextFlushableEpoch()`** → When the next flush can occur (Epoch number)

### Flush Size Calculation

5. **`getEntryQueueFlushSize()`** → Max number of validators that can be added from queue
   - Based on queue configuration and current validator set size
   - Implements three-phase management (bootstrap, growth, normal)
   - See StakingLib.sol:549-597 for detailed logic

### Current State

6. **`getActiveAttesterCount()`** → Current number of active attesters
7. **`getIsBootstrapped()`** → Whether bootstrap phase is complete

## Queue Flush Logic

From `StakingLib.sol:549-597`, the flush size depends on:

### Bootstrap Phase

- If no active validators exist and queue < bootstrapValidatorSetSize → flush = 0 (waiting for minimum)
- If active validators < bootstrapValidatorSetSize → flush = bootstrapFlushSize (large initial batch)

### Normal Phase (after bootstrap)

- flush = max(activeCount / normalFlushSizeQuotient, normalFlushSizeMin)
- Capped by maxQueueFlushSize

**Key insight:** Flushes happen once per epoch, and the amount varies based on:

- Current active validator count
- Bootstrap status
- Queue configuration parameters

## Time Estimation

To estimate time for last attester to become active:

1. **Get current queue length** and **available flushes**
2. **Calculate epochs needed**:
   - Simple case: `ceil(queueLength / flushSize)` epochs
   - Complex: Account for growing validator set (flush size increases as set grows)
3. **Convert epochs to time**:
   - Need epoch duration from rollup config
   - Time = epochs × epochDuration

**Challenges:**

- Flush size increases as validator set grows (normal phase calculation)
- Bootstrap phase has different rules
- Config can be changed by governance
- Not all queued deposits may succeed (some might fail)

## Implementation Plan

### Add Methods to EthereumClient.ts

```typescript
// Queue methods (already in plan-scrape-staking-queue-and-active-validators.md)
getEntryQueueLength();
getAvailableValidatorFlushes();
getNextFlushableEpoch();
getEntryQueueFlushSize();
getIsBootstrapped();

// Time/config methods
getEpochDuration(); // Get from rollup config
getCurrentEpoch(); // Current epoch number
```

### Create CLI Command: `get-queue-stats`

**Output:**

```
Entry Queue Statistics:
  Queue Length: 50 attesters
  Next Flushable Epoch: 42 (in ~2 hours)
  Available Flushes Now: 5 attesters
  Flush Size Per Epoch: 5 attesters

  Bootstrap Status: Completed
  Current Active Attesters: 100

Estimated Time to Clear Queue:
  Epochs Needed: ~10 epochs (simplified calculation)
  Estimated Time: ~20 hours

  Note: Actual time may vary as flush size increases with validator set growth.

Queue Positions (first 5):
  Position 0: 0x123...
  Position 1: 0x456...
  Position 2: 0x789...
  ...
```

### Calculation Approach

**Simple Estimate (recommended for MVP):**

```typescript
const queueLength = await getEntryQueueLength();
const flushSize = await getEntryQueueFlushSize();
const epochsNeeded = Math.ceil(queueLength / flushSize);
const epochDuration = await getEpochDuration();
const estimatedTime = epochsNeeded * epochDuration;
```

**Advanced Estimate (future enhancement):**

- Simulate validator set growth over time
- Account for dynamic flush size calculation
- Consider bootstrap vs normal phase transitions

## Use Cases

- Operators: Check how long until their attester becomes active
- Monitoring: Track queue backlog and processing rate
- Capacity planning: Understand validator onboarding throughput
- Debug: Identify if queue is stuck or processing normally

## Notes

- This is a point-in-time estimate; actual timing depends on:
  - Flush calls being made each epoch
  - No governance config changes
  - All deposits succeeding
- Queue configuration can be updated by governance (updateStakingQueueConfig)
- The estimate becomes more accurate when validator set is in normal phase with stable growth
