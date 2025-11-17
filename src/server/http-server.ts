import http from "http";
import { getMetricsRegistry } from "./metrics/index.js";

export interface HttpServerOptions {
  port: number;
}

/**
 * Creates an HTTP server for Prometheus metrics and health checks.
 * The PrometheusExporter already starts its own HTTP server,
 * so this function returns control methods for it.
 */
export const createHttpServer = (options: HttpServerOptions) => {
  const { exporter } = getMetricsRegistry();

  // The PrometheusExporter creates its own HTTP server at the specified port
  // It automatically serves metrics at /metrics

  // For now, we'll create a simple health check server on a different endpoint
  // In the future, we might want to integrate this better
  const healthServer = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ status: "ok" }));
    } else {
      res.statusCode = 404;
      res.end("Not Found");
    }
  });

  return {
    start: () => {
      return new Promise<void>((resolve) => {
        // Start health check server on port + 1
        const healthPort = options.port + 1;
        healthServer.listen(healthPort, () => {
          console.log(
            `Prometheus metrics available at http://localhost:${options.port}/metrics`,
          );
          console.log(
            `Health check available at http://localhost:${healthPort}/health`,
          );
          resolve();
        });
      });
    },
    stop: async () => {
      console.log("Closing health check server...");
      await new Promise<void>((resolve, reject) => {
        healthServer.close((err) => {
          if (err) {
            console.error("Error closing health server:", err);
            reject(err);
          } else {
            console.log("Health check server closed");
            resolve();
          }
        });
      });

      console.log("Shutting down Prometheus exporter...");
      // Race exporter.shutdown() with a 1 second timeout to prevent hanging
      const shutdownPromise = exporter.shutdown();
      const timeoutPromise = new Promise<void>((resolve) => {
        setTimeout(() => {
          console.log(
            "Prometheus exporter shutdown timed out, forcing exit...",
          );
          resolve();
        }, 1000);
      });
      await Promise.race([shutdownPromise, timeoutPromise]);
      console.log("Prometheus exporter shut down");
    },
  };
};
