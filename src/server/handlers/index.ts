/**
 * Handlers module - event handlers that trigger actions
 *
 * This module contains:
 * - publisher-top-up-handler.ts: Handles publisher balance monitoring
 *
 * Note: AttesterNewStateHandler removed - use CLI commands to add keys to provider
 * Server mode has no access to private keys required for registration data generation
 */

import type { SafeGlobalClient } from "../../core/components/SafeGlobalClient.js";
import { PublisherTopUpHandler } from "./publisher-top-up-handler.js";

export interface HandlersConfig {
  safeClient: SafeGlobalClient | null;
}

// Map of network -> handler instances
const publisherTopUpHandlers = new Map<string, PublisherTopUpHandler>();

/**
 * Initialize event handlers for a specific network
 */
export const initHandlers = async (network: string, config: HandlersConfig) => {
  // Initialize publisher top up handler for this network
  const publisherTopUpHandler = new PublisherTopUpHandler(
    network,
    config.safeClient,
  );
  publisherTopUpHandlers.set(network, publisherTopUpHandler);

  console.log(`[${network}] Handlers initialized`);
};

/**
 * Shutdown handlers for a specific network (or all if no network specified)
 */
export const shutdownHandlers = async (network?: string) => {
  if (network) {
    publisherTopUpHandlers.delete(network);
    console.log(`[${network}] Handlers shut down`);
  } else {
    publisherTopUpHandlers.clear();
    console.log("All handlers shut down");
  }
};
