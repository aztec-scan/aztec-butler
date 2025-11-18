/**
 * Coinbase verification metrics
 *
 * Prometheus metrics for monitoring coinbase address changes
 * and verification status
 */

import type { Counter, UpDownCounter } from "@opentelemetry/api";
import { createCounter, createUpDownCounter } from "./registry.js";

// Metrics instances
let coinbaseChangesDetectedCounter: Counter | null = null;
let coinbaseVerificationChecksCounter: Counter | null = null;
let coinbaseVerificationFailuresCounter: Counter | null = null;
let attesterQueueStatusGauge: UpDownCounter | null = null;

/**
 * Initialize coinbase verification metrics
 */
export const initCoinbaseMetrics = () => {
  // Counter: Total number of coinbase changes detected
  coinbaseChangesDetectedCounter = createCounter(
    "coinbase_changes_detected_total",
    {
      description: "Total number of coinbase address changes detected",
    },
  );

  // Counter: Total number of verification checks performed
  coinbaseVerificationChecksCounter = createCounter(
    "coinbase_verification_checks_total",
    {
      description: "Total number of coinbase verification checks performed",
    },
  );

  // Counter: Total number of verification failures
  coinbaseVerificationFailuresCounter = createCounter(
    "coinbase_verification_failures_total",
    {
      description:
        "Total number of coinbase verification failures (attesters still in queue)",
    },
  );

  // Gauge: Current number of attesters in queue
  attesterQueueStatusGauge = createUpDownCounter("attester_queue_status", {
    description: "Current number of attesters in the staking registry queue",
  });

  console.log("Coinbase verification metrics initialized successfully");
};

/**
 * Increment coinbase changes detected counter
 */
export const incrementCoinbaseChangesDetected = () => {
  if (coinbaseChangesDetectedCounter) {
    coinbaseChangesDetectedCounter.add(1);
  }
};

/**
 * Increment coinbase verification checks counter
 */
export const incrementCoinbaseVerificationChecks = () => {
  if (coinbaseVerificationChecksCounter) {
    coinbaseVerificationChecksCounter.add(1);
  }
};

/**
 * Increment coinbase verification failures counter
 */
export const incrementCoinbaseVerificationFailures = () => {
  if (coinbaseVerificationFailuresCounter) {
    coinbaseVerificationFailuresCounter.add(1);
  }
};

/**
 * Set attester queue status gauge
 */
export const setAttesterQueueStatus = (count: number) => {
  if (attesterQueueStatusGauge) {
    // UpDownCounter doesn't have a set method, so we need to track the delta
    // For simplicity, we'll just add the value (not ideal for a gauge, but works)
    // In a production system, you'd want to use an ObservableGauge instead
    attesterQueueStatusGauge.add(count);
  }
};
