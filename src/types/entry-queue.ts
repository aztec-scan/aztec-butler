/**
 * Entry Queue Types
 *
 * Types for entry queue statistics and timing estimates
 */

/**
 * Entry queue statistics with time-based estimates
 */
export type EntryQueueStats = {
  // Global queue stats
  totalQueueLength: bigint;
  currentEpoch: bigint;
  epochDuration: bigint; // in seconds (converted from L2 slots: slots * 30)
  flushSize: bigint;
  availableFlushes: bigint;
  nextFlushableEpoch: bigint;
  isBootstrapped: boolean;
  timePerAttester: number; // seconds per attester

  // Global timing (epoch timestamp in seconds)
  lastAttesterEstimatedEntryTimestamp: number; // Unix timestamp (seconds)

  // Provider-specific stats (filtered by our provider ID)
  providerId: bigint | null;
  providerQueueCount: number; // Total attesters from our provider in queue
  providerNextAttesterArrivalTimestamp: number | null; // Unix timestamp
  providerNextMissingCoinbaseArrivalTimestamp: number | null; // Unix timestamp
  providerNextMissingCoinbaseAddress: string | null; // Address of next attester missing coinbase
  providerLastAttesterArrivalTimestamp: number | null; // Unix timestamp

  lastUpdated: Date;
};
