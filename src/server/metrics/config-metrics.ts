import type { Attributes, ObservableGauge, ObservableResult } from "@opentelemetry/api";
import { createObservableGauge } from "./registry.js";
import type { ButlerConfig } from "../../core/config/index.js";
import { getScraperConfig } from "../state/index.js";

let configInfoGauge: ObservableGauge | null = null;
const networkConfigs = new Map<string, ButlerConfig>();

export const initConfigMetrics = (network: string, config: ButlerConfig) => {
  networkConfigs.set(network, config);

  // Create the gauge on first initialization only
  if (!configInfoGauge) {
    configInfoGauge = createObservableGauge("config_info", {
      description: "Aztec Butler configuration information",
    });

    configInfoGauge.addCallback(
      (observableResult: ObservableResult<Attributes>) => {
      for (const [net, cfg] of networkConfigs.entries()) {
        const scraperConfig = getScraperConfig(net);

        observableResult.observe(1, {
          network: net,
          provider_admin_address:
            cfg.AZTEC_STAKING_PROVIDER_ADMIN_ADDRESS || "not_configured",
          staking_provider_id:
            scraperConfig?.stakingProviderId.toString() || "unknown",
          ethereum_node_url: cfg.ETHEREUM_NODE_URL,
          aztec_node_url: cfg.AZTEC_NODE_URL,
          // Add more config attributes here as needed
        });
      }
    });
  }
};

export const updateConfigMetric = (network: string, config: ButlerConfig) => {
  // With OpenTelemetry's observable gauges, we just update the reference
  // and the callback will use the latest value
  networkConfigs.set(network, config);
};
