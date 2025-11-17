import { AbstractScraper } from "./base-scraper.js";
import type { ButlerConfig } from "../../core/config/index.js";
import { AztecClient } from "../../core/components/AztecClient.js";
import { EthereumClient } from "../../core/components/EthereumClient.js";
import { getDockerDirData } from "../../core/utils/fileOperations.js";

export interface ProviderData {
  providerId: bigint;
  queueLength: bigint;
  adminAddress: string;
  rewardsRecipient: string;
  lastUpdated: Date;
}

/**
 * Scraper for staking provider-related data from the staking registry
 */
export class ProviderScraper extends AbstractScraper {
  readonly name = "staking-provider";

  private ethClient: EthereumClient | null = null;
  private providerAdmin: string | null = null;
  private lastScrapedData: ProviderData | null = null;

  constructor(private config: ButlerConfig) {
    super();
  }

  async init(): Promise<void> {
    // Only initialize if provider admin is configured
    if (!this.config.PROVIDER_ADMIN_ADDRESS) {
      console.log(
        "Provider admin address not configured, provider scraper will not run",
      );
      return;
    }

    this.providerAdmin = this.config.PROVIDER_ADMIN_ADDRESS;

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
      `Provider scraper initialized for admin: ${this.providerAdmin}`,
    );
  }

  async scrape(): Promise<void> {
    if (!this.ethClient || !this.providerAdmin) {
      // Not configured, skip
      return;
    }

    try {
      // Get provider data from admin address
      const providerData = await this.ethClient.getStakingProvider(
        this.providerAdmin,
      );

      if (!providerData) {
        console.log(
          `Provider not registered for admin address: ${this.providerAdmin}`,
        );
        this.lastScrapedData = null;
        return;
      }

      // Get queue length for this provider
      const queueLength = await this.ethClient.getProviderQueueLength(
        providerData.providerId,
      );

      this.lastScrapedData = {
        providerId: providerData.providerId,
        queueLength,
        adminAddress: this.providerAdmin,
        rewardsRecipient: providerData.rewardsRecipient,
        lastUpdated: new Date(),
      };

      console.log(
        `[${this.name}] Scraped: Staking Provider ${providerData.providerId}, Queue Length: ${queueLength}`,
      );
    } catch (error) {
      console.error(`[${this.name}] Error during scrape:`, error);
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    console.log(`[${this.name}] Shutting down...`);
    this.ethClient = null;
    this.lastScrapedData = null;
  }

  /**
   * Get the last scraped data
   */
  getData(): ProviderData | null {
    return this.lastScrapedData;
  }
}
