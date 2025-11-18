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

// Schema for app state
export const AppStateSchema = z.object({
  dirData: DirDataSchema.nullable(),
  previousDirData: DirDataSchema.nullable(),
  stakingProviderData: StakingProviderDataSchema.nullable(),
});

export type AppState = z.infer<typeof AppStateSchema>;

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
};

/**
 * Callbacks to notify when state changes
 */
type StateChangeCallback = (change: CoinbaseChange) => void;
const coinbaseChangeCallbacks: StateChangeCallback[] = [];

/**
 * Initialize state management
 */
export const initState = async () => {
  console.log("State management initialized");
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
        const prevValidator = prevKeystore?.data.validators.find(
          (v) => v.attester.eth === validator.attester.eth,
        );

        // Detect when coinbase is added or changed
        const prevCoinbase = prevValidator?.coinbase;
        const newCoinbase = validator.coinbase;

        if (newCoinbase && prevCoinbase !== newCoinbase) {
          const change: CoinbaseChange = {
            keystoreId: newKeystore.id,
            keystorePath: newKeystore.path,
            attesterEth: validator.attester.eth,
            attesterBls: validator.attester.bls,
            coinbaseAddress: newCoinbase,
            previousCoinbase: prevCoinbase,
          };
          changes.push(change);
          console.log(
            `[State] Coinbase change detected for attester ${validator.attester.eth}: ${prevCoinbase || "none"} -> ${newCoinbase}`,
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
