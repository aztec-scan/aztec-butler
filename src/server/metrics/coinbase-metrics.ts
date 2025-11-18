/**
 * Coinbase queue metrics
 *
 * Prometheus metrics for tracking attesters missing coinbase addresses
 * and their relationship to the staking provider queue.
 */

import type { ObservableGauge } from "@opentelemetry/api";
import { createObservableGauge } from "./registry.js";
import { AttesterState } from "../state/index.js";

// Metrics instances
let attesterInfoGauge: ObservableGauge | null = null;
let attesterMissingCoinbaseGauge: ObservableGauge | null = null;
let nbrofAttestersInStateGauge: ObservableGauge | null = null;

// Store current values for observable gauges
const attesterInfoMap = new Map<string, { value: number; coinbase: string }>();
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
    for (const [attester, data] of attesterInfoMap.entries()) {
      observableResult.observe(data.value, {
        attester_address: attester,
        coinbase_address: data.coinbase,
      });
    }
  });

  attesterMissingCoinbaseGauge.addCallback((observableResult) => {
    for (const [attester, value] of attesterMissingCoinbaseMap.entries()) {
      observableResult.observe(value, { attester_address: attester });
    }
  });

  nbrofAttestersInStateGauge.addCallback((observableResult) => {
    // Always ensure all states are present, even if map is empty
    // Get all possible states from the enum to maintain single source of truth
    const allStates = Object.values(AttesterState);

    for (const state of allStates) {
      const count = attesterStateCountMap.get(state) ?? 0;
      observableResult.observe(count, { attester_state: state });
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
export const recordAttesterInfo = (attester: string, coinbase: string) => {
  attesterInfoMap.set(attester, { value: 1, coinbase });
};

/**
 * Clear all attester info (for refresh)
 */
export const clearAttesterInfo = () => {
  attesterInfoMap.clear();
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
