/**
 * Entry Queue Scraper
 *
 * Scrapes entry queue data from the rollup contract and calculates
 * time-based statistics for queue entry estimates.
 *
 * Implements the plan from plan-get-staking-entry-queue-stats.md
 */

import { AbstractScraper } from "./base-scraper.js";
import type { ButlerConfig } from "../../core/config/index.js";
import { AztecClient } from "../../core/components/AztecClient.js";
import { EthereumClient } from "../../core/components/EthereumClient.js";
import {
  updateEntryQueueStats,
  getStakingProviderData,
  getAttesterCoinbaseInfo,
} from "../state/index.js";
import type { EntryQueueStats } from "../../types/index.js";

/**
 * Fetch average L2 block time from Aztecscan API
 * @returns Block time in milliseconds, or null if fetch fails
 */
async function fetchL2BlockTime(): Promise<number | null> {
  try {
    const response = await fetch(
      "https://api.aztecscan.xyz/v1/temporary-api-key/l2/stats/average-block-time",
      { signal: AbortSignal.timeout(5000) }, // 5 second timeout
    );

    if (!response.ok) {
      console.warn(
        `Failed to fetch L2 block time from Aztecscan: ${response.status}`,
      );
      return null;
    }

    const blockTimeStr = await response.text();
    // API returns a JSON string like "84080", so parse it as JSON first
    const blockTimeMs = JSON.parse(blockTimeStr);

    if (typeof blockTimeMs !== "number" || blockTimeMs <= 0) {
      console.warn(
        `Invalid block time received from Aztecscan: ${blockTimeStr}`,
      );
      return null;
    }

    return blockTimeMs;
  } catch (error) {
    console.warn(`Error fetching L2 block time from Aztecscan:`, error);
    return null;
  }
}

/**
 * Scraper for entry queue statistics
 * Calculates time estimates for when attesters will become active
 */
export class EntryQueueScraper extends AbstractScraper {
  readonly name = "entry-queue";
  readonly network: string;

  private ethClient: EthereumClient | null = null;
  private isFirstScrape = true;

  constructor(
    network: string,
    private config: ButlerConfig,
    private pollIntervalMs: number,
  ) {
    super();
    this.network = network;
  }

  async init(): Promise<void> {
    // Initialize Aztec client
    const aztecClient = new AztecClient({
      nodeUrl: this.config.AZTEC_NODE_URL,
    });
    const nodeInfo = await aztecClient.getNodeInfo();

    // Validate chain ID matches config
    if (this.config.ETHEREUM_CHAIN_ID !== nodeInfo.l1ChainId) {
      throw new Error(
        `Chain ID mismatch: config has ${this.config.ETHEREUM_CHAIN_ID}, ` +
          `but node reports ${nodeInfo.l1ChainId}`,
      );
    }

    // Initialize Ethereum client
    this.ethClient = new EthereumClient({
      rpcUrl: this.config.ETHEREUM_NODE_URL,
      ...(this.config.ETHEREUM_ARCHIVE_NODE_URL
        ? { archiveRpcUrl: this.config.ETHEREUM_ARCHIVE_NODE_URL }
        : {}),
      chainId: nodeInfo.l1ChainId,
      rollupAddress: nodeInfo.l1ContractAddresses.rollupAddress.toString(),
    });

    console.log(`[${this.name}] Entry queue scraper initialized`);
  }

  async scrape(): Promise<void> {
    // Wait one poll interval on first scrape to allow other scrapers to populate data
    if (this.isFirstScrape) {
      console.log(
        `[${this.name}] First scrape - waiting ${this.pollIntervalMs / 1000}s for other scrapers to populate state`,
      );
      this.isFirstScrape = false;
      return;
    }

    if (!this.ethClient) {
      throw new Error("EthereumClient not initialized");
    }

    try {
      // 1. Fetch L2 block time from Aztecscan (with fallback)
      const l2BlockTimeMs = await fetchL2BlockTime();
      const DEFAULT_BLOCK_TIME_SEC = 30; // Fallback if API fails
      const l2BlockTimeSec = l2BlockTimeMs
        ? l2BlockTimeMs / 1000
        : DEFAULT_BLOCK_TIME_SEC;

      if (!l2BlockTimeMs) {
        console.warn(
          `[${this.name}] Failed to fetch L2 block time, using fallback: ${DEFAULT_BLOCK_TIME_SEC}s`,
        );
      } else {
        console.log(
          `[${this.name}] Using L2 block time: ${l2BlockTimeSec.toFixed(2)}s`,
        );
      }

      // 2. Fetch global entry queue data
      const totalQueueLength = await this.ethClient.getEntryQueueLength();
      const currentEpoch = await this.ethClient.getCurrentEpoch();
      const epochDurationSlots = await this.ethClient.getEpochDuration();
      const flushSize = await this.ethClient.getEntryQueueFlushSize();
      const availableFlushes =
        await this.ethClient.getAvailableValidatorFlushes();
      const nextFlushableEpoch = await this.ethClient.getNextFlushableEpoch();
      const isBootstrapped = await this.ethClient.getIsBootstrapped();

      // 3. Convert epoch duration from L2 slots to seconds using fetched block time
      const epochDuration =
        epochDurationSlots * BigInt(Math.floor(l2BlockTimeSec));

      // 4. Calculate time per attester (avoid division by zero)
      const timePerAttester =
        flushSize > 0n ? Number(epochDuration) / Number(flushSize) : 0;

      // 5. Get global entry queue attesters
      const globalQueue = await this.ethClient.getAllQueuedAttesters();

      // 6. Calculate last attester estimated entry timestamp
      const currentTimestamp = Math.floor(Date.now() / 1000);
      const lastAttesterPosition =
        globalQueue.length > 0 ? globalQueue.length - 1 : 0;
      const lastAttesterEstimatedEntryTimestamp =
        globalQueue.length > 0 && timePerAttester > 0
          ? currentTimestamp +
            Math.floor(lastAttesterPosition * timePerAttester)
          : currentTimestamp;

      // 7. Get provider data from state
      const providerData = getStakingProviderData(this.network);
      let providerId: bigint | null = null;
      let providerQueueCount = 0;
      let providerNextAttesterArrivalTimestamp: number | null = null;
      let providerNextMissingCoinbaseArrivalTimestamp: number | null = null;
      let providerNextMissingCoinbaseAddress: string | null = null;
      let providerLastAttesterArrivalTimestamp: number | null = null;

      if (providerData) {
        providerId = providerData.providerId;

        // 8. Get ALL attesters from state (not just provider queue)
        // This includes all attesters being tracked by the scraper
        const { getAttesterStates, getAttesterCoinbaseInfo } = await import(
          "../state/index.js"
        );
        const allAttesterStates = getAttesterStates(this.network);
        const coinbaseInfo = getAttesterCoinbaseInfo(this.network);

        // Find YOUR attesters in global entry queue with positions
        const providerAttestersInQueue = Array.from(allAttesterStates.values())
          .map((attesterState) => ({
            address: attesterState.attesterAddress,
            position: globalQueue.findIndex(
              (addr) =>
                addr.toLowerCase() ===
                attesterState.attesterAddress.toLowerCase(),
            ),
            coinbase: coinbaseInfo.get(attesterState.attesterAddress),
          }))
          .filter((item) => item.position !== -1) // Only those actually in entry queue
          .sort((a, b) => a.position - b.position);

        providerQueueCount = providerAttestersInQueue.length;

        // 9. Calculate timestamps for provider attesters
        if (providerAttestersInQueue.length > 0 && timePerAttester > 0) {
          // Next attester
          const nextAttester = providerAttestersInQueue[0]!;
          providerNextAttesterArrivalTimestamp =
            currentTimestamp +
            Math.floor(nextAttester.position * timePerAttester);

          // Last attester
          const lastAttester =
            providerAttestersInQueue[providerAttestersInQueue.length - 1]!;
          providerLastAttesterArrivalTimestamp =
            currentTimestamp +
            Math.floor(lastAttester.position * timePerAttester);

          // 10. Find next attester missing coinbase
          const nextMissingCoinbase = providerAttestersInQueue.find(
            (item) => !item.coinbase,
          );

          if (nextMissingCoinbase) {
            providerNextMissingCoinbaseArrivalTimestamp =
              currentTimestamp +
              Math.floor(nextMissingCoinbase.position * timePerAttester);
            providerNextMissingCoinbaseAddress = nextMissingCoinbase.address;
          }
        }
      }

      // 11. Build stats object
      const stats: EntryQueueStats = {
        totalQueueLength,
        currentEpoch,
        epochDuration,
        flushSize,
        availableFlushes,
        nextFlushableEpoch,
        isBootstrapped,
        timePerAttester,
        lastAttesterEstimatedEntryTimestamp,
        providerId,
        providerQueueCount,
        providerNextAttesterArrivalTimestamp,
        providerNextMissingCoinbaseArrivalTimestamp,
        providerNextMissingCoinbaseAddress,
        providerLastAttesterArrivalTimestamp,
        lastUpdated: new Date(),
      };

      console.log(
        `[${this.name}] Scraped: Queue Length: ${totalQueueLength}, ` +
          `Time per Attester: ${timePerAttester.toFixed(1)}s, ` +
          `Provider Attesters in Queue: ${providerQueueCount}`,
      );

      // 12. Update shared state
      updateEntryQueueStats(this.network, stats);
    } catch (error) {
      console.error(`[${this.name}] Error during scrape:`, error);
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    console.log(`[${this.name}] Shutting down...`);
    this.ethClient = null;
    updateEntryQueueStats(this.network, null);
  }
}
