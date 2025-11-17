import { PrometheusExporter } from "@opentelemetry/exporter-prometheus";
import { MeterProvider } from "@opentelemetry/sdk-metrics";
import { PACKAGE_NAME } from "../../core/config/index.js";

// Central Prometheus exporter and meter provider
let exporter: PrometheusExporter | null = null;
let meterProvider: MeterProvider | null = null;

export interface MetricsOptions {
  port: number;
}

export const initMetricsRegistry = (options: MetricsOptions) => {
  if (exporter && meterProvider) {
    return { exporter, meterProvider };
  }

  exporter = new PrometheusExporter(options);
  meterProvider = new MeterProvider({
    readers: [exporter],
  });

  return { exporter, meterProvider };
};

export const getMetricsRegistry = () => {
  if (!exporter || !meterProvider) {
    throw new Error(
      "Metrics registry not initialized. Call initMetricsRegistry() first.",
    );
  }
  return { exporter, meterProvider };
};

export const getMeter = () => {
  const { meterProvider } = getMetricsRegistry();
  return meterProvider.getMeter(PACKAGE_NAME);
};
