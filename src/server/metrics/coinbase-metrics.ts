/**
 * Coinbase queue metrics
 *
 * Prometheus metrics for tracking attesters missing coinbase addresses
 * and their relationship to the staking provider queue.
 */

import type { ObservableGauge } from "@opentelemetry/api";
import { createObservableGauge } from "./registry.js";

// Metrics instances
let attesterInfoGauge: ObservableGauge | null = null;
let coinbaseInfoGauge: ObservableGauge | null = null;
let attesterMissingCoinbaseGauge: ObservableGauge | null = null;
let nbrofAttestersInStateGauge: ObservableGauge | null = null;

// Store current values for observable gauges
const attesterInfoMap = new Map<string, number>();
const coinbaseInfoMap = new Map<string, number>();
const attesterMissingCoinbaseMap = new Map<string, number>();
const attesterStateCountMap = new Map<string, number>();

/**
 * Initialize coinbase queue metrics
 */
export const initCoinbaseMetrics = () => {
  // Observable Gauge: Static attester information
  attesterInfoGauge = createObservableGauge("attester_info", {
    description: "Static information about registered attesters (value=1)",
  });

  // Observable Gauge: Static coinbase information
  coinbaseInfoGauge = createObservableGauge("coinbase_info", {
    description: "Static information about coinbase addresses (value=1)",
  });

  // Observable Gauge: Attesters missing coinbase address (0 or 1 per attester)
  attesterMissingCoinbaseGauge = createObservableGauge(
    "attesters_missing_coinbase_address",
    {
      description:
        "Attesters missing coinbase address (0=has coinbase, 1=missing coinbase)",
    },
  );

  // Observable Gauge: Number of attesters in each state
  nbrofAttestersInStateGauge = createObservableGauge(
    "nbrof_attesters_in_state",
    {
      description: "Number of attesters in each state",
    },
  );

  // Add callbacks to observe the gauge values
  attesterInfoGauge.addCallback((observableResult) => {
    for (const [attester, value] of attesterInfoMap.entries()) {
      observableResult.observe(value, { attester_address: attester });
    }
  });

  attesterMissingCoinbaseGauge.addCallback((observableResult) => {
    for (const [attester, value] of attesterMissingCoinbaseMap.entries()) {
      observableResult.observe(value, { attester_address: attester });
    }
  });

  nbrofAttestersInStateGauge.addCallback((observableResult) => {
    for (const [state, count] of attesterStateCountMap.entries()) {
      observableResult.observe(count, { attester_state: state });
    }
  });

  coinbaseInfoGauge.addCallback((observableResult) => {
    for (const [coinbase, value] of coinbaseInfoMap.entries()) {
      observableResult.observe(value, { coinbase_address: coinbase });
    }
  });

  console.log("Coinbase queue metrics initialized successfully");
};

/**
 * Set missing coinbase status for an attester (0 = has coinbase, 1 = missing)
 */
export const setAttesterMissingCoinbase = (
  attesterAddress: string,
  isMissing: boolean,
) => {
  attesterMissingCoinbaseMap.set(attesterAddress, isMissing ? 1 : 0);
};

/**
 * Clear all missing coinbase statuses (for refresh)
 */
export const clearMissingCoinbaseStatuses = () => {
  attesterMissingCoinbaseMap.clear();
};

/**
 * Record attester information (static metric with value=1)
 */
export const recordAttesterInfo = (attester: string) => {
  attesterInfoMap.set(attester, 1);
};

/**
 * Clear all attester info (for refresh)
 */
export const clearAttesterInfo = () => {
  attesterInfoMap.clear();
};

/**
 * Record coinbase information (static metric with value=1)
 */
export const recordCoinbaseInfo = (coinbase: string) => {
  coinbaseInfoMap.set(coinbase, 1);
};

/**
 * Clear all coinbase info (for refresh)
 */
export const clearCoinbaseInfo = () => {
  coinbaseInfoMap.clear();
};

/**
 * Update attester state count metrics
 */
export const updateAttesterStateCount = (state: string, count: number) => {
  attesterStateCountMap.set(state, count);
};

/**
 * Clear all attester state counts (for refresh)
 */
export const clearAttesterStateCounts = () => {
  attesterStateCountMap.clear();
};
