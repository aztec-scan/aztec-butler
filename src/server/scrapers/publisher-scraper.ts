import { AbstractScraper } from "./base-scraper.js";
import type { ButlerConfig } from "../../core/config/index.js";
import { AztecClient } from "../../core/components/AztecClient.js";
import { EthereumClient } from "../../core/components/EthereumClient.js";
import { updatePublisherData, getAttesterStates } from "../state/index.js";
import { parseEther } from "viem";
import type { HexString, PublisherDataMap } from "../../types/index.js";

/**
 * Scraper for publisher ETH balances and required top-ups
 * Uses config and state instead of scraper config
 */
export class PublisherScraper extends AbstractScraper {
  readonly name = "publisher";
  readonly network: string;

  private ethClient: EthereumClient | null = null;
  private lastScrapedData: PublisherDataMap | null = null;
  private recommendedEthPerAttester: bigint = 0n;
  private publishers: string[] = [];

  constructor(
    network: string,
    private config: ButlerConfig,
    publishers: string[],
  ) {
    super();
    this.network = network;
    this.recommendedEthPerAttester = parseEther(config.MIN_ETH_PER_ATTESTER);
    this.publishers = publishers;
  }

  async init(): Promise<void> {
    // Initialize Aztec client to get node info
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
      `[${this.name}] Publisher scraper initialized with ${this.publishers.length} publisher(s)`,
    );
  }

  async scrape(): Promise<void> {
    if (!this.ethClient) {
      console.error(`[${this.name}] Ethereum client not initialized`);
      return;
    }

    if (this.publishers.length === 0) {
      // No publishers configured, skip
      return;
    }

    try {
      const publisherDataMap: PublisherDataMap = new Map();
      const client = this.ethClient.getPublicClient();

      // Use unique publishers
      const uniquePublishers = new Set<string>(this.publishers);

      // Calculate attesters per publisher for top-up calculation
      // Get attester count from state
      const attesterStates = getAttesterStates(this.network);
      const attesterCount = attesterStates.size;
      const publisherCount = uniquePublishers.size;
      const attestersPerPublisher =
        publisherCount > 0 ? Math.ceil(attesterCount / publisherCount) : 0;

      // Scrape balances for each unique publisher
      for (const publisherAddress of uniquePublishers) {
        const currentBalance = await client.getBalance({
          address: publisherAddress as `0x${string}`,
        });

        const requiredTopUp =
          BigInt(attestersPerPublisher) * this.recommendedEthPerAttester -
          currentBalance;

        publisherDataMap.set(publisherAddress as HexString, {
          publisherAddress: publisherAddress as `0x${string}`,
          publisherPrivateKey: "0x" as HexString, // Not available in scraper mode
          currentBalance,
          requiredTopup: requiredTopUp > 0n ? requiredTopUp : 0n,
          lastUpdated: new Date(),
        });
      }

      this.lastScrapedData = publisherDataMap;
      console.log(
        `[${this.name}] Scraped: ${publisherDataMap.size} publishers`,
      );
      updatePublisherData(this.network, this.lastScrapedData);
    } catch (error) {
      console.error(`[${this.name}] Error during scrape:`, error);
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    console.log(`[${this.name}] Shutting down...`);
    this.ethClient = null;
    this.lastScrapedData = null;
    updatePublisherData(this.network, null);
  }

  /**
   * Get the last scraped data
   */
  getData(): PublisherDataMap | null {
    return this.lastScrapedData;
  }
}
