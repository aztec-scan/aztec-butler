/**
 * Publisher Metrics
 *
 * Prometheus metrics for tracking publisher ETH balances, load, and required top-ups
 */

import type { ObservableGauge } from "@opentelemetry/api";
import { createObservableGauge } from "./registry.js";
import { getPublisherData } from "../state/index.js";
import { formatEther } from "viem";

// Metrics instances
let publisherLoadGauge: ObservableGauge | null = null;
let publisherEthBalanceGauge: ObservableGauge | null = null;
let publisherCapacityRatioGauge: ObservableGauge | null = null;
let publisherRequiredTopupGauge: ObservableGauge | null = null;

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
    const data = getPublisherData();

    if (!data) {
      console.warn("No publisher data available for publisherLoadGauge");
      return;
    }

    for (const [_privKey, publisherData] of data.entries()) {
      observableResult.observe(publisherData.load, {
        publisher_address: publisherData.publisherAddress,
      });
    }
  });

  // Create observable gauge for publisher ETH balance (in ether for readability)
  publisherEthBalanceGauge = createObservableGauge("publisher_eth_balance", {
    description: "Current ETH balance of publisher address (in ether)",
  });

  publisherEthBalanceGauge.addCallback((observableResult) => {
    const data = getPublisherData();

    if (!data) {
      console.warn("No publisher data available for publisherEthBalanceGauge");
      return;
    }

    for (const [_privKey, publisherData] of data.entries()) {
      // Convert wei to ether for human-readable metrics
      const balanceInEther = parseFloat(
        formatEther(publisherData.currentBalance),
      );
      observableResult.observe(balanceInEther, {
        publisher_address: publisherData.publisherAddress,
      });
    }
  });

  // Create observable gauge for publisher capacity ratio (0.0 to 1.0+)
  publisherCapacityRatioGauge = createObservableGauge(
    "publisher_capacity_ratio",
    {
      description:
        "Publisher funding level as a ratio (1.0 = fully funded, <1.0 = underfunded, >1.0 = overfunded)",
    },
  );

  publisherCapacityRatioGauge.addCallback((observableResult) => {
    const data = getPublisherData();

    if (!data) {
      console.warn("No publisher data available for publisherCapacityRatioGauge");
      return;
    }

    for (const [_privKey, publisherData] of data.entries()) {
      // Calculate required full balance
      const requiredBalance =
        publisherData.currentBalance + publisherData.requiredTopup;

      // Calculate ratio (avoid division by zero)
      const ratio =
        requiredBalance > 0n
          ? parseFloat(formatEther(publisherData.currentBalance)) /
          parseFloat(formatEther(requiredBalance))
          : 1.0;

      observableResult.observe(ratio, {
        publisher_address: publisherData.publisherAddress,
      });
    }
  });

  // Create observable gauge for required ETH top-up (in ether)
  publisherRequiredTopupGauge = createObservableGauge(
    "publisher_required_topup",
    {
      description:
        "ETH required to reach recommended balance (0 if already sufficient, in ether)",
    },
  );

  publisherRequiredTopupGauge.addCallback((observableResult) => {
    const data = getPublisherData();

    if (!data) {
      console.warn("No publisher data available for publisherRequiredTopupGauge");
      return;
    }

    for (const [_privKey, publisherData] of data.entries()) {
      // Convert wei to ether for human-readable metrics
      const topupInEther = parseFloat(formatEther(publisherData.requiredTopup));
      observableResult.observe(topupInEther, {
        publisher_address: publisherData.publisherAddress,
      });
    }
  });

  console.log("Publisher metrics initialized successfully");
};
