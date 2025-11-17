import type { ObservableGauge } from "@opentelemetry/api";
import { getMeter } from "./registry.js";
import type { ButlerConfig } from "../../core/config/index.js";

let l1InfoGauge: ObservableGauge | null = null;
let currentConfig: ButlerConfig | null = null;

export const initNodeMetrics = (config: ButlerConfig) => {
  currentConfig = config;
  const meter = getMeter();

  // Hardcoded metric: L1 configuration information
  l1InfoGauge = meter.createObservableGauge("aztec_butler_l1_info", {
    description: "Aztec Butler L1 configuration information",
  });

  l1InfoGauge.addCallback((observableResult) => {
    if (currentConfig) {
      observableResult.observe(1, {
        provider_admin_address:
          currentConfig.PROVIDER_ADMIN_ADDRESS || "not_configured",
      });
    }
  });
};

export const updateL1InfoMetric = (config: ButlerConfig) => {
  // With OpenTelemetry's observable gauges, we just update the reference
  // and the callback will use the latest value
  currentConfig = config;
};
