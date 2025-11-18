import { AbstractScraper } from "./base-scraper.js";
import type { ButlerConfig } from "../../core/config/index.js";
import { AztecClient } from "../../core/components/AztecClient.js";
import { EthereumClient } from "../../core/components/EthereumClient.js";
import { getDockerDirData } from "../../core/utils/fileOperations.js";
import {
  updateStakingProviderData,
  StakingProviderDataSchema,
  type StakingProviderData,
} from "../state/index.js";

/**
 * Scraper for staking provider-related data from the staking registry
 */
export class StakingProviderScraper extends AbstractScraper {
  readonly name = "staking-provider";

  private ethClient: EthereumClient | null = null;
  private stakingProviderAdmin: string | null = null;
  private lastScrapedData: StakingProviderData | null = null;

  constructor(private config: ButlerConfig) {
    super();
  }

  async init(): Promise<void> {
    // Only initialize if staking provider admin is configured
    if (!this.config.PROVIDER_ADMIN_ADDRESS) {
      console.log(
        "Staking provider admin address not configured, staking provider scraper will not run",
      );
      return;
    }

    this.stakingProviderAdmin = this.config.PROVIDER_ADMIN_ADDRESS;

    // Get data from Docker directory like the CLI does
    const data = await getDockerDirData(this.config.AZTEC_DOCKER_DIR);
    if (this.config.AZTEC_NODE_URL !== data.l2RpcUrl) {
      console.warn(
        `⚠️ Warning: AZTEC_NODE_URL in config (${this.config.AZTEC_NODE_URL}) does not match L2 RPC URL in docker dir (${data.l2RpcUrl})`,
      );
    }

    // Initialize Aztec client to get node info
    const aztecClient = new AztecClient({
      nodeUrl: this.config.AZTEC_NODE_URL,
    });
    const nodeInfo = await aztecClient.getNodeInfo();

    if (this.config.ETHEREUM_NODE_URL !== data.l1RpcUrl) {
      console.warn(
        `⚠️ Warning: ETHEREUM_NODE_URL in config (${this.config.ETHEREUM_NODE_URL}) does not match L1 RPC URL in docker dir (${data.l1RpcUrl})`,
      );
    }

    // Initialize Ethereum client using node info instead of hardcoded defaults
    this.ethClient = new EthereumClient({
      rpcUrl: this.config.ETHEREUM_NODE_URL,
      chainId: nodeInfo.l1ChainId,
      rollupAddress: nodeInfo.l1ContractAddresses.rollupAddress.toString(),
    });

    console.log(
      `Staking provider scraper initialized for admin: ${this.stakingProviderAdmin}`,
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
          `Staking provider not registered for admin address: ${this.stakingProviderAdmin}`,
        );
        this.lastScrapedData = null;
        return;
      }

      // Get queue length for this staking provider
      const queueLength = await this.ethClient.getProviderQueueLength(
        stakingProviderData.providerId,
      );

      const rawData = {
        providerId: stakingProviderData.providerId,
        queueLength,
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
      updateStakingProviderData(this.lastScrapedData);
    } catch (error) {
      console.error(`[${this.name}] Error during scrape:`, error);
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    console.log(`[${this.name}] Shutting down...`);
    this.ethClient = null;
    this.lastScrapedData = null;
    updateStakingProviderData(null);
  }

  /**
   * Get the last scraped data
   */
  getData(): StakingProviderData | null {
    return this.lastScrapedData;
  }
}
