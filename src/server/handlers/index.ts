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

let publisherTopUpHandler: PublisherTopUpHandler | null = null;

/**
 * Initialize event handlers
 */
export const initHandlers = async (config: HandlersConfig) => {
  // Initialize publisher top up handler
  publisherTopUpHandler = new PublisherTopUpHandler(config.safeClient);

  console.log("Handlers initialized");
};

/**
 * Shutdown handlers
 */
export const shutdownHandlers = async () => {
  // Cleanup handlers
  publisherTopUpHandler = null;
};
