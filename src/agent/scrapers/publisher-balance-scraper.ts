/**
 * Publisher balance scraper.
 *
 * For publisher addresses referenced by THIS host's attesters, reads the L1
 * ETH balance and computes the required top-up:
 *
 *   requiredTopUp = max(0, attesterCount * MIN_ETH_PER_ATTESTER - balance)
 */

import { parseEther } from "viem";
import { AbstractScraper } from "../../server/scrapers/base-scraper.js";
import type { AgentChainContext } from "../chain.js";
import type { AgentConfig } from "../config.js";
import { getAgentState, markScraped } from "../state.js";

export class PublisherBalanceScraper extends AbstractScraper {
  readonly name = "publisher_balances";
  readonly network: string;

  private readonly minWeiPerAttester: bigint;

  constructor(
    private readonly config: AgentConfig,
    private readonly chain: AgentChainContext,
  ) {
    super();
    this.network = config.network;
    this.minWeiPerAttester = parseEther(config.minEthPerAttester);
  }

  async scrape(): Promise<void> {
    const state = getAgentState();
    if (state.local.publishers.size === 0) {
      console.log(`[${this.name}] No local publishers yet — skipping.`);
      return;
    }

    const client = this.chain.ethClient.getPublicClient();
    let scraped = 0;
    let underfunded = 0;

    for (const runtime of state.local.publishers.values()) {
      try {
        const balance = await client.getBalance({
          address: runtime.publisherAddress as `0x${string}`,
        });
        const required = BigInt(runtime.attesterCount) * this.minWeiPerAttester - balance;
        runtime.balanceWei = balance;
        runtime.requiredTopUpWei = required > 0n ? required : 0n;
        runtime.lastUpdated = new Date();
        if (runtime.requiredTopUpWei > 0n) underfunded++;
        scraped++;
      } catch (error) {
        console.warn(
          `[${this.name}] Failed to read balance for ${runtime.publisherAddress}: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    markScraped("local", this.name);
    console.log(
      `[${this.name}] Scraped ${scraped} publisher balance(s)` +
        (underfunded ? `, ${underfunded} underfunded` : ""),
    );
  }
}
