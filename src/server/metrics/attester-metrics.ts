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
} from "../state/index.js";
import { createObservableGauge } from "./registry.js";
import { AttesterOnChainStatus } from "../../types/index.js";

// Metrics instances
let attesterInfoGauge: ObservableGauge | null = null;
let attesterCoinbaseNeededGauge: ObservableGauge | null = null;
let nbrofAttestersInStateGauge: ObservableGauge | null = null;
let attesterOnChainStatusGauge: ObservableGauge | null = null;
let attestersMissingCoinbaseGauge: ObservableGauge | null = null;
let attestersMissingCoinbaseUrgentGauge: ObservableGauge | null = null;
// TODO: add gauge for proposer ETH balance

/**
 * Initialize attester metrics that expose attester state and metadata
 */
export const initAttesterMetrics = () => {
  attesterInfoGauge = createObservableGauge("attester_info", {
    description:
      "Attester address, coinbase address and (TODO) publisher address (value=1)",
  });

  attesterCoinbaseNeededGauge = createObservableGauge(
    "attesters_coinbase_needed",
    {
      description: "Attesters in COINBASE_NEEDED state (value=1 per attester)",
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

  attesterCoinbaseNeededGauge.addCallback((observableResult) => {
    const attestersNeedingCoinbase = getAttestersByState(
      AttesterState.COINBASE_NEEDED,
    );

    for (const entry of attestersNeedingCoinbase) {
      observableResult.observe(1, {
        attester_address: entry.attesterAddress,
      });
    }
  });

  nbrofAttestersInStateGauge.addCallback((observableResult) => {
    const stateCounts = countAttestersByState();

    for (const [state, count] of stateCounts.entries()) {
      observableResult.observe(count, { attester_state: state });
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
    const allAttesterStates = getAttesterStates();

    for (const [address, entry] of allAttesterStates.entries()) {
      if (entry.onChainView) {
        // Export the on-chain status as a metric
        observableResult.observe(entry.onChainView.status, {
          attester_address: address,
          status: AttesterOnChainStatus[entry.onChainView.status],
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
    const coinbaseInfo = getAttesterCoinbaseInfo();

    for (const [attester, coinbase] of coinbaseInfo.entries()) {
      if (!coinbase) {
        observableResult.observe(1, {
          attester_address: attester,
        });
      }
    }
  });

  // New metric: attesters missing coinbase in COINBASE_NEEDED state (urgent)
  attestersMissingCoinbaseUrgentGauge = createObservableGauge(
    "attesters_missing_coinbase_urgent",
    {
      description:
        "Attesters in COINBASE_NEEDED state (urgent attention required, value=1 per attester)",
    },
  );

  attestersMissingCoinbaseUrgentGauge.addCallback((observableResult) => {
    const attestersNeedingCoinbase = getAttestersByState(
      AttesterState.COINBASE_NEEDED,
    );

    for (const entry of attestersNeedingCoinbase) {
      observableResult.observe(1, {
        attester_address: entry.attesterAddress,
      });
    }
  });

  console.log("Attester metrics initialized successfully");
};
