import { getAddressFromPrivateKey } from "@aztec/ethereum";
import type { EthereumClient } from "../../core/components/EthereumClient.js";
import type { SafeGlobalClient } from "../../core/components/SafeGlobalClient.js";
import type { AttesterRegistration } from "../../types/index.js";
import {
  onAttesterStateChange,
  getDirData,
  getAttestersByState,
  AttesterState,
  updateAttesterState,
} from "../state/index.js";

/**
 * Handler for NEW attester state
 * Generates calldata for adding keys to staking provider
 * Uses debounced batching to process multiple NEW attesters together
 */
export class AttesterNewStateHandler {
  private ethClient: EthereumClient;
  private providerId: bigint;
  private safeClient: SafeGlobalClient | null;
  private processingTimer: NodeJS.Timeout | null = null;
  private readonly debounceDelayMs: number;

  constructor(
    ethClient: EthereumClient,
    providerId: bigint,
    safeClient: SafeGlobalClient | null,
    debounceDelayMs: number = 30_000, // Default: 30 seconds
  ) {
    this.ethClient = ethClient;
    this.providerId = providerId;
    this.safeClient = safeClient;
    this.debounceDelayMs = debounceDelayMs;

    // Subscribe to attester state changes
    onAttesterStateChange((attesterAddress, newState, _oldState) => {
      if (newState === AttesterState.NEW) {
        void this.handleNewAttester(attesterAddress).catch((error) => {
          console.error(
            `[AttesterNewStateHandler] Error handling NEW attester ${attesterAddress}:`,
            error,
          );
        });
      }
    });
  }

  /**
   * Get registration data for a specific attester
   * - Check if registration data exists in directory data
   * - Generate registration data if missing (in-memory only)
   * @returns AttesterRegistration or null if attester not found
   */
  private async getAttesterRegistrationData(
    attesterAddress: string,
  ): Promise<AttesterRegistration | null> {
    const dirData = getDirData();
    if (!dirData) {
      return null;
    }

    // Find the attester in keystores to get BLS key
    let keystoreId: string | undefined;
    let blsSecretKey: string | undefined;

    for (const keystore of dirData.keystores) {
      for (const validator of keystore.data.validators) {
        const address = getAddressFromPrivateKey(
          validator.attester.eth as `0x${string}`,
        );
        if (address === attesterAddress) {
          keystoreId = keystore.id;
          blsSecretKey = validator.attester.bls;
          break;
        }
      }
      if (keystoreId) break;
    }

    if (!keystoreId || !blsSecretKey) {
      console.error(
        `[AttesterNewStateHandler] Could not find attester ${attesterAddress} in keystores`,
      );
      return null;
    }

    try {
      // Check if registration data already exists
      let registrationData: AttesterRegistration | undefined;
      const existingRegistration = dirData.attesterRegistrations.find(
        (ar) => ar.id === keystoreId,
      );

      if (existingRegistration) {
        // Find this specific attester in the registration file
        registrationData = existingRegistration.data.find(
          (reg) => reg.attester === attesterAddress,
        );
      }

      // Generate registration data if missing
      if (!registrationData) {
        console.log(
          `[AttesterNewStateHandler] Generating registration data for ${attesterAddress}...`,
        );

        registrationData =
          await this.ethClient.generateAttesterRegistrationData(
            attesterAddress,
            blsSecretKey,
          );

        console.log(
          `[AttesterNewStateHandler] Generated registration data for ${attesterAddress}`,
        );
      }

      return registrationData;
    } catch (error) {
      console.error(
        `[AttesterNewStateHandler] Error getting registration data for attester ${attesterAddress}:`,
        error,
      );
      return null;
    }
  }

  /**
   * Handle attester entering NEW state
   * Schedules a debounced batch processing run
   */
  async handleNewAttester(attesterAddress: string): Promise<void> {
    console.log(
      `[AttesterNewStateHandler] NEW attester detected: ${attesterAddress}, scheduling debounced batch processing`,
    );

    // Reset the debounce timer - this delays processing if more attesters keep arriving
    this.scheduleDebouncedProcessing();
  }

  /**
   * Schedule debounced batch processing
   * If called multiple times, resets the timer (debounce behavior)
   */
  private scheduleDebouncedProcessing(): void {
    // Clear existing timer if any
    if (this.processingTimer) {
      clearTimeout(this.processingTimer);
    }

    // Schedule new batch processing
    this.processingTimer = setTimeout(() => {
      console.log(
        `[AttesterNewStateHandler] Debounce timer expired, processing batch now...`,
      );
      void this.processNewAttesters().catch((error) => {
        console.error(
          "[AttesterNewStateHandler] Error in debounced batch processing:",
          error,
        );
      });
      this.processingTimer = null;
    }, this.debounceDelayMs);

    console.log(
      `[AttesterNewStateHandler] Batch processing scheduled in ${this.debounceDelayMs / 1000}s (resets if more attesters arrive)`,
    );
  }

  /**
   * Manually trigger debounced processing
   * Useful for startup when attesters may already be in NEW state
   */
  public triggerDebouncedProcessing(): void {
    this.scheduleDebouncedProcessing();
  }

  /**
   * Cancel any pending debounced processing
   */
  public cancelPendingProcessing(): void {
    if (this.processingTimer) {
      clearTimeout(this.processingTimer);
      this.processingTimer = null;
      console.log(
        "[AttesterNewStateHandler] Cancelled pending batch processing",
      );
    }
  }

  /**
   * Process all attesters currently in NEW state
   * Called on startup and periodically
   * Batches all NEW attesters into a single transaction
   */
  async processNewAttesters(): Promise<void> {
    console.log("[AttesterNewStateHandler] Processing all NEW attesters...");

    const newAttesters = getAttestersByState(AttesterState.NEW);

    if (newAttesters.length === 0) {
      console.log("[AttesterNewStateHandler] No NEW attesters to process");
      return;
    }

    console.log(
      `[AttesterNewStateHandler] Found ${newAttesters.length} NEW attesters, batching into single transaction`,
    );

    // Collect registration data for all NEW attesters
    const registrationDataList: AttesterRegistration[] = [];
    const failedAttesters: string[] = [];

    for (const entry of newAttesters) {
      try {
        const regData = await this.getAttesterRegistrationData(
          entry.attesterAddress,
        );

        if (regData) {
          registrationDataList.push(regData);
        } else {
          console.error(
            `[AttesterNewStateHandler] Failed to get registration data for ${entry.attesterAddress}`,
          );
          failedAttesters.push(entry.attesterAddress);
        }
      } catch (error) {
        console.error(
          `[AttesterNewStateHandler] Error getting registration data for ${entry.attesterAddress}:`,
          error,
        );
        failedAttesters.push(entry.attesterAddress);
      }
    }

    // If no registration data was collected, exit early
    if (registrationDataList.length === 0) {
      console.error(
        "[AttesterNewStateHandler] No registration data collected, cannot proceed",
      );
      return;
    }

    console.log(
      `[AttesterNewStateHandler] Collected ${registrationDataList.length} registration data entries`,
    );
    if (failedAttesters.length > 0) {
      console.warn(
        `[AttesterNewStateHandler] Failed to get registration data for ${failedAttesters.length} attesters: ${failedAttesters.join(", ")}`,
      );
    }

    try {
      // Generate calldata with all registration data
      console.log(
        `[AttesterNewStateHandler] Generating batch calldata for ${registrationDataList.length} attesters...`,
      );

      const calldata = await this.ethClient.generateAddKeysToProviderCalldata(
        this.providerId,
        registrationDataList,
      );

      console.log(
        `[AttesterNewStateHandler] Generated batch calldata for ${registrationDataList.length} attesters`,
      );

      // Propose to Safe (logs for now)
      if (this.safeClient) {
        await this.safeClient.proposeTransaction({
          to: calldata.address,
          data: calldata.calldata,
          value: "0",
        });
        for (const newAttester of newAttesters) {
          updateAttesterState(newAttester.attesterAddress, AttesterState.WAITING_FOR_MULTISIG_SIGN);
        }
        console.log(
          `[AttesterNewStateHandler] Successfully proposed batch transaction for ${registrationDataList.length} attesters`,
        );
      } else {
        console.log(
          `[AttesterNewStateHandler] Safe client not configured, logging batch calldata for ${registrationDataList.length} attesters:`,
        );
        console.log(
          JSON.stringify(
            {
              to: calldata.address,
              data: calldata.calldata,
              attesterCount: registrationDataList.length,
              attesters: registrationDataList.map((r) => r.attester),
            },
            null,
            2,
          ),
        );
      }

      console.log(
        `[AttesterNewStateHandler] Successfully processed ${registrationDataList.length} attesters in batch`,
      );
    } catch (error) {
      console.error(
        "[AttesterNewStateHandler] Error processing batch transaction:",
        error,
      );
      // Don't transition state on error, allow retry
    }

    console.log("[AttesterNewStateHandler] Finished processing NEW attesters");
  }
}
