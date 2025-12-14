/**
 * Attester Metrics
 *
 * Prometheus metrics for tracking attesters state, and required metadata
 */

import type { ObservableGauge } from "@opentelemetry/api";
import {
  countAttestersByState,
  getAttesterCoinbaseInfo,
  getAttestersByState,
  getAttesterStates,
  AttesterState,
  getAllNetworkStates,
} from "../state/index.js";
import { createObservableGauge } from "./registry.js";
import { AttesterOnChainStatus } from "../../types/index.js";

// Metrics instances
let attesterInfoGauge: ObservableGauge | null = null;
let nbrofAttestersInStateGauge: ObservableGauge | null = null;
let attesterOnChainStatusGauge: ObservableGauge | null = null;
let attestersMissingCoinbaseGauge: ObservableGauge | null = null;
// TODO: add gauge for proposer ETH balance

/**
 * Initialize attester metrics that expose attester state and metadata
 */
export const initAttesterMetrics = () => {
  attesterInfoGauge = createObservableGauge("attester_info", {
    description:
      "Attester address, coinbase address and (TODO) publisher address (value=1)",
  });

  nbrofAttestersInStateGauge = createObservableGauge(
    "nbrof_attesters_in_state",
    {
      description: "Number of attesters in each state",
    },
  );

  attesterInfoGauge.addCallback((observableResult) => {
    const networkStates = getAllNetworkStates();

    for (const [network, _state] of networkStates.entries()) {
      const coinbaseInfo = getAttesterCoinbaseInfo(network);

      for (const [attester, coinbase] of coinbaseInfo.entries()) {
        if (coinbase) {
          observableResult.observe(1, {
            network,
            attester_address: attester,
            coinbase_address: coinbase,
          });
        }
      }
    }
  });

  nbrofAttestersInStateGauge.addCallback((observableResult) => {
    const networkStates = getAllNetworkStates();

    for (const [network, _state] of networkStates.entries()) {
      const stateCounts = countAttestersByState(network);

      for (const [state, count] of stateCounts.entries()) {
        observableResult.observe(count, { network, attester_state: state });
      }
    }
  });

  attesterOnChainStatusGauge = createObservableGauge(
    "attester_on_chain_status",
    {
      description:
        "On-chain status of attesters: NONE=0, VALIDATING=1, ZOMBIE=2, EXITING=3",
    },
  );

  attesterOnChainStatusGauge.addCallback((observableResult) => {
    const networkStates = getAllNetworkStates();

    for (const [network, _state] of networkStates.entries()) {
      const allAttesterStates = getAttesterStates(network);

      for (const [address, entry] of allAttesterStates.entries()) {
        if (entry.onChainView) {
          // Export the on-chain status as a metric
          observableResult.observe(entry.onChainView.status, {
            network,
            attester_address: address,
            status: AttesterOnChainStatus[entry.onChainView.status],
          });
        }
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
