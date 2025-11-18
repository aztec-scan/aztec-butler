/**
 * Handlers module - event handlers that trigger actions
 *
 * This module contains:
 * - coinbase-verification.ts: Handles coinbase address verification
 */

import { CoinbaseVerificationHandler } from "./coinbase-verification.js";
import { onCoinbaseChange } from "../state/index.js";
import type { EthereumClient } from "../../core/components/EthereumClient.js";

let coinbaseHandler: CoinbaseVerificationHandler | null = null;

export interface HandlersConfig {
  ethClient: EthereumClient;
  providerId: bigint;
}

/**
 * Initialize event handlers
 */
export const initHandlers = async (config: HandlersConfig) => {
  console.log("Initializing coinbase verification handler...");

  coinbaseHandler = new CoinbaseVerificationHandler({
    ethClient: config.ethClient,
    providerId: config.providerId,
    verificationDelayMs: 5000, // 5 second delay before verification
  });

  // Register handler for coinbase changes
  onCoinbaseChange((change) => {
    if (coinbaseHandler) {
      void coinbaseHandler.handleCoinbaseChange(change);
    }
  });

  console.log("Coinbase verification handler initialized successfully");
};

/**
 * Shutdown handlers
 */
export const shutdownHandlers = async () => {
  if (coinbaseHandler) {
    await coinbaseHandler.shutdown();
    coinbaseHandler = null;
    console.log("Coinbase verification handler shut down");
  }
};

export { CoinbaseVerificationHandler };
