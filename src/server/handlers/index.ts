/**
 * Handlers module - event handlers that trigger actions
 *
 * This module contains:
 * - attester-new-state-handler.ts: Handles NEW attester state
 */

import type { EthereumClient } from "../../core/components/EthereumClient.js";
import type { SafeGlobalClient } from "../../core/components/SafeGlobalClient.js";
import { AttesterNewStateHandler } from "./attester-new-state-handler.js";
import { PublisherTopUpHandler } from "./publisher-top-up-handler.js"
export interface HandlersConfig {
  ethClient: EthereumClient;
  providerId: bigint;
  safeClient: SafeGlobalClient | null;
}

let attesterNewStateHandler: AttesterNewStateHandler | null = null;
let publisherTopUpHandler: PublisherTopUpHandler | null = null;

// Default debounce delay: 30 seconds
// This means if attesters keep arriving within 30s windows, processing is delayed
// Once 30s pass without new attesters, the batch is processed
const DEBOUNCE_DELAY_MS = 30_000;

/**
 * Initialize event handlers
 */
export const initHandlers = async (config: HandlersConfig) => {
  initAttesterNewStateHandler(config)
  initPublisherTopUpHandler(config)

  console.log(
    `Handlers initialized (NEW attesters will be batched with ${DEBOUNCE_DELAY_MS / 1000}s debounce)`,
  );
};

const initAttesterNewStateHandler = async (config: HandlersConfig) => {
  // Initialize attester NEW state handler with debounced batch processing
  attesterNewStateHandler = new AttesterNewStateHandler(
    config.ethClient,
    config.providerId,
    config.safeClient,
    DEBOUNCE_DELAY_MS,
  );

  // Trigger debounced processing if there are any NEW attesters
  // This handles attesters that were already in NEW state from a previous run
  // All processing goes through the same debounced path for consistency
  attesterNewStateHandler.triggerDebouncedProcessing();
}

const initPublisherTopUpHandler = async (config: HandlersConfig) => {
  // Initialize publisher top up handler
  publisherTopUpHandler = new PublisherTopUpHandler(
    config.safeClient,
  );
}

/**
 * Shutdown handlers
 */
export const shutdownHandlers = async () => {
  // Cancel any pending debounced processing
  if (attesterNewStateHandler) {
    attesterNewStateHandler.cancelPendingProcessing();
  }

  // Cleanup handlers
  attesterNewStateHandler = null;
  publisherTopUpHandler = null;
};
