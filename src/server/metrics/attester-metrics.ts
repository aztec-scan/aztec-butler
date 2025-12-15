/**
 * Attester Metrics
 *
 * Prometheus metrics for tracking attesters state, and required metadata
 */

import type { ObservableGauge } from "@opentelemetry/api";
import {
  countAttestersByState,
  countAttestersByOnChainStatus,
  getAttesterCoinbaseInfo,
  getAttestersByState,
  getAttesterStates,
  AttesterState,
  getAllNetworkStates,
} from "../state/index.js";
import { createObservableGauge } from "./registry.js";
import { AttesterOnChainStatus } from "../../types/index.js";

// Metrics instances
let nbrofAttestersInStateGauge: ObservableGauge | null = null;
let attesterOnChainStatusCountGauge: ObservableGauge | null = null;
let attestersMissingCoinbaseGauge: ObservableGauge | null = null;
// TODO: add gauge for proposer ETH balance

/**
 * Initialize attester metrics that expose attester state and metadata
 */
export const initAttesterMetrics = () => {
  nbrofAttestersInStateGauge = createObservableGauge(
    "nbrof_attesters_in_state",
    {
      description: "Number of attesters in each state",
    },
  );

  nbrofAttestersInStateGauge.addCallback((observableResult) => {
    const networkStates = getAllNetworkStates();

    for (const [network, _state] of networkStates.entries()) {
      const stateCounts = countAttestersByState(network);

      for (const [state, count] of stateCounts.entries()) {
        observableResult.observe(count, { network, attester_state: state });
      }
    }
  });

  attesterOnChainStatusCountGauge = createObservableGauge(
    "attester_on_chain_status_count",
    {
      description: "Count of attesters in each on-chain status",
    },
  );

  attesterOnChainStatusCountGauge.addCallback((observableResult) => {
    const networkStates = getAllNetworkStates();

    for (const [network, _state] of networkStates.entries()) {
      const statusCounts = countAttestersByOnChainStatus(network);

      for (const [status, count] of statusCounts.entries()) {
        observableResult.observe(count, {
          network,
          status: AttesterOnChainStatus[status],
        });
      }
    }
  });

  // New metric: attesters missing coinbase (all attesters without coinbase configured)
  attestersMissingCoinbaseGauge = createObservableGauge(
    "attesters_missing_coinbase",
    {
      description:
        "Attesters without a coinbase address configured (value=1 per attester)",
    },
  );

  attestersMissingCoinbaseGauge.addCallback((observableResult) => {
    const networkStates = getAllNetworkStates();

    for (const [network, _state] of networkStates.entries()) {
      const coinbaseInfo = getAttesterCoinbaseInfo(network);

      for (const [attester, coinbase] of coinbaseInfo.entries()) {
        if (!coinbase) {
          observableResult.observe(1, {
            network,
            attester_address: attester,
          });
        }
      }
    }
  });

  console.log("Attester metrics initialized successfully");
};
