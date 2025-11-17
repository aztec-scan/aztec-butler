import { initConfig } from "../core/config/index.js";
import { initMetricsRegistry } from "./metrics/index.js";
import { initNodeMetrics } from "./metrics/index.js";
import { createHttpServer } from "./http-server.js";
import { initWatchers } from "./watchers/index.js";
import { initHandlers } from "./handlers/index.js";
import { initState } from "./state/index.js";

/**
 * Combined server mode: Prometheus exporter + Event watcher
 *
 * This server orchestrates:
 * - HTTP server for /metrics (Prometheus) and /health endpoints
 * - Periodic scrapers to refresh metrics
 * - Event listeners for on-chain changes
 * - File watchers for local state changes
 * - Action executor with retry logic
 */
export const startServer = async () => {
  console.log("\n=== Starting Aztec Butler Server ===\n");

  // 1. Initialize configuration
  console.log("Step 1: Initializing configuration...");
  const config = await initConfig();

  // 2. Initialize metrics registry and Prometheus exporter
  console.log("\nStep 2: Initializing metrics registry...");
  const metricsPort = 9464;
  initMetricsRegistry({ port: metricsPort });

  // 3. Initialize node metrics (hardcoded L1 info metric)
  console.log("Step 3: Initializing node metrics...");
  initNodeMetrics(config);

  // 4. Start HTTP server for metrics and health checks
  console.log("\nStep 4: Starting HTTP server...");
  const httpServer = createHttpServer({ port: metricsPort });
  await httpServer.start();

  // 5. Initialize state management (Phase 5 - TODO)
  console.log("\nStep 5: Initializing state management...");
  await initState();

  // 6. Initialize watchers (Phase 4 - TODO)
  console.log("\nStep 6: Initializing watchers...");
  await initWatchers();

  // 7. Initialize handlers (Phase 4 - TODO)
  console.log("\nStep 7: Initializing handlers...");
  await initHandlers();

  // Setup graceful shutdown
  let isShuttingDown = false;
  const shutdown = async () => {
    if (isShuttingDown) {
      console.log("Already shutting down, please wait...");
      return;
    }
    isShuttingDown = true;

    console.log("\n\n=== Shutting down gracefully ===");
    try {
      await httpServer.stop();
      console.log("Server stopped");
    } catch (err) {
      console.error("Error during shutdown:", err);
    }
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });

  console.log("\n=== Server is running ===");
  console.log(`
Endpoints:
  - Metrics:      http://localhost:${metricsPort}/metrics
  - Health check: http://localhost:${metricsPort + 1}/health

Press Ctrl+C to stop
`);
};
