/**
 * State module - application state management (Multi-Network Support)
 *
 * Manages in-memory state for multiple networks:
 * - Scraper config (attesters, publishers, staking provider)
 * - Staking provider data (from scrapers)
 * - Attester states and transitions
 * - Publisher data
 * - Staking rewards history
 *
 * Each network has isolated state with separate persistence files.
 */

import { z } from "zod";
import {
  type PublisherDataMap,
  type AttesterView,
  AttesterViewSchema,
  PublisherData,
  PublisherDataEntry,
  StakingRewardsMap,
  StakingRewardsSnapshot,
  StakingRewardsSnapshotSchema,
  StakingRewardsDailyAggregate,
  StakingRewardsDailyAggregateSchema,
} from "../../types/index.js";
import type { ScraperConfig } from "../../types/scraper-config.js";
import fs from "fs/promises";
import path from "path";
import envPath from "env-paths";
import { PACKAGE_NAME } from "../../core/config/index.js";

// Schema for staking provider data (from scraper)
export const StakingProviderDataSchema = z.object({
  providerId: z.bigint(),
  queueLength: z.bigint(),
  queue: z.array(z.string()),
  adminAddress: z.string(),
  rewardsRecipient: z.string(),
  lastUpdated: z.date(),
});

export type StakingProviderData = z.infer<typeof StakingProviderDataSchema>;

// Attester state types
export enum AttesterState {
  NEW = "NEW",
  IN_STAKING_PROVIDER_QUEUE = "IN_STAKING_PROVIDER_QUEUE",
  COINBASE_NEEDED = "COINBASE_NEEDED",
  IN_STAKING_QUEUE = "IN_STAKING_QUEUE",
  ACTIVE = "ACTIVE",
  NO_LONGER_ACTIVE = "NO_LONGER_ACTIVE",
}

// Schema for attester state entry
export const AttesterStateEntrySchema = z.object({
  attesterAddress: z.string(),
  state: z.nativeEnum(AttesterState),
  lastUpdated: z.date(),
  onChainView: AttesterViewSchema.optional(),
});

export type AttesterStateEntry = z.infer<typeof AttesterStateEntrySchema>;

// Type for attester state map (address -> state entry)
export type AttesterStateMap = Map<string, AttesterStateEntry>;

// Network-specific state
export type NetworkState = {
  stakingProviderData: StakingProviderData | null;
  scraperConfig: ScraperConfig | null;
  attesterStates: AttesterStateMap;
  publisherData: PublisherDataMap | null;
  stakingRewardsData: StakingRewardsMap | null;
  stakingRewardsHistory: StakingRewardsSnapshot[];
};

/**
 * Deep freeze an object to prevent mutations
 * Only freezes in development/test for performance
 */
function deepFreeze<T>(obj: T): Readonly<T> {
  // Skip freezing in production for performance
  if (process.env.NODE_ENV === "production") {
    return obj;
  }

  Object.freeze(obj);

  Object.getOwnPropertyNames(obj).forEach((prop) => {
    const value = (obj as any)[prop];
    if (
      value !== null &&
      (typeof value === "object" || typeof value === "function") &&
      !Object.isFrozen(value)
    ) {
      deepFreeze(value);
    }
  });

  return obj as Readonly<T>;
}

/**
 * Global network states map
 */
const networkStates = new Map<string, NetworkState>();

/**
 * Get or create network state
 */
const getNetworkState = (network: string): NetworkState => {
  let state = networkStates.get(network);
  if (!state) {
    state = {
      stakingProviderData: null,
      scraperConfig: null,
      attesterStates: new Map(),
      publisherData: null,
      stakingRewardsData: null,
      stakingRewardsHistory: [],
    };
    networkStates.set(network, state);
  }
  return state;
};

/**
 * Get all network states
 */
export const getAllNetworkStates = (): ReadonlyMap<string, NetworkState> => {
  return networkStates;
};

/**
 * Callbacks to notify when state changes (now include network)
 */
type AttesterStateChangeCallback = (
  network: string,
  attesterAddress: string,
  newState: AttesterState,
  oldState: AttesterState | undefined,
) => void;
const attesterStateChangeCallbacks: AttesterStateChangeCallback[] = [];

type PublisherBalanceUpdateCallback = (
  network: string,
  publisherAddress: string,
  currentBalance: PublisherData["currentBalance"],
  requiredTopup: PublisherData["requiredTopup"],
) => void;
const PublisherBalanceUpdateCallbacks: PublisherBalanceUpdateCallback[] = [];

/**
 * Per-network state file paths and debounce timers
 */
const networkStatePaths = new Map<
  string,
  {
    attesterStateFilePath: string;
    stakingRewardsHistoryFilePath: string;
    attesterSaveTimer: NodeJS.Timeout | null;
    rewardsSaveTimer: NodeJS.Timeout | null;
  }
>();

const SAVE_DEBOUNCE_MS = 5000; // Save at most once every 5 seconds
const STAKING_HISTORY_SAVE_DEBOUNCE_MS = 5000;

/**
 * Initialize state management with persistence
 */
export const initState = async () => {
  console.log("State management initialized (multi-network support)");

  // State files will be created per-network when networks are initialized
  const dataDir = envPath(PACKAGE_NAME, { suffix: "" }).data;
  await fs.mkdir(dataDir, { recursive: true });
  console.log(`[State] Data directory: ${dataDir}`);
};

/**
 * Initialize state for a specific network
 */
export const initNetworkState = async (network: string) => {
  console.log(`[State] Initializing state for network: ${network}`);

  const dataDir = envPath(PACKAGE_NAME, { suffix: "" }).data;
  const attesterStateFilePath = path.join(
    dataDir,
    `${network}-attester-state.json`,
  );
  const stakingRewardsHistoryFilePath = path.join(
    dataDir,
    `${network}-staking-rewards-history.json`,
  );

  networkStatePaths.set(network, {
    attesterStateFilePath,
    stakingRewardsHistoryFilePath,
    attesterSaveTimer: null,
    rewardsSaveTimer: null,
  });

  console.log(
    `[State/${network}] Attester state file: ${attesterStateFilePath}`,
  );
  console.log(
    `[State/${network}] Staking rewards history file: ${stakingRewardsHistoryFilePath}`,
  );

  // Load state from files if they exist
  await loadAttesterStatesFromFile(network);
  await loadStakingRewardsHistoryFromFile(network);
};

/**
 * Serialize attester state for JSON storage
 */
const serializeAttesterStates = (
  network: string,
): Record<
  string,
  { state: string; lastUpdated: string; onChainView?: any }
> => {
  const state = getNetworkState(network);
  const serialized: Record<
    string,
    { state: string; lastUpdated: string; onChainView?: any }
  > = {};

  for (const [address, entry] of state.attesterStates.entries()) {
    serialized[address] = {
      state: entry.state,
      lastUpdated: entry.lastUpdated.toISOString(),
      ...(entry.onChainView && {
        onChainView: {
          status: entry.onChainView.status,
          effectiveBalance: entry.onChainView.effectiveBalance.toString(),
          exit: {
            ...entry.onChainView.exit,
            withdrawalId: entry.onChainView.exit.withdrawalId.toString(),
            amount: entry.onChainView.exit.amount.toString(),
            exitableAt: entry.onChainView.exit.exitableAt.toString(),
          },
          config: {
            ...entry.onChainView.config,
            publicKey: {
              x: entry.onChainView.config.publicKey.x.toString(),
              y: entry.onChainView.config.publicKey.y.toString(),
            },
          },
        },
      }),
    };
  }

  return serialized;
};

/**
 * Deserialize attester state from JSON storage
 */
const deserializeAttesterStates = (
  network: string,
  data: Record<
    string,
    { state: string; lastUpdated: string; onChainView?: any }
  >,
): void => {
  const state = getNetworkState(network);

  for (const [address, record] of Object.entries(data)) {
    if (Object.values(AttesterState).includes(record.state as AttesterState)) {
      let onChainView: AttesterView | undefined;

      // Deserialize on-chain view if present
      if (record.onChainView) {
        try {
          onChainView = {
            status: record.onChainView.status,
            effectiveBalance: BigInt(record.onChainView.effectiveBalance),
            exit: {
              withdrawalId: BigInt(record.onChainView.exit.withdrawalId),
              amount: BigInt(record.onChainView.exit.amount),
              exitableAt: BigInt(record.onChainView.exit.exitableAt),
              recipientOrWithdrawer:
                record.onChainView.exit.recipientOrWithdrawer,
              isRecipient: record.onChainView.exit.isRecipient,
              exists: record.onChainView.exit.exists,
            },
            config: {
              publicKey: {
                x: BigInt(record.onChainView.config.publicKey.x),
                y: BigInt(record.onChainView.config.publicKey.y),
              },
              withdrawer: record.onChainView.config.withdrawer,
            },
          };
        } catch (error) {
          console.warn(
            `[State/${network}] Failed to deserialize on-chain view for attester ${address}:`,
            error,
          );
        }
      }

      state.attesterStates.set(address, {
        attesterAddress: address,
        state: record.state as AttesterState,
        lastUpdated: new Date(record.lastUpdated),
        onChainView,
      });
    } else {
      console.warn(
        `[State/${network}] Invalid state "${record.state}" for attester ${address}`,
      );
    }
  }
};

/**
 * Load attester states from file
 */
const loadAttesterStatesFromFile = async (network: string): Promise<void> => {
  const paths = networkStatePaths.get(network);
  if (!paths) {
    return;
  }

  try {
    const fileContent = await fs.readFile(paths.attesterStateFilePath, "utf-8");
    const data = JSON.parse(fileContent);
    deserializeAttesterStates(network, data);
    const state = getNetworkState(network);
    console.log(
      `[State/${network}] Loaded ${state.attesterStates.size} attester states from file`,
    );
  } catch (error: any) {
    if (error.code === "ENOENT") {
      console.log(
        `[State/${network}] No existing state file found, starting fresh`,
      );
    } else {
      console.error(`[State/${network}] Error loading state from file:`, error);
    }
  }
};

type SerializedStakingRewardsSnapshot = {
  coinbase: string;
  attesters: string[];
  pendingRewards: string;
  ourShare: string;
  otherShare: string;
  totalAllocation: string;
  ourAllocation: string;
  recipients: { address: string; allocation: string }[];
  lastUpdated: string;
  blockNumber: string;
  timestamp: string;
};

const serializeStakingRewardsHistory = (
  network: string,
): SerializedStakingRewardsSnapshot[] => {
  const state = getNetworkState(network);
  return state.stakingRewardsHistory.map((snapshot) => ({
    coinbase: snapshot.coinbase,
    attesters: snapshot.attesters,
    pendingRewards: snapshot.pendingRewards.toString(),
    ourShare: snapshot.ourShare.toString(),
    otherShare: snapshot.otherShare.toString(),
    totalAllocation: snapshot.totalAllocation.toString(),
    ourAllocation: snapshot.ourAllocation.toString(),
    recipients: snapshot.recipients.map((recipient) => ({
      address: recipient.address,
      allocation: recipient.allocation.toString(),
    })),
    lastUpdated: snapshot.lastUpdated.toISOString(),
    blockNumber: snapshot.blockNumber.toString(),
    timestamp: snapshot.timestamp.toISOString(),
  }));
};

const deserializeStakingRewardsHistory = (
  network: string,
  data: SerializedStakingRewardsSnapshot[],
) => {
  const state = getNetworkState(network);

  for (const entry of data) {
    try {
      const parsed = StakingRewardsSnapshotSchema.parse({
        ...entry,
        pendingRewards: BigInt(entry.pendingRewards),
        ourShare: BigInt(entry.ourShare),
        otherShare: BigInt(entry.otherShare),
        totalAllocation: BigInt(entry.totalAllocation),
        ourAllocation: BigInt(entry.ourAllocation),
        recipients: entry.recipients.map((recipient) => ({
          ...recipient,
          allocation: BigInt(recipient.allocation),
        })),
        lastUpdated: new Date(entry.lastUpdated),
        blockNumber: BigInt(entry.blockNumber),
        timestamp: new Date(entry.timestamp),
      });
      state.stakingRewardsHistory.push(parsed);
    } catch (error) {
      console.warn(
        `[State/${network}] Failed to deserialize staking rewards snapshot at block ${entry.blockNumber}:`,
        error,
      );
    }
  }
};

const loadStakingRewardsHistoryFromFile = async (
  network: string,
): Promise<void> => {
  const paths = networkStatePaths.get(network);
  if (!paths) {
    return;
  }

  try {
    const fileContent = await fs.readFile(
      paths.stakingRewardsHistoryFilePath,
      "utf-8",
    );
    const data: SerializedStakingRewardsSnapshot[] = JSON.parse(fileContent);
    deserializeStakingRewardsHistory(network, data);
    const state = getNetworkState(network);
    console.log(
      `[State/${network}] Loaded ${state.stakingRewardsHistory.length} staking rewards snapshots from file`,
    );
  } catch (error: any) {
    if (error.code === "ENOENT") {
      console.log(
        `[State/${network}] No existing staking rewards history file found, starting fresh`,
      );
    } else {
      console.error(
        `[State/${network}] Error loading staking rewards history:`,
        error,
      );
    }
  }
};

/**
 * Save attester states to file
 */
export const saveAttesterStatesToFile = async (
  network: string,
): Promise<void> => {
  const paths = networkStatePaths.get(network);
  if (!paths) {
    return;
  }

  try {
    const serialized = serializeAttesterStates(network);
    await fs.writeFile(
      paths.attesterStateFilePath,
      JSON.stringify(serialized, null, 2),
    );
    const state = getNetworkState(network);
    console.log(
      `[State/${network}] Saved ${state.attesterStates.size} attester states to file`,
    );
  } catch (error) {
    console.error(`[State/${network}] Error saving state to file:`, error);
  }
};

export const saveStakingRewardsHistoryToFile = async (
  network: string,
): Promise<void> => {
  const paths = networkStatePaths.get(network);
  if (!paths) {
    return;
  }

  try {
    const serialized = serializeStakingRewardsHistory(network);
    await fs.writeFile(
      paths.stakingRewardsHistoryFilePath,
      JSON.stringify(serialized, null, 2),
    );
    const state = getNetworkState(network);
    console.log(
      `[State/${network}] Saved ${state.stakingRewardsHistory.length} staking rewards snapshots to file`,
    );
  } catch (error) {
    console.error(
      `[State/${network}] Error saving staking rewards history to file:`,
      error,
    );
  }
};

/**
 * Schedule a debounced save to file
 * This prevents excessive file writes when many state updates occur
 */
const scheduleSaveAttesterStates = (network: string): void => {
  const paths = networkStatePaths.get(network);
  if (!paths) {
    return;
  }

  // Clear existing timer if any
  if (paths.attesterSaveTimer) {
    clearTimeout(paths.attesterSaveTimer);
  }

  // Schedule new save
  paths.attesterSaveTimer = setTimeout(() => {
    void saveAttesterStatesToFile(network);
    paths.attesterSaveTimer = null;
  }, SAVE_DEBOUNCE_MS);
};

const scheduleSaveStakingRewardsHistory = (network: string): void => {
  const paths = networkStatePaths.get(network);
  if (!paths) {
    return;
  }

  if (paths.rewardsSaveTimer) {
    clearTimeout(paths.rewardsSaveTimer);
  }

  paths.rewardsSaveTimer = setTimeout(() => {
    void saveStakingRewardsHistoryToFile(network);
    paths.rewardsSaveTimer = null;
  }, STAKING_HISTORY_SAVE_DEBOUNCE_MS);
};

/**
 * Get current network state
 */
export const getNetworkStateData = (
  network: string,
): Readonly<NetworkState> => {
  return getNetworkState(network);
};

/**
 * Update staking provider data from scraper
 */
export const updateStakingProviderData = (
  network: string,
  newStakingProviderData: unknown,
) => {
  const state = getNetworkState(network);

  // Allow null values (when staking provider is not configured)
  if (newStakingProviderData === null) {
    state.stakingProviderData = null;
    return;
  }

  // Validate input
  let validated: StakingProviderData;
  try {
    validated = StakingProviderDataSchema.parse(newStakingProviderData);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error(
        `[State/${network}] Invalid StakingProviderData:`,
        error.errors,
      );
      // Log detailed validation errors
      for (const err of error.errors) {
        console.error(`  - ${err.path.join(".")}: ${err.message}`);
      }
    }
    throw new Error("Failed to update staking provider data: invalid format");
  }

  // Freeze for immutability
  const frozenData = deepFreeze(validated);
  state.stakingProviderData = frozenData;
};

/**
 * Get staking provider data
 */
export const getStakingProviderData = (
  network: string,
): StakingProviderData | null => {
  const state = getNetworkState(network);
  return state.stakingProviderData;
};

/**
 * Get all attester states for a network
 */
export const getAttesterStates = (
  network: string,
): ReadonlyMap<string, AttesterStateEntry> => {
  const state = getNetworkState(network);
  return state.attesterStates;
};

/**
 * Get state for a specific attester
 */
export const getAttesterState = (
  network: string,
  attesterAddress: string,
): AttesterStateEntry | undefined => {
  const state = getNetworkState(network);
  return state.attesterStates.get(attesterAddress);
};

/**
 * Update attester state
 */
export const updateAttesterState = (
  network: string,
  attesterAddress: string,
  newState: AttesterState,
): void => {
  const state = getNetworkState(network);
  const oldEntry = state.attesterStates.get(attesterAddress);
  const oldState = oldEntry?.state;

  // Skip if state hasn't changed
  if (oldState === newState) {
    return;
  }

  console.log(
    `[${network}] Trying to update attester ${attesterAddress} state: ${oldState || "none"} -> ${newState}`,
  );

  // Validate COINBASE_NEEDED can only be entered from IN_STAKING_PROVIDER_QUEUE
  if (
    newState === AttesterState.COINBASE_NEEDED &&
    oldState !== AttesterState.IN_STAKING_PROVIDER_QUEUE &&
    oldState !== undefined
  ) {
    console.error(
      `[${network}] ERROR: Invalid state transition to COINBASE_NEEDED from ${oldState} for attester ${attesterAddress}. ` +
        `COINBASE_NEEDED can only be entered from IN_STAKING_PROVIDER_QUEUE.`,
    );
    return; // Don't allow the transition
  }

  const newEntry: AttesterStateEntry = {
    attesterAddress,
    state: newState,
    lastUpdated: new Date(),
    onChainView: oldEntry?.onChainView, // Preserve on-chain view data
  };

  state.attesterStates.set(attesterAddress, newEntry);

  console.log(
    `[State/${network}] Attester ${attesterAddress} state updated: ${oldState || "none"} -> ${newState}`,
  );

  // Notify callbacks
  for (const callback of attesterStateChangeCallbacks) {
    try {
      callback(network, attesterAddress, newState, oldState);
    } catch (error) {
      console.error(
        `[State/${network}] Error in attester state change callback:`,
        error,
      );
    }
  }

  // Mark that we have pending changes to save
  scheduleSaveAttesterStates(network);
};

/**
 * Update attester on-chain view data
 */
export const updateAttesterOnChainView = (
  network: string,
  attesterAddress: string,
  onChainView: AttesterView | null,
): void => {
  const state = getNetworkState(network);
  const existingEntry = state.attesterStates.get(attesterAddress);

  if (!existingEntry) {
    // If attester doesn't exist in state, create it with NEW state
    const newEntry: AttesterStateEntry = {
      attesterAddress,
      state: AttesterState.NEW,
      lastUpdated: new Date(),
      onChainView: onChainView || undefined,
    };
    state.attesterStates.set(attesterAddress, newEntry);
    console.log(
      `[State/${network}] Created new attester ${attesterAddress} with on-chain view`,
    );
  } else {
    // Update existing entry with new on-chain view
    const updatedEntry: AttesterStateEntry = {
      ...existingEntry,
      onChainView: onChainView || undefined,
      lastUpdated: new Date(),
    };
    state.attesterStates.set(attesterAddress, updatedEntry);
  }

  // Mark that we have pending changes to save
  scheduleSaveAttesterStates(network);
};

/**
 * Register a callback for attester state changes
 */
export const onAttesterStateChange = (
  callback: AttesterStateChangeCallback,
): void => {
  attesterStateChangeCallbacks.push(callback);
};

/**
 * Count attesters by state for a network
 */
export const countAttestersByState = (
  network: string,
): Map<AttesterState, number> => {
  const state = getNetworkState(network);
  const counts = new Map<AttesterState, number>();

  // Initialize all states to 0
  for (const stateEnum of Object.values(AttesterState)) {
    counts.set(stateEnum as AttesterState, 0);
  }

  // Count each attester
  for (const entry of state.attesterStates.values()) {
    counts.set(entry.state, (counts.get(entry.state) || 0) + 1);
  }

  return counts;
};

/**
 * Get attesters in a specific state
 */
export const getAttestersByState = (
  network: string,
  state: AttesterState,
): AttesterStateEntry[] => {
  const networkState = getNetworkState(network);
  return Array.from(networkState.attesterStates.values()).filter(
    (entry) => entry.state === state,
  );
};

/**
 * Get all attester coinbase information from scraper config
 * Returns map of attester address -> coinbase address
 */
export const getAttesterCoinbaseInfo = (
  network: string,
): Map<string, string> => {
  const state = getNetworkState(network);
  const coinbaseMap = new Map<string, string>();

  if (!state.scraperConfig) {
    return coinbaseMap;
  }

  for (const attester of state.scraperConfig.attesters) {
    if (attester.coinbase) {
      coinbaseMap.set(attester.address, attester.coinbase);
    }
  }

  return coinbaseMap;
};

/**
 * Update publisher data from scraper
 */
export const updatePublisherData = (
  network: string,
  newPublisherData: PublisherDataMap | null,
) => {
  const state = getNetworkState(network);

  if (!newPublisherData) return;

  newPublisherData.forEach((data, privKey) => {
    if (isNewPublisherData(network, privKey, data)) {
      for (const callback of PublisherBalanceUpdateCallbacks) {
        try {
          callback(
            network,
            data.publisherAddress,
            data.currentBalance,
            data.requiredTopup,
          );
        } catch (error) {
          console.error(
            `[State/${network}] Error in publisher data change callback:`,
            error,
          );
        }
      }
    }
  });

  state.publisherData = newPublisherData;
};

const isNewPublisherData = (
  network: string,
  address: string,
  data: PublisherDataEntry,
) => {
  const state = getNetworkState(network);
  if (!state.publisherData) return true;
  if (state.publisherData.get(address) == data) return false;
  return true; // as catch-all just always update
};

/**
 * Get publisher data
 */
export const getPublisherData = (network: string): PublisherDataMap | null => {
  const state = getNetworkState(network);
  return state.publisherData;
};

/**
 * Get data for a specific publisher
 */
export const getPublisherDataEntry = (
  network: string,
  publisherAddress: string,
): PublisherDataEntry | undefined => {
  const state = getNetworkState(network);
  if (!state.publisherData) return undefined;
  return state.publisherData.get(publisherAddress);
};

/**
 * Register a callback for publisher balance updates
 */
export const onPublisherBalanceUpdate = (
  callback: PublisherBalanceUpdateCallback,
): void => {
  PublisherBalanceUpdateCallbacks.push(callback);
};

/**
 * Update staking rewards data map
 */
export const updateStakingRewardsData = (
  network: string,
  rewardsData: StakingRewardsMap | null,
) => {
  const state = getNetworkState(network);
  state.stakingRewardsData = rewardsData;
};

/**
 * Get the latest staking rewards data map
 */
export const getStakingRewardsData = (
  network: string,
): StakingRewardsMap | null => {
  const state = getNetworkState(network);
  return state.stakingRewardsData;
};

/**
 * Record staking rewards snapshots and persist to disk
 */
export const recordStakingRewardsSnapshots = (
  network: string,
  snapshots: StakingRewardsSnapshot[],
): void => {
  if (!snapshots.length) {
    return;
  }

  const state = getNetworkState(network);
  let added = false;

  for (const snapshot of snapshots) {
    const existing = state.stakingRewardsHistory.find(
      (entry) =>
        entry.coinbase.toLowerCase() === snapshot.coinbase.toLowerCase() &&
        entry.blockNumber === snapshot.blockNumber,
    );

    if (existing) {
      continue;
    }

    state.stakingRewardsHistory.push(snapshot);
    added = true;
  }

  if (added) {
    state.stakingRewardsHistory.sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
    );
    scheduleSaveStakingRewardsHistory(network);
  }
};

/**
 * Get recorded staking rewards history snapshots
 */
export const getStakingRewardsHistory = (
  network: string,
): StakingRewardsSnapshot[] => {
  const state = getNetworkState(network);
  return state.stakingRewardsHistory;
};

/**
 * Get timestamp of latest staking rewards snapshot (if any)
 */
export const getLatestStakingRewardsSnapshotTimestamp = (
  network: string,
): Date | null => {
  const state = getNetworkState(network);
  const last =
    state.stakingRewardsHistory[state.stakingRewardsHistory.length - 1];
  return last ? last.timestamp : null;
};

/**
 * Aggregate staking rewards snapshots into daily buckets for reporting
 */
export const getStakingRewardsDailyAggregates = (
  network: string,
): StakingRewardsDailyAggregate[] => {
  const state = getNetworkState(network);
  const aggregates = new Map<string, StakingRewardsDailyAggregate>();

  for (const snapshot of state.stakingRewardsHistory) {
    const dateKey = snapshot.timestamp.toISOString().slice(0, 10);
    const mapKey = `${dateKey}:${snapshot.coinbase.toLowerCase()}`;
    const current = aggregates.get(mapKey) ?? {
      date: dateKey,
      coinbase: snapshot.coinbase,
      totalPendingRewards: 0n,
      totalOurShare: 0n,
      totalOtherShare: 0n,
      sampleCount: 0,
    };

    aggregates.set(mapKey, {
      ...current,
      totalPendingRewards:
        current.totalPendingRewards + snapshot.pendingRewards,
      totalOurShare: current.totalOurShare + snapshot.ourShare,
      totalOtherShare: current.totalOtherShare + snapshot.otherShare,
      sampleCount: current.sampleCount + 1,
    });
  }

  return Array.from(aggregates.values()).map((entry) =>
    StakingRewardsDailyAggregateSchema.parse(entry),
  );
};

/**
 * Get numeric priority of a state for comparison
 * Higher number = more advanced state
 */
function getStatePriority(state: AttesterState): number {
  const priorities: Record<AttesterState, number> = {
    [AttesterState.NEW]: 1,
    [AttesterState.IN_STAKING_PROVIDER_QUEUE]: 2,
    [AttesterState.COINBASE_NEEDED]: 3,
    [AttesterState.IN_STAKING_QUEUE]: 4,
    [AttesterState.ACTIVE]: 5,
    [AttesterState.NO_LONGER_ACTIVE]: 6,
  };
  return priorities[state];
}

/**
 * Initialize attester states from scraper config
 * Called on server startup (alternative to initAttesterStates for scraper mode)
 */
export const initAttesterStatesFromScraperConfig = (
  network: string,
  scraperConfig: ScraperConfig,
): void => {
  console.log(
    `[State/${network}] Initializing attester states from scraper config...`,
  );

  const state = getNetworkState(network);

  // Initialize each attester's state
  for (const attester of scraperConfig.attesters) {
    const dbStateEntry = state.attesterStates.get(attester.address);
    const configState = attester.lastSeenState as AttesterState | undefined;

    if (dbStateEntry && configState) {
      // Both DB and config have state - use whichever is higher priority
      const dbPriority = getStatePriority(dbStateEntry.state);
      const configPriority = getStatePriority(configState);

      if (configPriority > dbPriority) {
        console.log(
          `[State/${network}] Attester ${attester.address}: Using config state "${configState}" ` +
            `(priority ${configPriority}) over DB state "${dbStateEntry.state}" (priority ${dbPriority})`,
        );
        updateAttesterState(network, attester.address, configState);
      } else {
        console.log(
          `[State/${network}] Attester ${attester.address}: Keeping DB state "${dbStateEntry.state}" ` +
            `(priority ${dbPriority}) over config state "${configState}" (priority ${configPriority})`,
        );
      }
    } else if (configState) {
      // Only config has state - use it
      console.log(
        `[State/${network}] Attester ${attester.address}: Initializing from config state "${configState}"`,
      );
      updateAttesterState(network, attester.address, configState);
    } else if (!dbStateEntry) {
      // No DB state and no config state - initialize to NEW
      updateAttesterState(network, attester.address, AttesterState.NEW);
    }
    // else: DB state exists and no config state - do nothing (keep existing DB state)
  }

  console.log(
    `[State/${network}] Attester states initialized: ${state.attesterStates.size} attesters`,
  );
};

/**
 * Initialize attester states from cached attesters
 * Called on server startup with the new cache system
 */
export const initAttesterStatesFromCache = (
  network: string,
  cachedAttesters: Array<{
    address: string;
    coinbase?: string;
    lastSeenState?: string;
  }>,
): void => {
  console.log(`[State/${network}] Initializing attester states from cache...`);

  const state = getNetworkState(network);

  // Initialize each attester's state
  for (const attester of cachedAttesters) {
    const dbStateEntry = state.attesterStates.get(attester.address);
    const cacheState = attester.lastSeenState as AttesterState | undefined;

    if (dbStateEntry && cacheState) {
      // Both DB and cache have state - use whichever is higher priority
      const dbPriority = getStatePriority(dbStateEntry.state);
      const cachePriority = getStatePriority(cacheState);

      if (cachePriority > dbPriority) {
        console.log(
          `[State/${network}] Attester ${attester.address}: Using cache state "${cacheState}" ` +
            `(priority ${cachePriority}) over DB state "${dbStateEntry.state}" (priority ${dbPriority})`,
        );
        updateAttesterState(network, attester.address, cacheState);
      } else {
        console.log(
          `[State/${network}] Attester ${attester.address}: Keeping DB state "${dbStateEntry.state}" ` +
            `(priority ${dbPriority}) over cache state "${cacheState}" (priority ${cachePriority})`,
        );
      }
    } else if (cacheState) {
      // Only cache has state - use it
      console.log(
        `[State/${network}] Attester ${attester.address}: Initializing from cache state "${cacheState}"`,
      );
      updateAttesterState(network, attester.address, cacheState);
    } else if (!dbStateEntry) {
      // No DB state and no cache state - initialize to NEW
      updateAttesterState(network, attester.address, AttesterState.NEW);
    }
    // else: DB state exists and no cache state - do nothing (keep existing DB state)
  }

  console.log(
    `[State/${network}] Attester states initialized: ${state.attesterStates.size} attesters`,
  );
};

/**
 * Update publishers list in state
 * Called on server startup to populate the publisher addresses being monitored
 */
export const updatePublishersState = (
  network: string,
  publishers: string[],
): void => {
  console.log(
    `[State/${network}] Updating publishers state with ${publishers.length} publisher(s)`,
  );

  // Note: Publisher data is updated by the PublisherScraper
  // This function just logs the initialization
  // The actual publisher tracking happens in the scraper and state updates
};

/**
 * Store scraper config in state for use by metrics and other modules
 */
export const updateScraperConfigState = (
  network: string,
  scraperConfig: ScraperConfig,
): void => {
  const state = getNetworkState(network);
  state.scraperConfig = scraperConfig;
  console.log(`[State/${network}] Scraper config stored in state`);
};

/**
 * Get scraper config from state
 */
export const getScraperConfig = (network: string): ScraperConfig | null => {
  const state = getNetworkState(network);
  return state.scraperConfig;
};
