import { AbstractScraper } from "./base-scraper.js";
import type { ButlerConfig } from "../../core/config/index.js";
import { AztecClient } from "../../core/components/AztecClient.js";
import { EthereumClient } from "../../core/components/EthereumClient.js";
import {
  updateStakingProviderData,
  StakingProviderDataSchema,
  type StakingProviderData,
  getAttesterState,
  getAttesterStates,
  countAttestersByState,
} from "../state/index.js";
import { processAttesterState } from "../state/transitions.js";

/**
 * Scraper for staking provider-related data from the staking registry
 * Uses config and state instead of scraper config
 */
export class StakingProviderScraper extends AbstractScraper {
  readonly name = "staking-provider";
  readonly network: string;

  private ethClient: EthereumClient | null = null;
  private stakingProviderAdmin: string | null = null;
  private lastScrapedData: StakingProviderData | null = null;

  constructor(
    network: string,
    private config: ButlerConfig,
  ) {
    super();
    this.network = network;
  }

  async init(): Promise<void> {
    // Get admin address from config
    this.stakingProviderAdmin =
      this.config.AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS || null;

    if (!this.stakingProviderAdmin) {
      console.warn(
        `[${this.name}] AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS not configured, scraper will be inactive`,
      );
      return;
    }

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

    console.log(
      `[${this.name}] Staking provider scraper initialized for admin: ${this.stakingProviderAdmin}`,
    );
  }

  async scrape(): Promise<void> {
    if (!this.ethClient || !this.stakingProviderAdmin) {
      // Not configured, skip
      return;
    }

    try {
      // Get staking provider data from admin address
      const stakingProviderData = await this.ethClient.getStakingProvider(
        this.stakingProviderAdmin,
      );

      if (!stakingProviderData) {
        console.log(
          `[${this.name}] Staking provider not registered for admin address: ${this.stakingProviderAdmin}`,
        );
        this.lastScrapedData = null;
        return;
      }

      // Get queue length for this staking provider
      const queueLength = await this.ethClient.getProviderQueueLength(
        stakingProviderData.providerId,
      );

      // Fetch the actual queue contents
      const queue = await this.ethClient.getProviderQueue(
        stakingProviderData.providerId,
      );

      const rawData = {
        providerId: stakingProviderData.providerId,
        queueLength,
        queue,
        adminAddress: this.stakingProviderAdmin,
        rewardsRecipient: stakingProviderData.rewardsRecipient,
        lastUpdated: new Date(),
      };

      // Validate before storing
      this.lastScrapedData = StakingProviderDataSchema.parse(rawData);

      console.log(
        `[${this.name}] Scraped: Staking Provider ${stakingProviderData.providerId}, Queue Length: ${queueLength}`,
      );

      // Update shared state (now guaranteed to be valid)
      updateStakingProviderData(this.network, this.lastScrapedData);

      // Now handle attester state management
      await this.manageAttesterStates(stakingProviderData.providerId);
    } catch (error) {
      console.error(`[${this.name}] Error during scrape:`, error);
      throw error;
    }
  }

  /**
   * Manage attester states based on state and on-chain data
   */
  private async manageAttesterStates(providerId: bigint): Promise<void> {
    try {
      const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

      // Get attesters from state
      const attesterStates = getAttesterStates(this.network);
      const attestersToProcess = Array.from(attesterStates.keys()).map(
        (address) => {
          // Check if attester has coinbase by getting coinbase info from state
          // For now, we'll need to track this separately or get it from cached attesters
          // For simplicity, assume no coinbase (will be updated by state transitions)
          return {
            address,
            hasCoinbase: false, // This will be determined by state transitions
          };
        },
      );

      // Process each attester
      for (const { address, hasCoinbase } of attestersToProcess) {
        const currentState = getAttesterState(this.network, address);
        await processAttesterState(
          this.network,
          address,
          hasCoinbase,
          currentState?.state,
        );
      }

      // Log state counts
      const stateCounts = countAttestersByState(this.network);
      const stateCountsStr = Array.from(stateCounts.entries())
        .map(([state, count]) => `\n  ${state}: ${count}`)
        .join("");
      console.log(
        `[${this.name}] Attester States: ProviderId ${providerId}${stateCountsStr}`,
      );
    } catch (error) {
      console.error(`[${this.name}] Error managing attester states:`, error);
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    console.log(`[${this.name}] Shutting down...`);
    this.ethClient = null;
    this.lastScrapedData = null;
    updateStakingProviderData(this.network, null);
  }

  /**
   * Get the last scraped data
   */
  getData(): StakingProviderData | null {
    return this.lastScrapedData;
  }
}
