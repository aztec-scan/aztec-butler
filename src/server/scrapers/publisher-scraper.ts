import { AbstractScraper } from "./base-scraper.js";
import type { ButlerConfig } from "../../core/config/index.js";
import { AztecClient } from "../../core/components/AztecClient.js";
import { EthereumClient } from "../../core/components/EthereumClient.js";
import { getDockerDirData } from "../../core/utils/fileOperations.js";
import { updatePublisherData } from "../state/index.js";
import { getAddressFromPrivateKey } from "@aztec/ethereum";
import { parseEther } from "viem";
import type {
  HexString,
  PublisherData,
  PublisherDataMap,
} from "../../types/index.js";

const RECOMMENDED_ETH_PER_ATTESTER = parseEther("0.1");

/**
 * Scraper for publisher ETH balances and required top-ups
 * Similar to the CLI command get-publisher-eth.ts but runs periodically
 */
export class PublisherScraper extends AbstractScraper {
  readonly name = "publisher";

  private ethClient: EthereumClient | null = null;
  private lastScrapedData: PublisherDataMap | null = null;

  constructor(private config: ButlerConfig) {
    super();
  }

  async init(): Promise<void> {
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

    // Initialize Ethereum client using node info
    this.ethClient = new EthereumClient({
      rpcUrl: this.config.ETHEREUM_NODE_URL,
      chainId: nodeInfo.l1ChainId,
      rollupAddress: nodeInfo.l1ContractAddresses.rollupAddress.toString(),
    });

    console.log(`Publisher scraper initialized`);
  }

  async scrape(): Promise<void> {
    if (!this.ethClient) {
      console.error("[publisher] Ethereum client not initialized");
      return;
    }

    try {
      // Get directory data with keystores
      const dirData = await getDockerDirData(this.config.AZTEC_DOCKER_DIR);
      const client = this.ethClient.getPublicClient();

      // Calculate publisher load (same logic as get-publisher-eth.ts)
      const publishers: Record<
        HexString,
        {
          load: number;
          currentBalance: bigint;
          requiredTopUp: bigint;
        }
      > = {};

      for (const keystore of dirData.keystores) {
        for (const validator of keystore.data.validators) {
          if (typeof validator.publisher === "string") {
            const publisherKey = validator.publisher as HexString;
            const pub = publishers[publisherKey] || {
              load: 0,
              currentBalance: 0n,
              requiredTopUp: 0n,
            };
            pub.load += 1;
            publishers[publisherKey] = pub;
          } else {
            const loadFactor = 1 / validator.publisher.length;
            for (const pubPrivKey of validator.publisher) {
              const publisherKey = pubPrivKey as HexString;
              const pub = publishers[publisherKey] || {
                load: 0,
                currentBalance: 0n,
                requiredTopUp: 0n,
              };
              pub.load += loadFactor;
              publishers[publisherKey] = pub;
            }
          }
        }
      }

      // Fetch balances for each publisher
      const publisherDataMap: PublisherDataMap = new Map();

      for (const [publisherPrivKey, info] of Object.entries(publishers)) {
        const privKey = publisherPrivKey as HexString;
        const pubAddr = getAddressFromPrivateKey(privKey);

        // Fetch current balance
        const currentBalance = await client.getBalance({
          address: pubAddr,
        });

        // Calculate required top-up
        const requiredTopUp =
          BigInt(Math.ceil(info.load)) * RECOMMENDED_ETH_PER_ATTESTER -
          currentBalance;

        const publisherData: PublisherData = {
          publisherAddress: pubAddr,
          publisherPrivateKey: privKey,
          load: info.load,
          currentBalance,
          requiredTopup: requiredTopUp > 0n ? requiredTopUp : 0n,
          lastUpdated: new Date(),
        };

        publisherDataMap.set(privKey, publisherData);
      }

      this.lastScrapedData = publisherDataMap;

      console.log(
        `[${this.name}] Scraped: ${publisherDataMap.size} publishers`,
      );

      // Update shared state
      updatePublisherData(this.lastScrapedData);
    } catch (error) {
      console.error(`[${this.name}] Error during scrape:`, error);
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    console.log(`[${this.name}] Shutting down...`);
    this.ethClient = null;
    this.lastScrapedData = null;
    updatePublisherData(null);
  }

  /**
   * Get the last scraped data
   */
  getData(): PublisherDataMap | null {
    return this.lastScrapedData;
  }
}
