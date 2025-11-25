import type { SafeGlobalClient } from "../../core/components/SafeGlobalClient.js";
import { parseEther } from "viem";
import {
  onPublisherBalanceUpdate,
} from "../state/index.js";

const TOP_UP_THRESHOLD = parseEther("0.05");

/**
 * Handler for publisher balance updates
 * Create transfer transactions to top up insufficient balances
 */
export class PublisherTopUpHandler {
  private safeClient: SafeGlobalClient | null;

  constructor(
    safeClient: SafeGlobalClient | null,
  ) {
    this.safeClient = safeClient;

    // Subscribe to attester state changes
    onPublisherBalanceUpdate((publisherAddress, _currentBalance, requiredTopup) => {
      if (requiredTopup >= TOP_UP_THRESHOLD) {
        void this.handleBalanceTopUp(publisherAddress, requiredTopup).catch((error) => {
          console.error(
            `[PublisherTopUpHandler] Error handling balance update ${publisherAddress}:`,
            error,
          );
        });
      }
    });
  }

  /**
   * Handle balance needing top up
   */
  async handleBalanceTopUp(publisherAddress: string, requiredTopup: bigint): Promise<void> {
    console.log(
      `[PublisherTopUpHandler] required top up detected: ${publisherAddress}`,
    );

    if (this.safeClient) {
      await this.safeClient.proposeTransaction({
        to: publisherAddress,
        value: requiredTopup.toString(),
        data: "0x",
      });
    }

  }
}
