import { AbstractScraper } from "./base-scraper.js";
import type { ButlerConfig } from "../../core/config/index.js";
import { EthereumClient } from "../../core/components/EthereumClient.js";
import { AztecClient } from "../../core/components/AztecClient.js";
import { getDockerDirData } from "../../core/utils/fileOperations.js";
import {
  getStakingProviderData,
  countAttestersByState,
  updateAttesterState,
  getAttesterState,
  AttesterState,
} from "../state/index.js";
import {
  setAttesterMissingCoinbase,
  clearMissingCoinbaseStatuses,
  recordAttesterInfo,
  clearAttesterInfo,
  updateAttesterStateCount,
  clearAttesterStateCounts,
} from "../metrics/coinbase-metrics.js";
import { getAddressFromPrivateKey } from "@aztec/ethereum";

/**
 * Scraper that polls the staking provider queue length and compares it
 * to the number of attesters in the DataDir that are missing coinbase addresses.
 *
 * This scraper depends on StakingProviderScraper to provide queue length data.
 */
export class CoinbaseQueueScraper extends AbstractScraper {
  readonly name = "coinbase-queue";

  private ethClient: EthereumClient | null = null;

  constructor(private config: ButlerConfig) {
    super();
  }

  async init(): Promise<void> {
    // Only initialize if staking provider admin is configured
    if (!this.config.PROVIDER_ADMIN_ADDRESS) {
      console.log(
        "Staking provider admin address not configured, coinbase queue scraper will not run",
      );
      return;
    }

    // Verify data directory exists
    await getDockerDirData(this.config.AZTEC_DOCKER_DIR);

    // Initialize Aztec client to get node info
    const aztecClient = new AztecClient({
      nodeUrl: this.config.AZTEC_NODE_URL,
    });
    const nodeInfo = await aztecClient.getNodeInfo();

    // Initialize Ethereum client
    this.ethClient = new EthereumClient({
      rpcUrl: this.config.ETHEREUM_NODE_URL,
      chainId: nodeInfo.l1ChainId,
      rollupAddress: nodeInfo.l1ContractAddresses.rollupAddress.toString(),
    });

    console.log(`Coinbase queue scraper initialized`);
  }

  async scrape(): Promise<void> {
    if (!this.ethClient) {
      // Not configured, skip
      return;
    }

    try {
      // Get staking provider data from shared state (populated by StakingProviderScraper)
      const stakingProviderData = getStakingProviderData();

      if (!stakingProviderData) {
        console.log(
          `[${this.name}] No staking provider data available, skipping scrape`,
        );
        return;
      }

      const providerId = stakingProviderData.providerId;
      const queueLength = stakingProviderData.queueLength;

      // Get attesters from DataDir
      const dirData = await getDockerDirData(this.config.AZTEC_DOCKER_DIR);

      // Clear previous metrics
      clearMissingCoinbaseStatuses();
      clearAttesterInfo();

      // Track attesters and their coinbase status
      const attesterAddresses: string[] = [];
      const attestersWithCoinbase: string[] = [];
      const attesterCoinbaseMap = new Map<string, string>();
      let attestersWithoutCoinbase = 0;

      for (const keystore of dirData.keystores) {
        for (const validator of keystore.data.validators) {
          // Derive address from private key
          const attesterAddress = getAddressFromPrivateKey(
            validator.attester.eth as `0x${string}`,
          );
          attesterAddresses.push(attesterAddress);

          const hasCoinbase = !!validator.coinbase;

          if (hasCoinbase) {
            attestersWithCoinbase.push(attesterAddress);
            attesterCoinbaseMap.set(attesterAddress, validator.coinbase!);
          } else {
            attestersWithoutCoinbase++;
          }

          // Set missing coinbase gauge (1 = missing, 0 = has coinbase)
          setAttesterMissingCoinbase(attesterAddress, !hasCoinbase);

          // State transition logic
          // Defensive initialization: ensure attester exists in state map
          // This provides self-healing if startup initialization failed
          let currentState = getAttesterState(attesterAddress);
          if (!currentState) {
            // New attester discovered, initialize as NEW
            updateAttesterState(attesterAddress, AttesterState.NEW);
            currentState = getAttesterState(attesterAddress)!;
          }

          if (currentState.state === AttesterState.ACTIVE) {
            if (!hasCoinbase) {
              console.error(
                `FATAL: Active attester without coinbase detected! ${attesterAddress}`,
              );
            }
          } else if (
            hasCoinbase &&
            currentState.state !== AttesterState.IN_STAKING_QUEUE
          ) {
            updateAttesterState(
              attesterAddress,
              AttesterState.IN_STAKING_QUEUE,
            );
          } else if (currentState.state === AttesterState.NEW) {
            // Check if in provider queue (stub for now, returns false)
            const isInProviderQueue = await this.isAttesterInProviderQueue(
              attesterAddress,
              providerId,
            );
            if (isInProviderQueue) {
              updateAttesterState(
                attesterAddress,
                AttesterState.IN_STAKING_PROVIDER_QUEUE,
              );
              // Then check coinbase
              if (!hasCoinbase) {
                updateAttesterState(attesterAddress, AttesterState.NO_COINBASE);
              }
            }
            // Otherwise stay in NEW
          } else if (
            currentState.state === AttesterState.IN_STAKING_PROVIDER_QUEUE
          ) {
            // Check coinbase status
            if (!hasCoinbase) {
              updateAttesterState(attesterAddress, AttesterState.NO_COINBASE);
            }
          } else if (currentState.state === AttesterState.NO_COINBASE) {
            // Check if coinbase was added
            if (hasCoinbase) {
              updateAttesterState(
                attesterAddress,
                AttesterState.IN_STAKING_QUEUE,
              );
            }
          }
        }
      }

      // Record static attester info metrics (only for attesters with coinbase)
      for (const [attester, coinbase] of attesterCoinbaseMap.entries()) {
        recordAttesterInfo(attester, coinbase);
      }

      // Update attester state count metrics
      clearAttesterStateCounts();
      const stateCounts = countAttestersByState();
      for (const [state, count] of stateCounts.entries()) {
        updateAttesterStateCount(state, count);
      }

      console.log(
        `[${this.name}] Scraped: ProviderId ${providerId}, Queue: ${queueLength}, Attesters without coinbase: ${attestersWithoutCoinbase}`,
      );
    } catch (error) {
      console.error(`[${this.name}] Error during scrape:`, error);
      throw error;
    }
  }

  /**
   * Check if an attester is in the provider's queue
   * @param attesterAddress - The attester's Ethereum address
   * @param providerId - The staking provider ID
   * @returns true if the attester is in the provider's queue
   */
  private async isAttesterInProviderQueue(
    attesterAddress: string,
    providerId: bigint,
  ): Promise<boolean> {
    // TODO: Implement actual on-chain check
    // Query staking registry contract for provider's queue
    // Return true if attesterAddress is found in the queue
    return false; // Stub for now
  }

  async shutdown(): Promise<void> {
    console.log(`[${this.name}] Shutting down...`);
    this.ethClient = null;
  }
}
