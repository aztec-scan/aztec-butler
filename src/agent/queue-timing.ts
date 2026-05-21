/**
 * Entry-queue timing helpers, shared by the global-stats scraper and the
 * per-host entry-queue ETA scraper.
 *
 * The "time per attester" is how long one attester takes to advance from the
 * rollup entry queue to active: `epochDuration / flushSize`, with the epoch
 * duration converted from L2 slots to seconds using the current L2 block time.
 */

import type { EthereumClient } from "../core/components/EthereumClient.js";

/** Fallback L2 block time (seconds) when Aztecscan is unreachable. */
export const DEFAULT_L2_BLOCK_TIME_SEC = 36;

/** Fetch average L2 block time (ms) from Aztecscan; `null` on any failure. */
export async function fetchL2BlockTimeMs(): Promise<number | null> {
  try {
    const response = await fetch(
      "https://api.aztecscan.xyz/v1/temporary-api-key/l2/stats/average-block-time",
      { signal: AbortSignal.timeout(5000) },
    );
    if (!response.ok) return null;
    const parsed: unknown = JSON.parse(await response.text());
    const blockTimeMs = typeof parsed === "string" ? Number(parsed) : parsed;
    return typeof blockTimeMs === "number" && isFinite(blockTimeMs) && blockTimeMs > 0
      ? blockTimeMs
      : null;
  } catch {
    return null;
  }
}

/**
 * Seconds for one attester to advance from the entry queue to active.
 * Returns 0 when not computable (flushSize 0 — e.g. not bootstrapped).
 *
 * Pure function — unit tested.
 */
export function computeTimePerAttester(
  epochDurationSlots: bigint,
  flushSize: bigint,
  blockTimeSec: number,
): number {
  if (flushSize <= 0n) return 0;
  return (Number(epochDurationSlots) * blockTimeSec) / Number(flushSize);
}

export interface QueueTiming {
  blockTimeSec: number;
  /** Seconds per attester to advance from entry queue to active; 0 when not computable. */
  timePerAttesterSeconds: number;
}

/**
 * Read epoch duration + entry-queue flush size from the rollup, combine with
 * the current L2 block time, and derive the queue-drain rate.
 */
export async function computeQueueTiming(eth: EthereumClient): Promise<QueueTiming> {
  const blockTimeMs = await fetchL2BlockTimeMs();
  const blockTimeSec = blockTimeMs ? blockTimeMs / 1000 : DEFAULT_L2_BLOCK_TIME_SEC;
  const [epochDurationSlots, flushSize] = await Promise.all([
    eth.getEpochDuration(),
    eth.getEntryQueueFlushSize(),
  ]);
  return {
    blockTimeSec,
    timePerAttesterSeconds: computeTimePerAttester(epochDurationSlots, flushSize, blockTimeSec),
  };
}
