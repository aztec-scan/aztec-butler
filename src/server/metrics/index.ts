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
  setAttesterMissingCoinbase,
  clearMissingCoinbaseStatuses,
  recordAttesterInfo,
  recordCoinbaseInfo,
  updateAttesterStateCount,
  clearAttesterStateCounts,
} from "./coinbase-metrics.js";
