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
  attesterInfoGauge = createObservableGauge("attester_info", {
    description:
      "Attester address, coinbase address and (TODO) publisher address (value=1)",
  });

  attesterMissingCoinbaseGauge = createObservableGauge(
    "attesters_missing_coinbase_address",
    {
      description:
        "Attesters missing coinbase address (0=has coinbase, 1=missing coinbase)",
    },
  );

  nbrofAttestersInStateGauge = createObservableGauge(
    "nbrof_attesters_in_state",
    {
      description: "Number of attesters in each state",
    },
  );

  attesterInfoGauge.addCallback((observableResult) => {
    const coinbaseInfo = getAttesterCoinbaseInfo();

    let exportedCount = 0;
    for (const [attester, coinbase] of coinbaseInfo.entries()) {
      if (coinbase) {
        observableResult.observe(1, {
          attester_address: attester,
          coinbase_address: coinbase,
        });
        exportedCount++;
      }
    }
  });

  attesterMissingCoinbaseGauge.addCallback((observableResult) => {
    const coinbaseInfo = getAttesterCoinbaseInfo();

    let missingCount = 0;
    for (const [attester, coinbase] of coinbaseInfo.entries()) {
      const isMissing = !coinbase;
      observableResult.observe(isMissing ? 1 : 0, {
        attester_address: attester,
      });
      if (isMissing) missingCount++;
    }
  });

  nbrofAttestersInStateGauge.addCallback((observableResult) => {
    const stateCounts = countAttestersByState();

    for (const [state, count] of stateCounts.entries()) {
      observableResult.observe(count, { attester_state: state });
    }
  });

  console.log("Attester metrics initialized successfully");
};
