/**
 * State module - application state management
 *
 * Manages in-memory state for:
 * - Directory data (keystores, attester registrations)
 * - Staking provider data (from scrapers)
 * - State comparison for detecting changes
 */

import { z } from "zod";
import { DirDataSchema, type DirData } from "../../types.js";
import fs from "fs/promises";
import path from "path";
import { getAddressFromPrivateKey } from "@aztec/ethereum";
import envPath from "env-paths";
import { PACKAGE_NAME } from "../../core/config/index.js";

// Schema for coinbase changes
export const CoinbaseChangeSchema = z.object({
  keystoreId: z.string(),
  keystorePath: z.string(),
  attesterEth: z.string(),
  attesterBls: z.string(),
  coinbaseAddress: z.string(),
  previousCoinbase: z.string().optional(),
});

export type CoinbaseChange = z.infer<typeof CoinbaseChangeSchema>;

// Schema for staking provider data (from scraper)
export const StakingProviderDataSchema = z.object({
  providerId: z.bigint(),
  queueLength: z.bigint(),
  adminAddress: z.string(),
  rewardsRecipient: z.string(),
  lastUpdated: z.date(),
});

export type StakingProviderData = z.infer<typeof StakingProviderDataSchema>;

// Attester state types
export enum AttesterState {
  NEW = "NEW",
  WAITING_FOR_ADD_TO_QUEUE = "WAITING_FOR_ADD_TO_QUEUE",
  IN_STAKING_PROVIDER_QUEUE = "IN_STAKING_PROVIDER_QUEUE",
  NO_COINBASE = "NO_COINBASE",
  IN_STAKING_QUEUE = "IN_STAKING_QUEUE",
  ACTIVE = "ACTIVE",
}

// Schema for attester state entry
export const AttesterStateEntrySchema = z.object({
  attesterAddress: z.string(),
  state: z.nativeEnum(AttesterState),
  lastUpdated: z.date(),
});

export type AttesterStateEntry = z.infer<typeof AttesterStateEntrySchema>;

// Type for attester state map (address -> state entry)
export type AttesterStateMap = Map<string, AttesterStateEntry>;

// Schema for app state
export const AppStateSchema = z.object({
  dirData: DirDataSchema.nullable(),
  previousDirData: DirDataSchema.nullable(),
  stakingProviderData: StakingProviderDataSchema.nullable(),
});

export type AppState = z.infer<typeof AppStateSchema> & {
  attesterStates: AttesterStateMap;
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
 * Global application state
 */
let appState: AppState = {
  dirData: null,
  previousDirData: null,
  stakingProviderData: null,
  attesterStates: new Map(),
};

/**
 * Callbacks to notify when state changes
 */
type StateChangeCallback = (change: CoinbaseChange) => void;
const coinbaseChangeCallbacks: StateChangeCallback[] = [];

type AttesterStateChangeCallback = (
  attesterAddress: string,
  newState: AttesterState,
  oldState: AttesterState | undefined,
) => void;
const attesterStateChangeCallbacks: AttesterStateChangeCallback[] = [];

/**
 * State file path (using env-paths data directory)
 */
let stateFilePath: string | null = null;

/**
 * Debounce timer for saving state to file
 */
let saveTimer: NodeJS.Timeout | null = null;
const SAVE_DEBOUNCE_MS = 5000; // Save at most once every 5 seconds

/**
 * Initialize state management with persistence
 */
export const initState = async () => {
  console.log("State management initialized");

  // Set up state file path using env-paths data directory
  const dataDir = envPath(PACKAGE_NAME, { suffix: "" }).data;
  await fs.mkdir(dataDir, { recursive: true });
  stateFilePath = path.join(dataDir, "attester-state.json");
  console.log(`[State] State file path: ${stateFilePath}`);

  // Load state from file if it exists
  await loadAttesterStatesFromFile();
};

/**
 * Serialize attester state for JSON storage
 */
const serializeAttesterStates = (): Record<
  string,
  { state: string; lastUpdated: string }
> => {
  const serialized: Record<string, { state: string; lastUpdated: string }> = {};

  for (const [address, entry] of appState.attesterStates.entries()) {
    serialized[address] = {
      state: entry.state,
      lastUpdated: entry.lastUpdated.toISOString(),
    };
  }

  return serialized;
};

/**
 * Deserialize attester state from JSON storage
 */
const deserializeAttesterStates = (
  data: Record<string, { state: string; lastUpdated: string }>,
): void => {
  for (const [address, { state, lastUpdated }] of Object.entries(data)) {
    if (Object.values(AttesterState).includes(state as AttesterState)) {
      appState.attesterStates.set(address, {
        attesterAddress: address,
        state: state as AttesterState,
        lastUpdated: new Date(lastUpdated),
      });
    } else {
      console.warn(`[State] Invalid state "${state}" for attester ${address}`);
    }
  }
};

/**
 * Load attester states from file
 */
const loadAttesterStatesFromFile = async (): Promise<void> => {
  if (!stateFilePath) {
    return;
  }

  try {
    const fileContent = await fs.readFile(stateFilePath, "utf-8");
    const data = JSON.parse(fileContent);
    deserializeAttesterStates(data);
    console.log(
      `[State] Loaded ${appState.attesterStates.size} attester states from file`,
    );
  } catch (error: any) {
    if (error.code === "ENOENT") {
      console.log("[State] No existing state file found, starting fresh");
    } else {
      console.error("[State] Error loading state from file:", error);
    }
  }
};

/**
 * Save attester states to file
 */
export const saveAttesterStatesToFile = async (): Promise<void> => {
  if (!stateFilePath) {
    return;
  }

  try {
    const serialized = serializeAttesterStates();
    await fs.writeFile(stateFilePath, JSON.stringify(serialized, null, 2));
    console.log(
      `[State] Saved ${appState.attesterStates.size} attester states to file (${stateFilePath})`,
    );
  } catch (error) {
    console.error("[State] Error saving state to file:", error);
  }
};

/**
 * Schedule a debounced save to file
 * This prevents excessive file writes when many state updates occur
 */
const scheduleSaveAttesterStates = (): void => {
  // Clear existing timer if any
  if (saveTimer) {
    clearTimeout(saveTimer);
  }

  // Schedule new save
  saveTimer = setTimeout(() => {
    void saveAttesterStatesToFile();
    saveTimer = null;
  }, SAVE_DEBOUNCE_MS);
};

/**
 * Get current application state
 */
export const getState = (): Readonly<AppState> => {
  return appState;
};

/**
 * Update directory data and detect coinbase changes
 */
export const updateDirData = (newDirData: unknown): CoinbaseChange[] => {
  // Validate input
  let validated: DirData;
  try {
    validated = DirDataSchema.parse(newDirData);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error("[State] Invalid DirData:", error.errors);
      // Log detailed validation errors
      for (const err of error.errors) {
        console.error(`  - ${err.path.join(".")}: ${err.message}`);
      }
    }
    throw new Error("Failed to update directory data: invalid format");
  }

  // Freeze for immutability
  const frozenData = deepFreeze(validated);

  const changes: CoinbaseChange[] = [];
  const prevDirData = appState.dirData;

  // Compare keystores to detect coinbase changes
  if (prevDirData) {
    for (const newKeystore of frozenData.keystores) {
      const prevKeystore = prevDirData.keystores.find(
        (k) => k.id === newKeystore.id,
      );

      // Check each validator for coinbase changes
      for (const validator of newKeystore.data.validators) {
        // Derive address from private key
        const attesterAddress = getAddressFromPrivateKey(
          validator.attester.eth as `0x${string}`,
        );

        const prevValidator = prevKeystore?.data.validators.find((v) => {
          const prevAddress = getAddressFromPrivateKey(
            v.attester.eth as `0x${string}`,
          );
          return prevAddress === attesterAddress;
        });

        // Detect when coinbase is added or changed
        const prevCoinbase = prevValidator?.coinbase;
        const newCoinbase = validator.coinbase;

        if (newCoinbase && prevCoinbase !== newCoinbase) {
          const change: CoinbaseChange = {
            keystoreId: newKeystore.id,
            keystorePath: newKeystore.path,
            attesterEth: attesterAddress,
            attesterBls: validator.attester.bls,
            coinbaseAddress: newCoinbase,
            previousCoinbase: prevCoinbase,
          };
          changes.push(change);
          console.log(
            `[State] Coinbase change detected for attester ${attesterAddress}: ${prevCoinbase || "none"} -> ${newCoinbase}`,
          );
        }
      }
    }
  }

  // Update state
  appState.previousDirData = appState.dirData;
  appState.dirData = frozenData;

  // Notify callbacks of changes
  for (const change of changes) {
    for (const callback of coinbaseChangeCallbacks) {
      try {
        callback(change);
      } catch (error) {
        console.error("[State] Error in coinbase change callback:", error);
      }
    }
  }

  return changes;
};

/**
 * Update staking provider data from scraper
 */
export const updateStakingProviderData = (newStakingProviderData: unknown) => {
  // Allow null values (when staking provider is not configured)
  if (newStakingProviderData === null) {
    appState.stakingProviderData = null;
    return;
  }

  // Validate input
  let validated: StakingProviderData;
  try {
    validated = StakingProviderDataSchema.parse(newStakingProviderData);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error("[State] Invalid StakingProviderData:", error.errors);
      // Log detailed validation errors
      for (const err of error.errors) {
        console.error(`  - ${err.path.join(".")}: ${err.message}`);
      }
    }
    throw new Error("Failed to update staking provider data: invalid format");
  }

  // Freeze for immutability
  const frozenData = deepFreeze(validated);
  appState.stakingProviderData = frozenData;
};

/**
 * Register a callback for coinbase changes
 */
export const onCoinbaseChange = (callback: StateChangeCallback): void => {
  coinbaseChangeCallbacks.push(callback);
};

/**
 * Check if an attester is in the staking provider's staking registry queue
 * This requires querying the blockchain, which should be done by the handler
 */
export const getStakingProviderData = (): StakingProviderData | null => {
  return appState.stakingProviderData;
};

/**
 * Get all attester states
 */
export const getAttesterStates = (): ReadonlyMap<
  string,
  AttesterStateEntry
> => {
  return appState.attesterStates;
};

/**
 * Get state for a specific attester
 */
export const getAttesterState = (
  attesterAddress: string,
): AttesterStateEntry | undefined => {
  return appState.attesterStates.get(attesterAddress);
};

/**
 * Update attester state
 */
export const updateAttesterState = (
  attesterAddress: string,
  newState: AttesterState,
): void => {
  const oldEntry = appState.attesterStates.get(attesterAddress);
  const oldState = oldEntry?.state;

  // Skip if state hasn't changed
  if (oldState === newState) {
    return;
  }

  // Validate NO_COINBASE can only be entered from IN_STAKING_PROVIDER_QUEUE
  if (
    newState === AttesterState.NO_COINBASE &&
    oldState !== AttesterState.IN_STAKING_PROVIDER_QUEUE &&
    oldState !== undefined
  ) {
    console.error(
      `ERROR: Invalid state transition to NO_COINBASE from ${oldState} for attester ${attesterAddress}. ` +
        `NO_COINBASE can only be entered from IN_STAKING_PROVIDER_QUEUE.`,
    );
    return; // Don't allow the transition
  }

  const newEntry: AttesterStateEntry = {
    attesterAddress,
    state: newState,
    lastUpdated: new Date(),
  };

  appState.attesterStates.set(attesterAddress, newEntry);

  console.log(
    `[State] Attester ${attesterAddress} state updated: ${oldState || "none"} -> ${newState}`,
  );

  // Notify callbacks
  for (const callback of attesterStateChangeCallbacks) {
    try {
      callback(attesterAddress, newState, oldState);
    } catch (error) {
      console.error("[State] Error in attester state change callback:", error);
    }
  }

  // Mark that we have pending changes to save
  scheduleSaveAttesterStates();
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
 * Count attesters by state
 */
export const countAttestersByState = (): Map<AttesterState, number> => {
  const counts = new Map<AttesterState, number>();

  // Initialize all states to 0
  for (const state of Object.values(AttesterState)) {
    counts.set(state as AttesterState, 0);
  }

  // Count each attester
  for (const entry of appState.attesterStates.values()) {
    counts.set(entry.state, (counts.get(entry.state) || 0) + 1);
  }

  return counts;
};

/**
 * Get attesters in a specific state
 */
export const getAttestersByState = (
  state: AttesterState,
): AttesterStateEntry[] => {
  return Array.from(appState.attesterStates.values()).filter(
    (entry) => entry.state === state,
  );
};

/**
 * Initialize attester states from directory data
 * This should be called on server startup
 */
export const initAttesterStates = (dirData: DirData): void => {
  console.log("[State] Initializing attester states from directory data...");

  const attesterAddresses = new Set<string>();

  // Collect all attester addresses from keystores
  for (const keystore of dirData.keystores) {
    for (const validator of keystore.data.validators) {
      // Derive address from private key
      const attesterAddress = getAddressFromPrivateKey(
        validator.attester.eth as `0x${string}`,
      );
      attesterAddresses.add(attesterAddress);
    }
  }

  console.log(`[State] Found ${attesterAddresses.size} attesters in keystores`);

  // Initialize or update each attester's state
  for (const attesterAddress of attesterAddresses) {
    const existing = appState.attesterStates.get(attesterAddress);
    if (!existing) {
      // New attester, set to NEW state
      updateAttesterState(attesterAddress, AttesterState.NEW);
    }
  }

  console.log(
    `[State] Attester states initialized: ${appState.attesterStates.size} attesters`,
  );
};
