import { PrometheusExporter } from "@opentelemetry/exporter-prometheus";
import { MeterProvider } from "@opentelemetry/sdk-metrics";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { PACKAGE_NAME } from "../../core/config/index.js";
import http from "node:http";

// Central Prometheus exporter and meter provider
let exporter: PrometheusExporter | null = null;
let meterProvider: MeterProvider | null = null;
let authServer: http.Server | null = null;

export interface MetricsOptions {
  port: number;
  bearerToken?: string;
}

export const initMetricsRegistry = (options: MetricsOptions) => {
  if (exporter && meterProvider) {
    return { exporter, meterProvider };
  }

  if (options.bearerToken) {
    // Create exporter without starting server (we'll create our own with auth)
    exporter = new PrometheusExporter({
      preventServerStart: true,
    });

    meterProvider = new MeterProvider({
      readers: [exporter],
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: PACKAGE_NAME,
      }),
    });

    // Create HTTP server with Bearer token authentication
    authServer = http.createServer((req, res) => {
      // Check for Bearer token
      const authHeader = req.headers.authorization;

      console.log(`Incoming request to ${req.url} with auth: ${authHeader}`);

      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        res.writeHead(401, {
          "Content-Type": "text/plain",
          "WWW-Authenticate": 'Bearer realm="Metrics"',
        });
        res.end("Unauthorized: Missing or invalid Bearer token");
        return;
      }

      const token = authHeader.substring(7); // Remove "Bearer " prefix

      if (token !== options.bearerToken) {
        res.writeHead(401, {
          "Content-Type": "text/plain",
          "WWW-Authenticate": 'Bearer realm="Metrics"',
        });
        res.end("Unauthorized: Invalid Bearer token");
        return;
      }

      // Token is valid, serve metrics
      if (req.url === "/metrics") {
        exporter!.getMetricsRequestHandler(req, res);
      } else {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found");
      }
    });

    authServer.listen(options.port);
  } else {
    // No authentication - use default PrometheusExporter server
    exporter = new PrometheusExporter({ port: options.port });
    meterProvider = new MeterProvider({
      readers: [exporter],
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: PACKAGE_NAME,
      }),
    });
  }

  return { exporter, meterProvider };
};

export const getMetricsRegistry = () => {
  if (!exporter || !meterProvider) {
    throw new Error(
      "Metrics registry not initialized. Call initMetricsRegistry() first.",
    );
  }
  return { exporter, meterProvider, authServer };
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
