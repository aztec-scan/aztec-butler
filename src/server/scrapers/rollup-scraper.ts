import { AbstractScraper } from "./base-scraper.js";
import type { ButlerConfig } from "../../core/config/index.js";
import { AztecClient } from "../../core/components/AztecClient.js";
import { EthereumClient } from "../../core/components/EthereumClient.js";
import { updateAttesterOnChainView, getScraperConfig } from "../state/index.js";
import { AttesterOnChainStatus } from "../../types/index.js";

/**
 * Scraper for attester on-chain status from the rollup contract
 * Fetches getAttesterView for each attester to track their on-chain status
 * Uses scraper config from state (loaded at server initialization)
 */
export class RollupScraper extends AbstractScraper {
  readonly name = "rollup";
  readonly network: string;

  private ethClient: EthereumClient | null = null;

  constructor(
    network: string,
    private config: ButlerConfig,
  ) {
    super();
    this.network = network;
  }

  async init(): Promise<void> {
    // Initialize Aztec client to get node info
    const aztecClient = new AztecClient({
      nodeUrl: this.config.AZTEC_NODE_URL,
    });
    const nodeInfo = await aztecClient.getNodeInfo();

    // Initialize Ethereum client using node info
    this.ethClient = new EthereumClient({
      rpcUrl: this.config.ETHEREUM_NODE_URL,
      ...(this.config.ETHEREUM_ARCHIVE_NODE_URL
        ? { archiveRpcUrl: this.config.ETHEREUM_ARCHIVE_NODE_URL }
        : {}),
      chainId: nodeInfo.l1ChainId,
      rollupAddress: nodeInfo.l1ContractAddresses.rollupAddress.toString(),
    });

    console.log(
      `Rollup scraper initialized for chain ID: ${nodeInfo.l1ChainId}`,
    );
  }

  async scrape(): Promise<void> {
    if (!this.ethClient) {
      console.warn("[rollup] Ethereum client not initialized, skipping scrape");
      return;
    }

    try {
      // Get attesters from scraper config in state
      const scraperConfig = getScraperConfig(this.network);
      if (!scraperConfig) {
        console.warn("[rollup] Scraper config not loaded, skipping scrape");
        return;
      }

      let totalAttesters = 0;
      let onChainAttesters = 0;
      const statusCounts = new Map<AttesterOnChainStatus, number>();

      // Initialize status counts
      for (const status of Object.values(AttesterOnChainStatus)) {
        if (typeof status === "number") {
          statusCounts.set(status, 0);
        }
      }

      // Process each attester from scraper config
      for (const attester of scraperConfig.attesters) {
        totalAttesters++;

        // Fetch attester view from rollup contract
        const attesterView = await this.ethClient.getAttesterView(
          attester.address,
        );

        if (attesterView) {
          // Update state with on-chain view
          updateAttesterOnChainView(
            this.network,
            attester.address,
            attesterView,
          );

          // Track statistics
          if (attesterView.status !== AttesterOnChainStatus.NONE) {
            onChainAttesters++;
          }
          statusCounts.set(
            attesterView.status,
            (statusCounts.get(attesterView.status) || 0) + 1,
          );
        } else {
          // No view returned (not on-chain or error)
          updateAttesterOnChainView(this.network, attester.address, null);
          statusCounts.set(
            AttesterOnChainStatus.NONE,
            (statusCounts.get(AttesterOnChainStatus.NONE) || 0) + 1,
          );
        }
      }

      // Log summary
      const statusStr = Array.from(statusCounts.entries())
        .map(([status, count]) => {
          const statusName = AttesterOnChainStatus[status];
          return `\n  ${statusName}: ${count}`;
        })
        .join("");

      console.log(
        `[${this.name}] Scraped ${totalAttesters} attesters, ${onChainAttesters} on-chain${statusStr}`,
      );
    } catch (error) {
      console.error(`[${this.name}] Error during scrape:`, error);
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    console.log(`[${this.name}] Shutting down...`);
    this.ethClient = null;
  }
}
