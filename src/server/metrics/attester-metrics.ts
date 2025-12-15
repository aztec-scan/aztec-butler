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
let attesterStatesLastUpdatedGauge: ObservableGauge | null = null;
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
    const now = new Date().toISOString();
    console.log(`[Metrics/Callback] nbrofAttestersInStateGauge invoked at ${now}`);
    
    const networkStates = getAllNetworkStates();
    console.log(`[Metrics/Callback] Found ${networkStates.size} network(s)`);

    for (const [network, _state] of networkStates.entries()) {
      const stateCounts = countAttestersByState(network);
      console.log(`[Metrics/Callback/${network}] State counts:`, Object.fromEntries(stateCounts));

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
    const now = new Date().toISOString();
    console.log(`[Metrics/Callback] attesterOnChainStatusCountGauge invoked at ${now}`);
    
    const networkStates = getAllNetworkStates();

    for (const [network, _state] of networkStates.entries()) {
      const statusCounts = countAttestersByOnChainStatus(network);
      console.log(`[Metrics/Callback/${network}] On-chain status counts:`, Object.fromEntries(statusCounts));

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
    const now = new Date().toISOString();
    console.log(`[Metrics/Callback] attestersMissingCoinbaseGauge invoked at ${now}`);
    
    const networkStates = getAllNetworkStates();

    for (const [network, _state] of networkStates.entries()) {
      const coinbaseInfo = getAttesterCoinbaseInfo(network);
      let missingCount = 0;

      for (const [attester, coinbase] of coinbaseInfo.entries()) {
        if (!coinbase) {
          missingCount++;
          observableResult.observe(1, {
            network,
            attester_address: attester,
          });
        }
      }
      
      console.log(`[Metrics/Callback/${network}] Attesters missing coinbase: ${missingCount}`);
    }
  });

  // Metric to track when attester states were last updated
  attesterStatesLastUpdatedGauge = createObservableGauge(
    "attester_states_last_updated_timestamp",
    {
      description:
        "Unix timestamp when attester states were last updated (for staleness detection)",
      unit: "seconds",
    },
  );

  attesterStatesLastUpdatedGauge.addCallback((observableResult) => {
    const networkStates = getAllNetworkStates();

    for (const [network, _state] of networkStates.entries()) {
      const attesterStates = getAttesterStates(network);
      
      // Find the most recent update across all attesters
      let latestUpdate = 0;
      for (const entry of attesterStates.values()) {
        const timestamp = Math.floor(entry.lastUpdated.getTime() / 1000);
        if (timestamp > latestUpdate) {
          latestUpdate = timestamp;
        }
      }

      if (latestUpdate > 0) {
        observableResult.observe(latestUpdate, { network });
      }
    }
  });

  console.log("Attester metrics initialized successfully");
};
