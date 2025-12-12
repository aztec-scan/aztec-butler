import type { ObservableGauge } from "@opentelemetry/api";
import { createObservableGauge } from "./registry.js";
import type { StakingProviderScraper } from "../scrapers/staking-provider-scraper.js";

let stakingProviderQueueLengthGauge: ObservableGauge | null = null;
let stakingProviderConfigGauge: ObservableGauge | null = null;
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

    stakingProviderQueueLengthGauge.addCallback((observableResult) => {
      for (const [net, scraper] of scrapers.entries()) {
        const data = scraper.getData();

        if (!data) {
          // No data available (not configured or staking provider not registered)
          continue;
        }

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

    stakingProviderConfigGauge.addCallback((observableResult) => {
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

  console.log(`[${network}] Staking provider metrics initialized successfully`);
};
