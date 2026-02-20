/**
 * Entry Queue Metrics
 *
 * Prometheus metrics for entry queue statistics and timing estimates
 */

import type { Attributes, ObservableGauge, ObservableResult } from "@opentelemetry/api";
import { getAllNetworkStates, getEntryQueueStats } from "../state/index.js";
import { createObservableGauge } from "./registry.js";

// Metrics instances
let entryQueueLengthGauge: ObservableGauge | null = null;
let entryQueueTimePerAttesterGauge: ObservableGauge | null = null;
let entryQueueLastAttesterTimestampGauge: ObservableGauge | null = null;
let entryQueueProviderCountGauge: ObservableGauge | null = null;
let entryQueueProviderNextArrivalTimestampGauge: ObservableGauge | null = null;
let entryQueueProviderNextMissingCoinbaseTimestampGauge: ObservableGauge | null =
  null;
let entryQueueProviderLastArrivalTimestampGauge: ObservableGauge | null = null;
let entryQueueLastScrapedTimestampGauge: ObservableGauge | null = null;

/**
 * Initialize entry queue metrics that expose queue statistics and timing estimates
 */
export const initEntryQueueMetrics = () => {
  // Total attesters in entry queue
  entryQueueLengthGauge = createObservableGauge("entry_queue_length", {
    description: "Total attesters waiting in entry queue",
  });

  entryQueueLengthGauge.addCallback(
    (observableResult: ObservableResult<Attributes>) => {
    const now = new Date().toISOString();
    console.log(`[Metrics/Callback] entryQueueLengthGauge invoked at ${now}`);
    
    const networkStates = getAllNetworkStates();

    for (const [network, _state] of networkStates.entries()) {
      const stats = getEntryQueueStats(network);
      if (stats) {
        const queueLength = Number(stats.totalQueueLength);
        console.log(`[Metrics/Callback/${network}] Entry queue length: ${queueLength}, last updated: ${stats.lastUpdated}`);
        observableResult.observe(queueLength, {
          network,
        });
      } else {
        console.log(`[Metrics/Callback/${network}] No entry queue stats available`);
      }
    }
  });

  // Average seconds per attester to move from queue to active
  entryQueueTimePerAttesterGauge = createObservableGauge(
    "entry_queue_time_per_attester_seconds",
    {
      description:
        "Average seconds per attester to move from queue to active (0 when queue is empty)",
      unit: "seconds",
    },
  );

  entryQueueTimePerAttesterGauge.addCallback(
    (observableResult: ObservableResult<Attributes>) => {
    const networkStates = getAllNetworkStates();

    for (const [network, _state] of networkStates.entries()) {
      const stats = getEntryQueueStats(network);
      if (stats) {
        observableResult.observe(stats.timePerAttester, {
          network,
        });
      }
    }
  });

  // Unix timestamp when last attester in global queue will become active
  // NOT REPORTED when queue is empty
  entryQueueLastAttesterTimestampGauge = createObservableGauge(
    "entry_queue_last_attester_timestamp",
    {
      description:
        "Unix timestamp when last attester in global queue will become active",
      unit: "seconds",
    },
  );

  entryQueueLastAttesterTimestampGauge.addCallback(
    (observableResult: ObservableResult<Attributes>) => {
    const networkStates = getAllNetworkStates();

    for (const [network, _state] of networkStates.entries()) {
      const stats = getEntryQueueStats(network);
      if (stats && stats.totalQueueLength > 0n) {
        observableResult.observe(stats.lastAttesterEstimatedEntryTimestamp, {
          network,
        });
      }
    }
  });

  // Number of attesters from our provider in entry queue
  entryQueueProviderCountGauge = createObservableGauge(
    "entry_queue_provider_count",
    {
      description: "Number of attesters from our provider in entry queue",
    },
  );

  entryQueueProviderCountGauge.addCallback(
    (observableResult: ObservableResult<Attributes>) => {
    const now = new Date().toISOString();
    console.log(`[Metrics/Callback] entryQueueProviderCountGauge invoked at ${now}`);
    
    const networkStates = getAllNetworkStates();

    for (const [network, _state] of networkStates.entries()) {
      const stats = getEntryQueueStats(network);
      if (stats && stats.providerId !== null) {
        console.log(`[Metrics/Callback/${network}] Provider queue count: ${stats.providerQueueCount} (provider ID: ${stats.providerId})`);
        observableResult.observe(stats.providerQueueCount, {
          network,
          staking_provider_id: stats.providerId.toString(),
        });
      } else {
        console.log(`[Metrics/Callback/${network}] No provider queue stats available`);
      }
    }
  });

  // Unix timestamp when next attester from our provider becomes active
  // NOT REPORTED when no provider attesters in queue
  entryQueueProviderNextArrivalTimestampGauge = createObservableGauge(
    "entry_queue_provider_next_arrival_timestamp",
    {
      description:
        "Unix timestamp when next attester from our provider becomes active",
      unit: "seconds",
    },
  );

  entryQueueProviderNextArrivalTimestampGauge.addCallback(
    (observableResult: ObservableResult<Attributes>) => {
      const networkStates = getAllNetworkStates();

      for (const [network, _state] of networkStates.entries()) {
        const stats = getEntryQueueStats(network);
        if (
          stats &&
          stats.providerId !== null &&
          stats.providerNextAttesterArrivalTimestamp !== null
        ) {
          observableResult.observe(stats.providerNextAttesterArrivalTimestamp, {
            network,
            staking_provider_id: stats.providerId.toString(),
          });
        }
      }
    },
  );

  // Unix timestamp when NEXT attester WITHOUT coinbase becomes active
  // Only exposes the single next attester missing coinbase
  // NOT REPORTED when no attesters missing coinbase
  entryQueueProviderNextMissingCoinbaseTimestampGauge = createObservableGauge(
    "entry_queue_provider_next_missing_coinbase_timestamp",
    {
      description:
        "Unix timestamp when NEXT attester WITHOUT coinbase becomes active (most critical metric for operations)",
      unit: "seconds",
    },
  );

  entryQueueProviderNextMissingCoinbaseTimestampGauge.addCallback(
    (observableResult: ObservableResult<Attributes>) => {
      const networkStates = getAllNetworkStates();

      for (const [network, _state] of networkStates.entries()) {
        const stats = getEntryQueueStats(network);
        if (
          stats &&
          stats.providerId !== null &&
          stats.providerNextMissingCoinbaseArrivalTimestamp !== null &&
          stats.providerNextMissingCoinbaseAddress !== null
        ) {
          observableResult.observe(
            stats.providerNextMissingCoinbaseArrivalTimestamp,
            {
              network,
              staking_provider_id: stats.providerId.toString(),
              attester_address: stats.providerNextMissingCoinbaseAddress,
            },
          );
        }
      }
    },
  );

  // Unix timestamp when last attester from our provider becomes active
  // NOT REPORTED when no provider attesters in queue
  entryQueueProviderLastArrivalTimestampGauge = createObservableGauge(
    "entry_queue_provider_last_arrival_timestamp",
    {
      description:
        "Unix timestamp when last attester from our provider becomes active",
      unit: "seconds",
    },
  );

  entryQueueProviderLastArrivalTimestampGauge.addCallback(
    (observableResult: ObservableResult<Attributes>) => {
      const networkStates = getAllNetworkStates();

      for (const [network, _state] of networkStates.entries()) {
        const stats = getEntryQueueStats(network);
        if (
          stats &&
          stats.providerId !== null &&
          stats.providerLastAttesterArrivalTimestamp !== null
        ) {
          observableResult.observe(stats.providerLastAttesterArrivalTimestamp, {
            network,
            staking_provider_id: stats.providerId.toString(),
          });
        }
      }
    },
  );

  // Metric to track when entry queue was last scraped (staleness detection)
  entryQueueLastScrapedTimestampGauge = createObservableGauge(
    "entry_queue_last_scraped_timestamp",
    {
      description:
        "Unix timestamp when entry queue was last scraped (for staleness detection)",
      unit: "seconds",
    },
  );

  entryQueueLastScrapedTimestampGauge.addCallback((observableResult) => {
    const networkStates = getAllNetworkStates();

    for (const [network, _state] of networkStates.entries()) {
      const stats = getEntryQueueStats(network);
      if (stats) {
        const timestamp = Math.floor(stats.lastUpdated.getTime() / 1000);
        observableResult.observe(timestamp, { network });
      }
    }
  });

  console.log("Entry queue metrics initialized successfully");
};
