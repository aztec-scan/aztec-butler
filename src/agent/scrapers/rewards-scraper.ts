/**
 * Staking-rewards scraper (Part 2 Phase A).
 *
 * A global scraper, opt-in via BUTLER_AGENT_REWARDS_ENABLED, that:
 *   1. discovers our coinbases purely from chain — `StakedWithProvider` events
 *      filtered by our native provider id (no key files);
 *   2. computes current pending rewards + our share per coinbase;
 *   3. tracks a cumulative `earned` figure from positive our-share deltas.
 *
 * Read-only, credential-free. Requires archive RPC for the event scan.
 */

import { getAddress } from "viem";
import { CoinbaseScraper } from "../../core/components/CoinbaseScraper.js";
import {
  accumulateEarned,
  computeCoinbaseReward,
  resolveRewardToken,
  toWholeTokens,
  type RewardToken,
} from "../../core/components/rewards-compute.js";
import { AbstractScraper } from "../../server/scrapers/base-scraper.js";
import type { AgentChainContext } from "../chain.js";
import type { AgentConfig } from "../config.js";
import { getAgentState, markScraped, type CoinbaseRewardState } from "../state.js";

export class RewardsStatsScraper extends AbstractScraper {
  readonly name = "rewards";
  readonly network: string;

  private rewardToken: RewardToken | null = null;
  private coinbaseScraper: CoinbaseScraper | null = null;

  constructor(
    private readonly config: AgentConfig,
    private readonly chain: AgentChainContext,
  ) {
    super();
    this.network = config.network;
  }

  async init(): Promise<void> {
    this.rewardToken = await resolveRewardToken(
      this.chain.ethClient,
      this.config.rewardTokenAddress,
    );
    console.log(
      `[${this.name}] Reward token ${this.rewardToken.address} (decimals=${this.rewardToken.decimals})`,
    );
  }

  async scrape(): Promise<void> {
    const provider = this.chain.providers.native;
    if (!provider || provider.providerId === null) {
      console.warn(
        `[${this.name}] No native provider resolved — skipping rewards scrape.`,
      );
      return;
    }

    const splitFromBlock = this.config.stakingRewardsSplitFromBlock;
    if (splitFromBlock === undefined) {
      console.warn(`[${this.name}] STAKING_REWARDS_SPLIT_FROM_BLOCK not set — skipping.`);
      return;
    }

    const rewardToken =
      this.rewardToken ??
      (this.rewardToken = await resolveRewardToken(
        this.chain.ethClient,
        this.config.rewardTokenAddress,
      ));

    // 1. Discover coinbases from chain (StakedWithProvider events, provider-filtered).
    if (!this.coinbaseScraper) {
      this.coinbaseScraper = new CoinbaseScraper({
        network: this.network,
        ethClient: this.chain.ethClient,
        providerId: provider.providerId,
        attesterAddresses: [], // discover-all mode
        defaultStartBlock: splitFromBlock,
      });
    }

    let coinbases: string[];
    try {
      const { mappings } = await this.coinbaseScraper.scrapeIncremental();
      const seen = new Set<string>();
      coinbases = [];
      for (const mapping of mappings) {
        const addr = getAddress(mapping.coinbaseAddress as `0x${string}`);
        if (!seen.has(addr.toLowerCase())) {
          seen.add(addr.toLowerCase());
          coinbases.push(addr);
        }
      }
    } catch (error) {
      console.error(`[${this.name}] Coinbase discovery failed:`, error);
      return;
    }

    // 2. Compute rewards per coinbase.
    const ourRecipient = this.config.safeAddress ?? provider.rewardsRecipient;
    const state = getAgentState();
    const now = new Date();
    let computed = 0;

    for (const coinbase of coinbases) {
      try {
        const reward = await computeCoinbaseReward(
          this.chain.ethClient,
          coinbase,
          ourRecipient,
          splitFromBlock,
        );
        if (!reward) {
          continue; // coinbase split contract not yet deployed
        }

        const key = coinbase.toLowerCase();
        const pendingAztec = toWholeTokens(reward.pendingRaw, rewardToken.decimals);
        const ourShareAztec = toWholeTokens(reward.ourShareRaw, rewardToken.decimals);
        const prev = state.global.rewards.get(key);
        const earnedAztec = accumulateEarned(
          prev?.earnedAztec ?? 0,
          prev?.ourShareAztec ?? ourShareAztec,
          ourShareAztec,
        );

        const next: CoinbaseRewardState = {
          coinbase,
          pendingAztec,
          ourShareAztec,
          earnedAztec,
          lastUpdated: now,
        };
        state.global.rewards.set(key, next);
        computed++;
      } catch (error) {
        console.error(
          `[${this.name}] Failed to compute reward for coinbase ${coinbase}:`,
          error,
        );
      }
    }

    markScraped("global", this.name);
    console.log(
      `[${this.name}] Computed rewards for ${computed}/${coinbases.length} coinbase(s)`,
    );
  }
}
