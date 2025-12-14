# Plan: Entry Queue Time Statistics - Metrics & CLI

**Priority:** LOW (currently available on Dashtec)

**NO backwards compatibility or migration required - fresh implementation**

## Goal

Provide entry queue time statistics to simplify coinbase update decisions. The focus is on **provider-specific queue metrics** with time estimates for when attesters will become active.

## Required Statistics (from README)

1. **Time per attester entry** - Average time for an attester to move from queue to active
2. **Total attesters in queue** - Global entry queue length
3. **Last attester in total queue estimated date for entry** - When the last attester in global queue will become active
4. **Provider's total attesters in queue** - How many of our attesters are waiting
5. **Provider's next attester arrival (date)** - When the next attester from our provider will become active
6. **Provider's next attester, missing coinbase, arrival (date)** - When the next attester **without a coinbase** will become active (most important for operations)
7. **Provider's last attester arrival (date)** - When our last queued attester will become active

## Key Implementation Insight

The system already tracks:

- **Staking Provider Queue** (via `StakingProviderScraper`) - Attesters registered to a staking provider, waiting in the StakingProviderRegistry to be selected (FIFO queue). Once dequeued from this provider queue, they enter the global Entry Queue.
- **Entry Queue** (global rollup queue) - Attesters that have been dequeued from their StakingProviderRegistry queue and are now waiting to become active validators. This is the protocol-level queue for attesters about to start validating blocks.
- **Active attesters** - Currently validating attesters
- **Coinbase mapping** (via `getAttesterCoinbaseInfo`) - Which attesters have coinbase addresses configured

The new feature needs to **combine these data sources** with **time calculations** to produce actionable statistics.

**Queue Flow:**

```
Staking Provider Queue → Entry Queue → Active Validators
(StakingProviderRegistry)  (Rollup contract)  (Validating blocks)
```

## Configuration

- **Scrape interval**: 10 minutes (600 seconds) - consistent with other scrapers
- **Startup behavior**: Wait one poll interval before first scrape (allows other scrapers to populate data)
- **State persistence**: Stats are persisted to state/DB (survives restarts)
- **Multi-network**: Support both testnet and mainnet with separate metrics per network
- **Metrics format**: Use epoch timestamps (seconds since Unix epoch), not date strings

## Architecture

### 1. Add Missing EthereumClient Methods

**File:** `src/core/components/EthereumClient.ts`

Add contract query methods (following existing pattern):

```typescript
/**
 * Get how many validators can be flushed from queue now
 */
async getAvailableValidatorFlushes(): Promise<bigint> {
  const rollupContract = this.getRollupContract();
  return await rollupContract.read.getAvailableValidatorFlushes();
}

/**
 * Get the next epoch when flush can occur
 */
async getNextFlushableEpoch(): Promise<bigint> {
  const rollupContract = this.getRollupContract();
  return await rollupContract.read.getNextFlushableEpoch();
}

/**
 * Get max number of validators that can be added from queue
 */
async getEntryQueueFlushSize(): Promise<bigint> {
  const rollupContract = this.getRollupContract();
  return await rollupContract.read.getEntryQueueFlushSize();
}

/**
 * Check if bootstrap phase is complete
 */
async getIsBootstrapped(): Promise<boolean> {
  const rollupContract = this.getRollupContract();
  return await rollupContract.read.getIsBootstrapped();
}

/**
 * Get epoch duration from rollup config (in seconds)
 */
async getEpochDuration(): Promise<bigint> {
  const rollupContract = this.getRollupContract();
  return await rollupContract.read.getEpochDuration();
}

/**
 * Get current epoch number
 */
async getCurrentEpoch(): Promise<bigint> {
  const rollupContract = this.getRollupContract();
  return await rollupContract.read.getCurrentEpoch();
}
```

### 2. Create Entry Queue Scraper

**New File:** `src/server/scrapers/entry-queue-scraper.ts`

- Scrapes entry queue data from rollup contract
- Calculates time-based statistics
- Stores results in state for metrics consumption
- Combines data from: global entry queue, provider queue, and coinbase info
- Pattern: Similar to `StakingProviderScraper` and `RollupScraper`

**Data structure:**

```typescript
type EntryQueueStats = {
  // Global queue stats
  totalQueueLength: bigint;
  currentEpoch: bigint;
  epochDuration: bigint; // in seconds
  flushSize: bigint;
  availableFlushes: bigint;
  nextFlushableEpoch: bigint;
  isBootstrapped: boolean;
  timePerAttester: number; // seconds per attester

  // Global timing (epoch timestamp)
  lastAttesterEstimatedEntryTimestamp: number; // Unix timestamp (seconds)

  // Provider-specific stats (filtered by our provider ID)
  providerId: bigint | null;
  providerQueueCount: number; // Total attesters from our provider in queue
  providerNextAttesterArrivalTimestamp: number | null; // Unix timestamp
  providerNextMissingCoinbaseArrivalTimestamp: number | null; // Unix timestamp
  providerLastAttesterArrivalTimestamp: number | null; // Unix timestamp

  lastUpdated: Date;
};
```

**Calculation logic:**

- **Time per attester**: `(epochDuration) / flushSize` seconds
- **Position in queue**: Find index of attester address in global entry queue
- **Arrival timestamp**: `Math.floor(Date.now() / 1000) + (position * timePerAttester)`
- **Missing coinbase**: Filter attesters using `getAttesterCoinbaseInfo()` from state

**Scraper behavior:**

- Fetch global entry queue using existing `EthereumClient.getAllQueuedAttesters()` method
- Get provider queue from state: `getStakingProviderData(network)` (already populated by StakingProviderScraper)
- Get coinbase info from state: `getAttesterCoinbaseInfo(network)` (from scraper config)
- Cross-reference to find which of our provider's attesters are in the entry queue and their positions
- Calculate arrival timestamps for next/last attesters
- Identify the NEXT attester missing a coinbase (not all of them)
- Store in state via `updateEntryQueueStats(network, stats)`

### 3. Create Entry Queue Metrics

**New File:** `src/server/metrics/entry-queue-metrics.ts`

Following the pattern from other metrics files, expose observable gauges with epoch timestamps.

**Metric naming convention:** All metrics follow the pattern `aztec_butler_<metric_name>` (automatically prepended by the registry's `createObservableGauge` helper).

```typescript
// Metrics (all use epoch timestamps in seconds)

aztec_butler_entry_queue_length;
// Total attesters waiting in entry queue
// Labels: network

aztec_butler_entry_queue_time_per_attester_seconds;
// Average seconds per attester to move from queue to active
// Value is 0 when queue is empty
// Labels: network

aztec_butler_entry_queue_last_attester_timestamp;
// Unix timestamp when last attester in global queue will become active
// NOT REPORTED when queue is empty (metric series not exposed)
// Labels: network

aztec_butler_entry_queue_provider_count;
// Number of attesters from our provider in entry queue
// Labels: network, staking_provider_id

aztec_butler_entry_queue_provider_next_arrival_timestamp;
// Unix timestamp when next attester from our provider becomes active
// NOT REPORTED when no provider attesters in queue
// Labels: network, staking_provider_id

aztec_butler_entry_queue_provider_next_missing_coinbase_timestamp;
// Unix timestamp when NEXT attester WITHOUT coinbase becomes active
// Only exposes the single next attester missing coinbase (not all)
// NOT REPORTED when no attesters missing coinbase
// Labels: network, staking_provider_id, attester_address
// ⚠️ Most critical metric for operations

aztec_butler_entry_queue_provider_last_arrival_timestamp;
// Unix timestamp when last attester from our provider becomes active
// NOT REPORTED when no provider attesters in queue
// Labels: network, staking_provider_id
```

**Metric attributes (labels):**

- `network` - testnet/mainnet (Aztec network names)
- `staking_provider_id` - Provider ID (as string, e.g., "42")
- `attester_address` - For the missing coinbase metric only (the specific attester address)

**Null/Empty handling:**

- **Time per attester**: Reports `0` when queue is empty (no division by zero)
- **Timestamp metrics**: NOT REPORTED (metric series not exposed) when queue is empty or no provider attesters exist
- This follows Prometheus best practices: don't report timestamps that don't exist

**Note on timestamps:**

- All timestamps are Unix epoch in **seconds** (not milliseconds)
- Use `Math.floor(Date.now() / 1000)` for current time
- Prometheus convention is seconds since epoch

### 4. Update State Management

**File:** `src/server/state/index.ts`

Add entry queue stats to NetworkState:

```typescript
export type NetworkState = {
  stakingProviderData: StakingProviderData | null;
  scraperConfig: ScraperConfig | null;
  attesterStates: AttesterStateMap;
  publisherData: PublisherDataMap | null;
  stakingRewardsData: StakingRewardsMap | null;
  stakingRewardsHistory: StakingRewardsSnapshot[];
  entryQueueStats: EntryQueueStats | null; // NEW
};

/**
 * Update entry queue stats from scraper
 */
export const updateEntryQueueStats = (
  network: string,
  stats: EntryQueueStats | null,
) => {
  const state = getNetworkState(network);
  state.entryQueueStats = stats;
};

/**
 * Get entry queue stats
 */
export const getEntryQueueStats = (network: string): EntryQueueStats | null => {
  const state = getNetworkState(network);
  return state.entryQueueStats;
};
```

**Note:** No persistence needed beyond in-memory state. Stats are recalculated on each scrape and after restart.

### 5. Create CLI Command

**New File:** `src/cli/commands/get-queue-stats.ts`

**Command:** `npm run cli -- get-queue-stats [--json]`

**Human-readable output format:**

```
=== Entry Queue Statistics ===

Network: mainnet
Provider ID: 42

📊 Global Queue Status:
  Total Attesters in Queue: 150
  Current Epoch: 1234
  Epoch Duration: 1 hour
  Flush Size per Epoch: 10 attesters
  Time per Attester: ~6 minutes

  ⏰ Last Attester Estimated Entry: 2025-12-15 18:30:00 UTC (in 15 hours)

🏢 Provider Queue Status:
  Your Attesters in Queue: 25

  ⏰ Next Attester Arrival: 2025-12-14 10:00:00 UTC (in 2 hours)

  ⚠️  Next Attester Missing Coinbase: 2025-12-14 12:30:00 UTC (in 4.5 hours)
      Address: 0x1234...5678
      ⚡ Action Required: Configure coinbase before activation

  ⏰ Last Attester Arrival: 2025-12-14 18:00:00 UTC (in 10 hours)

💡 Tip: Use 'npm run cli -- scrape-coinbases' to update coinbase configurations
```

**JSON output format (with `--json` flag):**

```json
{
  "network": "mainnet",
  "providerId": "42",
  "global": {
    "totalQueueLength": 150,
    "currentEpoch": 1234,
    "epochDuration": 3600,
    "flushSize": 10,
    "timePerAttester": 360,
    "lastAttesterTimestamp": 1734285000
  },
  "provider": {
    "queueCount": 25,
    "nextArrivalTimestamp": 1734277800,
    "nextMissingCoinbase": {
      "timestamp": 1734286200,
      "address": "0x1234...5678"
    },
    "lastArrivalTimestamp": 1734307200
  }
}
```

**Options:**

- `--json` - Output as JSON for scripting (default: false)

### 6. Register CLI Command

**File:** `cli.ts`

Add command registration:

```typescript
// Command: get-queue-stats
program
  .command("get-queue-stats")
  .description("Get entry queue statistics and timing estimates")
  .option("--json", "Output as JSON", false)
  .action(async (options: { json: boolean }) => {
    const globalOpts = program.opts();
    const config = await initConfig({ network: globalOpts.network });
    const ethClient = await initEthClient(config);

    await command.getQueueStats(ethClient, config, {
      network: config.NETWORK,
      json: options.json,
    });
  });
```

### 7. Initialize in Server

**File:** `src/server/index.ts`

Add entry queue scraper to scraper manager:

```typescript
import { EntryQueueScraper } from "./scrapers/entry-queue-scraper.js";
import { initEntryQueueMetrics } from "./metrics/entry-queue-metrics.js";

// In initServer():
const entryQueueScraper = new EntryQueueScraper(
  network,
  config,
  600000, // 10 minutes in milliseconds
);
scraperManager.registerScraper(entryQueueScraper);

// Initialize metrics (one time, handles all networks)
initEntryQueueMetrics();
```

## Time Calculation Details

### Simple Estimate (MVP Implementation)

```typescript
// Calculate time per attester
const timePerAttester = Number(epochDuration) / Number(flushSize); // seconds

// Find attester position in global queue
const attesterPosition = entryQueue.findIndex(
  (addr) => addr.toLowerCase() === attesterAddress.toLowerCase(),
);

// Calculate arrival timestamp (Unix epoch seconds)
const currentTimestamp = Math.floor(Date.now() / 1000);
const estimatedSeconds = attesterPosition * timePerAttester;
const arrivalTimestamp = currentTimestamp + Math.floor(estimatedSeconds);
```

### Provider Queue Analysis

```typescript
// 1. Get provider's attesters from state
const providerData = getStakingProviderData(network);
const providerQueue = providerData?.queue || [];

// 2. Get global entry queue
const globalQueue = await ethClient.getAllQueuedAttesters();

// 3. Find provider's attesters in global queue with positions
const providerAttestersInQueue = providerQueue
  .map((attesterAddr) => ({
    address: attesterAddr,
    position: globalQueue.findIndex(
      (addr) => addr.toLowerCase() === attesterAddr.toLowerCase(),
    ),
  }))
  .filter((item) => item.position !== -1) // Only those actually in entry queue
  .sort((a, b) => a.position - b.position);

// 4. Get coinbase info
const coinbaseInfo = getAttesterCoinbaseInfo(network);

// 5. Calculate timestamps
const nextAttester = providerAttestersInQueue[0];
const nextAttesterTimestamp = nextAttester
  ? currentTimestamp + Math.floor(nextAttester.position * timePerAttester)
  : null;

// 6. Find next attester missing coinbase
const nextMissingCoinbase = providerAttestersInQueue.find(
  (item) => !coinbaseInfo.get(item.address),
);
const nextMissingCoinbaseTimestamp = nextMissingCoinbase
  ? currentTimestamp +
    Math.floor(nextMissingCoinbase.position * timePerAttester)
  : null;

// 7. Last attester
const lastAttester =
  providerAttestersInQueue[providerAttestersInQueue.length - 1];
const lastAttesterTimestamp = lastAttester
  ? currentTimestamp + Math.floor(lastAttester.position * timePerAttester)
  : null;
```

### Edge Cases

- **Attester not in entry queue** → Skip (already active or still in provider queue, not yet in entry queue)
- **No provider configured** → Set provider stats to null, don't expose provider-specific metrics
- **Empty queue** →
  - `timePerAttester` = 0
  - Timestamp metrics are NOT REPORTED (series not exposed)
- **No provider attesters in entry queue** → Provider timestamp metrics NOT REPORTED
- **All attesters have coinbases** → `providerNextMissingCoinbaseArrivalTimestamp` NOT REPORTED
- **Bootstrap mode** → Use actual flush size from contract (handles different rules automatically)
- **Epoch transitions** → Timestamps recalculated on each scrape (every 10 min)

## Bootstrap Phase Clarification

The "bootstrap phase" mentioned in the original plan refers to the **blockchain's validator set bootstrap phase**, not the server startup. This is when the network is starting up and has fewer than the minimum required validators.

- The contract methods (`getEntryQueueFlushSize()`, `getIsBootstrapped()`) handle this automatically
- No special logic needed in the scraper
- The metrics will reflect whatever the contract returns
- **Server startup delay**: Wait one scrape interval (10 min) before first scrape to allow other scrapers to populate state

## Files to Create

1. **`src/server/scrapers/entry-queue-scraper.ts`** (~250 lines)
   - Scraper implementation
   - Data fetching and calculation logic
2. **`src/server/metrics/entry-queue-metrics.ts`** (~180 lines)
   - Metric definitions
   - Observable gauge callbacks
3. **`src/cli/commands/get-queue-stats.ts`** (~200 lines)
   - CLI command implementation
   - Human-readable and JSON output formatting

## Files to Modify

1. **`src/core/components/EthereumClient.ts`** - Add 6 new methods (~60 lines)
2. **`src/server/state/index.ts`** - Add entry queue state management (~40 lines)
3. **`src/server/scrapers/index.ts`** - Export new scraper (1 line)
4. **`src/server/metrics/index.ts`** - Export new metrics init (1 line)
5. **`src/cli/commands/index.ts`** - Export new command (1 line)
6. **`cli.ts`** - Register new command (~15 lines)
7. **`src/server/index.ts`** - Initialize scraper and metrics (~15 lines)

## Multi-Network Support

- **Two networks supported**: testnet and mainnet (Aztec network names)
- **One provider per network**: Each network config specifies its own provider
- **Separate metrics**: Each network gets its own metric series with `network` label
- **Prometheus labels**:
  - `network`: "testnet" or "mainnet"
  - `staking_provider_id`: Provider ID as string (e.g., "42")
  - `attester_address`: Only for missing coinbase metric

Example Prometheus query:

```promql
# Time until next attester missing coinbase (per network)
entry_queue_provider_next_missing_coinbase_timestamp{network="mainnet"} - time()

# Alerts can be configured on the receiving end (not in butler)
```

## Testing Approach

1. **Manual CLI testing**:
   - Run `npm run cli -- get-queue-stats` on testnet
   - Run with `--json` flag to verify JSON output
2. **Metrics verification**:
   - Check Prometheus endpoint `/metrics` for new metrics
   - Verify both testnet and mainnet metrics appear
   - Validate timestamp values are Unix epoch seconds
3. **State persistence**:
   - Verify stats survive scraper restarts
   - Check state is properly updated every 10 minutes
4. **Edge cases**:
   - Test with empty queue
   - Test with no provider configured
   - Test with all attesters having coinbases
   - Test with some attesters missing coinbases

## Implementation Notes

- **No special alerts**: Butler only exposes metrics; alerting is handled by Prometheus/receiving end
- **No historical tracking**: Only current estimates; no accuracy tracking over time
- **Timestamp format**: Always Unix epoch seconds (Prometheus standard)
- **Scrape interval**: 10 minutes (configurable via scraper constructor)
- **State only**: No file persistence for entry queue stats (recalculated after restart)
