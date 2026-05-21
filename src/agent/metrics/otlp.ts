/**
 * OTLP metrics export for agent mode.
 *
 * Agent mode does NOT run a Prometheus `/metrics` server. Instead it pushes
 * metrics to a local OpenTelemetry collector over OTLP.
 *
 * Transport: HTTP/protobuf (the default). `BUTLER_AGENT_OTLP_PROTOCOL=grpc`
 * is reserved but not bundled — see config.ts.
 *
 * The OTel resource carries ONLY `service.name`. Network and host are applied
 * as per-metric attributes so that global (chain-wide) metrics can omit
 * `host` while local metrics include it — see agent-metrics.ts.
 */

import type { Meter } from "@opentelemetry/api";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  AggregationTemporality,
  ConsoleMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
  type PushMetricExporter,
} from "@opentelemetry/sdk-metrics";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { PACKAGE_NAME } from "../../core/config/index.js";
import type { AgentConfig } from "../config.js";

export interface AgentMeterProvider {
  meter: Meter;
  /** Force an immediate export (used by `--once`). */
  forceFlush: () => Promise<void>;
  shutdown: () => Promise<void>;
}

export interface InitMeterProviderOptions {
  /** Export to stdout via ConsoleMetricExporter instead of OTLP. */
  dryRun?: boolean;
  /** Override the periodic export interval (ms). */
  exportIntervalMs?: number;
}

/**
 * Build the agent's MeterProvider. Returns a single {@link Meter} plus
 * flush/shutdown handles.
 */
export const initAgentMeterProvider = (
  config: AgentConfig,
  options: InitMeterProviderOptions = {},
): AgentMeterProvider => {
  const exportIntervalMillis = options.exportIntervalMs ?? config.otlp.exportIntervalMs;

  let exporter: PushMetricExporter;
  if (options.dryRun || !config.otlp.enabled) {
    if (!options.dryRun) {
      console.warn(
        "[agent] OTLP export is disabled (BUTLER_AGENT_OTLP_ENABLED=false) — " +
          "metrics will be printed to stdout instead.",
      );
    }
    exporter = new ConsoleMetricExporter();
  } else {
    // Cumulative temporality is the right default for a Prometheus-backed
    // pipeline behind the collector.
    exporter = new OTLPMetricExporter({
      url: config.otlp.endpoint,
      temporalityPreference: AggregationTemporality.CUMULATIVE,
    });
    console.log(
      `[agent] OTLP metrics exporter -> ${config.otlp.endpoint} ` +
        `(${config.otlp.protocol}, every ${exportIntervalMillis / 1000}s)`,
    );
  }

  const reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis });

  const meterProvider = new MeterProvider({
    readers: [reader],
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: PACKAGE_NAME }),
  });

  return {
    meter: meterProvider.getMeter(PACKAGE_NAME),
    forceFlush: () => meterProvider.forceFlush(),
    shutdown: () => meterProvider.shutdown(),
  };
};
