/**
 * Attester Metrics
 *
 * Prometheus metrics for tracking attesters state, and required metadata
 */

import type { ObservableGauge } from "@opentelemetry/api";
import {
  countAttestersByState,
  getAttesterCoinbaseInfo,
} from "../state/index.js";
import { createObservableGauge } from "./registry.js";

// Metrics instances
let attesterInfoGauge: ObservableGauge | null = null;
let attesterMissingCoinbaseGauge: ObservableGauge | null = null;
let nbrofAttestersInStateGauge: ObservableGauge | null = null;
// TODO: add gauge for proposer ETH balance

/**
 * Initialize attester metrics that expose attester state and metadata
 */
export const initAttesterMetrics = () => {
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
    // Derive attester info directly from state module (single source of truth)
    const coinbaseInfo = getAttesterCoinbaseInfo();

    for (const [attester, coinbase] of coinbaseInfo.entries()) {
      if (coinbase) {
        observableResult.observe(1, {
          attester_address: attester,
          coinbase_address: coinbase,
        });
      }
    }
  });

  attesterMissingCoinbaseGauge.addCallback((observableResult) => {
    // Derive missing coinbase status directly from state module
    const coinbaseInfo = getAttesterCoinbaseInfo();

    for (const [attester, coinbase] of coinbaseInfo.entries()) {
      const isMissing = !coinbase;
      observableResult.observe(isMissing ? 1 : 0, {
        attester_address: attester,
      });
    }
  });

  nbrofAttestersInStateGauge.addCallback((observableResult) => {
    // Derive state counts directly from the state module (single source of truth)
    const stateCounts = countAttestersByState();

    for (const [state, count] of stateCounts.entries()) {
      observableResult.observe(count, { attester_state: state });
    }
  });

  console.log("Attester metrics initialized successfully");
};
