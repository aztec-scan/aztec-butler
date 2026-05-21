/**
 * Rewards-ledger cursor — the small handoff/resume state.
 *
 * Holds the per-coinbase boundary balances (`Σ getSequencerRewards` at the last
 * processed block) plus the last processed block/date. The `--backfill` writes
 * it as its final act; the recurring exporter reads it to compute the next
 * day's `accrued = Δbalance + claims` and continues from there.
 *
 * It is small, rebuildable runtime state (re-run `--backfill` to regenerate) —
 * never committed anywhere. The Google Sheet is the durable store.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { getDataDir } from "../core/utils/keysFileOperations.js";

export interface RewardsCursor {
  network: string;
  /** Block of the last processed boundary (bigint as string). */
  lastBlock: string;
  /** Last day written to the Sheet (YYYY-MM-DD). */
  lastDate: string;
  /** coinbase (lowercase) -> Σ getSequencerRewards across rollups, bigint as string. */
  balances: Record<string, string>;
  updatedAt: string;
}

const cursorPath = (network: string, dataDir: string): string =>
  path.join(dataDir, `${network}-rewards-cursor.json`);

/** Serialize a balances map to the cursor's string-keyed record (pure). */
export const balancesToRecord = (balances: Map<string, bigint>): Record<string, string> => {
  const record: Record<string, string> = {};
  for (const [coinbase, value] of balances) {
    record[coinbase.toLowerCase()] = value.toString();
  }
  return record;
};

/** Deserialize the cursor's balances record back to a map (pure). */
export const balancesFromRecord = (record: Record<string, string>): Map<string, bigint> => {
  const balances = new Map<string, bigint>();
  for (const [coinbase, value] of Object.entries(record)) {
    balances.set(coinbase.toLowerCase(), BigInt(value));
  }
  return balances;
};

/** Load the cursor for a network, or `null` if none exists yet. */
export const loadCursor = async (
  network: string,
  dataDir: string = getDataDir(),
): Promise<RewardsCursor | null> => {
  try {
    const raw = await fs.readFile(cursorPath(network, dataDir), "utf-8");
    return JSON.parse(raw) as RewardsCursor;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
};

/** Persist the cursor for a network. */
export const saveCursor = async (
  cursor: RewardsCursor,
  dataDir: string = getDataDir(),
): Promise<void> => {
  const filePath = cursorPath(cursor.network, dataDir);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(cursor, null, 2));
};
