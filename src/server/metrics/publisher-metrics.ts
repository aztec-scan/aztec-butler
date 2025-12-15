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

      // Calculate load for each publisher
      // Since we don't know which attester uses which publisher (varies by server in HA mode),
      // we assume even distribution for monitoring purposes
      const attesterCount = scraperConfig.attesters.length;
      const publisherCount = scraperConfig.publishers.length;
      const attestersPerPublisher = Math.ceil(attesterCount / publisherCount);

      for (const [_privKey, publisherData] of data.entries()) {
        // Find the server ID for this publisher from the scraper config
        const publisherConfig = scraperConfig.publishers.find(
          (p) =>
            p.address.toLowerCase() ===
            publisherData.publisherAddress.toLowerCase(),
        );
        const serverId = publisherConfig?.serverId || "unknown";

        observableResult.observe(attestersPerPublisher, {
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
