import type { ObservableGauge } from "@opentelemetry/api";
import { createObservableGauge } from "./registry.js";
import type { ButlerConfig } from "../../core/config/index.js";

let configInfoGauge: ObservableGauge | null = null;
let currentConfig: ButlerConfig | null = null;

export const initConfigMetrics = (config: ButlerConfig) => {
  currentConfig = config;

  // Config metric: All configuration information as attributes
  configInfoGauge = createObservableGauge("config_info", {
    description: "Aztec Butler configuration information",
  });

  configInfoGauge.addCallback((observableResult) => {
    if (currentConfig) {
      observableResult.observe(1, {
        provider_admin_address:
          currentConfig.AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS ||
          "not_configured",
        ethereum_node_url: currentConfig.ETHEREUM_NODE_URL,
        aztec_node_url: currentConfig.AZTEC_NODE_URL,
        // Add more config attributes here as needed
      });
    }
  });
};

export const updateConfigMetric = (config: ButlerConfig) => {
  // With OpenTelemetry's observable gauges, we just update the reference
  // and the callback will use the latest value
  currentConfig = config;
};
