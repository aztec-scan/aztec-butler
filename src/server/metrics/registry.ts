import { PrometheusExporter } from "@opentelemetry/exporter-prometheus";
import { MeterProvider } from "@opentelemetry/sdk-metrics";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
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
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: PACKAGE_NAME,
    }),
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

// Factory functions for creating metrics with automatic name prepending
export interface MetricOptions {
  description?: string;
  unit?: string;
}

export const createCounter = (name: string, options?: MetricOptions) => {
  const meter = getMeter();
  return meter.createCounter(`${PACKAGE_NAME}_${name}`, options);
};

export const createHistogram = (name: string, options?: MetricOptions) => {
  const meter = getMeter();
  return meter.createHistogram(`${PACKAGE_NAME}_${name}`, options);
};

export const createObservableGauge = (
  name: string,
  options?: MetricOptions,
) => {
  const meter = getMeter();
  return meter.createObservableGauge(`${PACKAGE_NAME}_${name}`, options);
};

export const createUpDownCounter = (name: string, options?: MetricOptions) => {
  const meter = getMeter();
  return meter.createUpDownCounter(`${PACKAGE_NAME}_${name}`, options);
};

export const createObservableCounter = (
  name: string,
  options?: MetricOptions,
) => {
  const meter = getMeter();
  return meter.createObservableCounter(`${PACKAGE_NAME}_${name}`, options);
};

export const createObservableUpDownCounter = (
  name: string,
  options?: MetricOptions,
) => {
  const meter = getMeter();
  return meter.createObservableUpDownCounter(
    `${PACKAGE_NAME}_${name}`,
    options,
  );
};
