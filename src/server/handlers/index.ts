/**
 * Handlers module - event handlers that trigger actions
 *
 * This module contains:
 * - coinbase-verification.ts: Handles coinbase address verification
 */

import { onCoinbaseChange } from "../state/index.js";
import type { EthereumClient } from "../../core/components/EthereumClient.js";

export interface HandlersConfig {
  ethClient: EthereumClient;
  providerId: bigint;
}

/**
 * Initialize event handlers
 */
export const initHandlers = async (config: HandlersConfig) => {
  // TODO
  console.log("NO HANDLERS TO INITIALIZE");
};

/**
 * Shutdown handlers
 */
export const shutdownHandlers = async () => {
  // TODO
};
