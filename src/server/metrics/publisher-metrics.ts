/**
 * Publisher Metrics
 *
 * Prometheus metrics for tracking publisher ETH balances, load, and required top-ups
 */

import type { ObservableGauge } from "@opentelemetry/api";
import { createObservableGauge } from "./registry.js";
import {
  getPublisherData,
  getScraperConfig,
  getAllNetworkStates,
} from "../state/index.js";
import { formatEther } from "viem";

// Metrics instances
let publisherLoadGauge: ObservableGauge | null = null;
let publisherEthBalanceGauge: ObservableGauge | null = null;

/**
 * Initialize publisher metrics that expose publisher ETH balance and load data
 * This only sets up the metric exposure layer - data comes from shared state
 */
export const initPublisherMetrics = () => {
  // Create observable gauge for publisher load (number of validators)
  publisherLoadGauge = createObservableGauge("publisher_load", {
    description:
      "Number of validators using this publisher (can be fractional for shared publishers)",
  });

  publisherLoadGauge.addCallback((observableResult) => {
    const networkStates = getAllNetworkStates();

    for (const [network, _state] of networkStates.entries()) {
      const data = getPublisherData(network);
      const scraperConfig = getScraperConfig(network);

      if (!data) {
        continue;
      }

      if (!scraperConfig) {
        continue;
      }

      // Use actual attester count per publisher from config
      for (const [_privKey, publisherData] of data.entries()) {
        // Find the publisher config to get the actual attester count
        const publisherConfig = scraperConfig.publishers.find(
          (p) =>
            p.address.toLowerCase() ===
            publisherData.publisherAddress.toLowerCase(),
        );

        if (!publisherConfig) {
          console.warn(
            `[publisher-metrics] Publisher ${publisherData.publisherAddress} not found in config`,
          );
          continue;
        }

        const serverId = publisherConfig.serverId || "unknown";
        // Use actual attester count from config instead of evenly distributed assumption
        const attesterCount = publisherConfig.attesterCount || 0;

        observableResult.observe(attesterCount, {
          network,
          publisher_address: publisherData.publisherAddress,
          server: serverId,
        });
      }
    }
  });

  // Create observable gauge for publisher ETH balance (in ether for readability)
  publisherEthBalanceGauge = createObservableGauge("publisher_eth_balance", {
    description: "Current ETH balance of publisher address (in ether)",
  });

  publisherEthBalanceGauge.addCallback((observableResult) => {
    const networkStates = getAllNetworkStates();

    for (const [network, _state] of networkStates.entries()) {
      const data = getPublisherData(network);
      const scraperConfig = getScraperConfig(network);

      if (!data) {
        continue;
      }

      if (!scraperConfig) {
        continue;
      }

      for (const [_privKey, publisherData] of data.entries()) {
        // Find the server ID for this publisher from the scraper config
        const publisherConfig = scraperConfig.publishers.find(
          (p) =>
            p.address.toLowerCase() ===
            publisherData.publisherAddress.toLowerCase(),
        );
        const serverId = publisherConfig?.serverId || "unknown";

        // Convert wei to ether for human-readable metrics
        const balanceInEther = parseFloat(
          formatEther(publisherData.currentBalance),
        );
        observableResult.observe(balanceInEther, {
          network,
          publisher_address: publisherData.publisherAddress,
          server: serverId,
        });
      }
    }
  });

  console.log("Publisher metrics initialized successfully");
};
