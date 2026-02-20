import type { Attributes, ObservableGauge, ObservableResult } from "@opentelemetry/api";
import { createObservableGauge } from "./registry.js";
import type { StakingProviderScraper } from "../scrapers/staking-provider-scraper.js";

let stakingProviderQueueLengthGauge: ObservableGauge | null = null;
let stakingProviderConfigGauge: ObservableGauge | null = null;
let stakingProviderLastScrapedTimestampGauge: ObservableGauge | null = null;
const scrapers = new Map<string, StakingProviderScraper>();

/**
 * Initialize staking provider metrics that expose scraped staking provider data
 * This only sets up the metric exposure layer - scraping is done by StakingProviderScraper
 */
export const initStakingProviderMetrics = (
  network: string,
  stakingProviderScraper: StakingProviderScraper,
) => {
  scrapers.set(network, stakingProviderScraper);

  // Create the gauges on first initialization only
  if (!stakingProviderQueueLengthGauge) {
    stakingProviderQueueLengthGauge = createObservableGauge(
      "staking_provider_queue_length",
      {
        description: "Number of keys in the staking provider queue",
      },
    );

    stakingProviderQueueLengthGauge.addCallback(
      (observableResult: ObservableResult<Attributes>) => {
      const now = new Date().toISOString();
      console.log(`[Metrics/Callback] stakingProviderQueueLengthGauge invoked at ${now}`);
      
      for (const [net, scraper] of scrapers.entries()) {
        const data = scraper.getData();

        if (!data) {
          // No data available (not configured or staking provider not registered)
          console.log(`[Metrics/Callback/${net}] No staking provider data available`);
          continue;
        }

        console.log(`[Metrics/Callback/${net}] Staking provider queue length: ${data.queueLength}, last updated: ${data.lastUpdated}`);
        observableResult.observe(Number(data.queueLength), {
          network: net,
          staking_provider_id: data.providerId.toString(),
        });
      }
    });
  }

  if (!stakingProviderConfigGauge) {
    stakingProviderConfigGauge = createObservableGauge(
      "staking_provider_config_info",
      {
        description: "Staking provider configuration information",
      },
    );

    stakingProviderConfigGauge.addCallback(
      (observableResult: ObservableResult<Attributes>) => {
      for (const [net, scraper] of scrapers.entries()) {
        const data = scraper.getData();

        if (!data) {
          // No data available (not configured or staking provider not registered)
          continue;
        }

        observableResult.observe(1, {
          network: net,
          staking_provider_admin: data.adminAddress,
          staking_provider_id: data.providerId.toString(),
          rewards_recipient: data.rewardsRecipient,
        });
      }
    });
  }

  if (!stakingProviderLastScrapedTimestampGauge) {
    stakingProviderLastScrapedTimestampGauge = createObservableGauge(
      "staking_provider_last_scraped_timestamp",
      {
        description:
          "Unix timestamp when staking provider data was last scraped (for staleness detection)",
        unit: "seconds",
      },
    );

    stakingProviderLastScrapedTimestampGauge.addCallback(
      (observableResult: ObservableResult<Attributes>) => {
      for (const [net, scraper] of scrapers.entries()) {
        const data = scraper.getData();

        if (!data) {
          continue;
        }

        const timestamp = Math.floor(data.lastUpdated.getTime() / 1000);
        observableResult.observe(timestamp, {
          network: net,
          staking_provider_id: data.providerId.toString(),
        });
      }
    });
  }

  console.log(`[${network}] Staking provider metrics initialized successfully`);
};
