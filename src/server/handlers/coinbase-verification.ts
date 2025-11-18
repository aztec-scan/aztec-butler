/**
 * Coinbase verification handler
 *
 * Monitors coinbase address changes in keystores and verifies
 * that attesters are properly removed from the staking registry queue
 */

import type { CoinbaseChange } from "../state/index.js";
import type { EthereumClient } from "../../core/components/EthereumClient.js";
import {
  incrementCoinbaseChangesDetected,
  incrementCoinbaseVerificationChecks,
  incrementCoinbaseVerificationFailures,
  setAttesterQueueStatus,
} from "../metrics/coinbase-metrics.js";

export interface CoinbaseVerificationHandlerConfig {
  ethClient: EthereumClient;
  providerId: bigint;
  verificationDelayMs?: number;
}

/**
 * Handler for coinbase verification
 */
export class CoinbaseVerificationHandler {
  private readonly ethClient: EthereumClient;
  private readonly providerId: bigint;
  private readonly verificationDelayMs: number;

  constructor(config: CoinbaseVerificationHandlerConfig) {
    this.ethClient = config.ethClient;
    this.providerId = config.providerId;
    this.verificationDelayMs = config.verificationDelayMs ?? 5000; // Default 5 second delay
  }

  /**
   * Handle a coinbase change event
   */
  async handleCoinbaseChange(change: CoinbaseChange): Promise<void> {
    console.log(
      `[CoinbaseVerification] Processing coinbase change for attester ${change.attesterEth}`,
    );
    console.log(`  Previous coinbase: ${change.previousCoinbase || "none"}`);
    console.log(`  New coinbase: ${change.coinbaseAddress}`);
    console.log(
      `  Keystore: ${change.keystorePath} (ID: ${change.keystoreId})`,
    );

    // Increment metrics
    incrementCoinbaseChangesDetected();

    // Wait a bit to allow on-chain state to update
    // This accounts for timing differences between file updates and blockchain state
    if (this.verificationDelayMs > 0) {
      console.log(
        `[CoinbaseVerification] Waiting ${this.verificationDelayMs}ms before verification...`,
      );
      await new Promise((resolve) =>
        setTimeout(resolve, this.verificationDelayMs),
      );
    }

    // Verify queue status
    await this.verifyQueueStatus(change);
  }

  /**
   * Verify if an attester is still in the staking registry queue
   */
  private async verifyQueueStatus(change: CoinbaseChange): Promise<void> {
    try {
      incrementCoinbaseVerificationChecks();

      // Get current queue length
      const queueLength = await this.ethClient.getProviderQueueLength(
        this.providerId,
      );

      console.log(
        `[CoinbaseVerification] Current queue length for staking provider ${this.providerId}: ${queueLength}`,
      );

      // Update metrics
      setAttesterQueueStatus(Number(queueLength));

      // Note: We cannot directly check if a specific attester is in the queue
      // without additional contract methods. For now, we log the queue length
      // and alert if it's non-zero (which might indicate attesters are stuck in the queue)

      if (queueLength > 0n) {
        console.warn(
          `[CoinbaseVerification] ⚠️  WARNING: Staking provider has ${queueLength} attester(s) in queue`,
        );
        console.warn(
          `  This might include attester ${change.attesterEth} that should have been removed`,
        );
        console.warn(
          `  Expected: Attesters with coinbase addresses should be removed from queue`,
        );
        incrementCoinbaseVerificationFailures();
      } else {
        console.log(
          `[CoinbaseVerification] ✓ Queue is empty - expected state after coinbase addition`,
        );
      }

      // Additional context logging
      console.log(
        `[CoinbaseVerification] Verification complete for attester ${change.attesterEth}`,
      );
      console.log(`  BLS public key: ${change.attesterBls}`);
      console.log(`  Coinbase address: ${change.coinbaseAddress}`);
    } catch (error) {
      console.error(
        `[CoinbaseVerification] Error verifying queue status:`,
        error,
      );
      incrementCoinbaseVerificationFailures();
      throw error;
    }
  }

  /**
   * Shutdown the handler
   */
  async shutdown(): Promise<void> {
    console.log("[CoinbaseVerification] Shutting down...");
  }
}
