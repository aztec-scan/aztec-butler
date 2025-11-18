export {
  initMetricsRegistry,
  getMetricsRegistry,
  getMeter,
  type MetricsOptions,
} from "./registry.js";
export { initConfigMetrics, updateConfigMetric } from "./config-metrics.js";
export { initStakingProviderMetrics } from "./staking-provider-metrics.js";
export {
  initCoinbaseMetrics,
  incrementCoinbaseChangesDetected,
  incrementCoinbaseVerificationChecks,
  incrementCoinbaseVerificationFailures,
  setAttesterQueueStatus,
} from "./coinbase-metrics.js";
