import type { ObservableGauge } from "@opentelemetry/api";
import { createObservableGauge } from "./registry.js";
import type { StakingProviderScraper } from "../scrapers/staking-provider-scraper.js";

let stakingProviderQueueLengthGauge: ObservableGauge | null = null;
let stakingProviderConfigGauge: ObservableGauge | null = null;
let scraper: StakingProviderScraper | null = null;

/**
 * Initialize staking provider metrics that expose scraped staking provider data
 * This only sets up the metric exposure layer - scraping is done by StakingProviderScraper
 */
export const initStakingProviderMetrics = (
  stakingProviderScraper: StakingProviderScraper,
) => {
  scraper = stakingProviderScraper;

  // Create observable gauge for staking provider queue length
  // This metric only has staking_provider_id as a label
  stakingProviderQueueLengthGauge = createObservableGauge(
    "staking_provider_queue_length",
    {
      description: "Number of keys in the staking provider queue",
    },
  );

  stakingProviderQueueLengthGauge.addCallback((observableResult) => {
    if (!scraper) {
      return;
    }

    const data = scraper.getData();

    if (!data) {
      // No data available (not configured or staking provider not registered)
      return;
    }

    observableResult.observe(Number(data.queueLength), {
      staking_provider_id: data.providerId.toString(),
    });
  });

  // Create observable gauge for staking provider configuration
  // This metric has all configuration details as labels with a constant value of 1
  stakingProviderConfigGauge = createObservableGauge(
    "staking_provider_config_info",
    {
      description: "Staking provider configuration information",
    },
  );

  stakingProviderConfigGauge.addCallback((observableResult) => {
    if (!scraper) {
      return;
    }

    const data = scraper.getData();

    if (!data) {
      // No data available (not configured or staking provider not registered)
      return;
    }

    observableResult.observe(1, {
      staking_provider_admin: data.adminAddress,
      staking_provider_id: data.providerId.toString(),
      rewards_recipient: data.rewardsRecipient,
    });
  });

  console.log("Staking provider metrics initialized successfully");
};
