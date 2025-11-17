import { initConfig } from "../core/config/index.js";
import {
  initMetricsRegistry,
  initConfigMetrics,
  getMetricsRegistry,
} from "./metrics/index.js";
import { initWatchers } from "./watchers/index.js";
import { initHandlers } from "./handlers/index.js";
import { initState } from "./state/index.js";

/**
 * Combined server mode: Prometheus exporter + Event watcher
 *
 * This server orchestrates:
 * - HTTP server for /metrics (Prometheus exporter)
 * - Periodic scrapers to refresh metrics
 * - Event listeners for on-chain changes
 * - File watchers for local state changes
 * - Action executor with retry logic
 */
export const startServer = async () => {
  console.log(`
    ___        __                  __          __  __
   /   |____  / /____  _____      / /_  __  __/ /_/ /__  _____
  / /| /_  / / __/ _ \/ ___/_____/ __ \/ / / / __/ / _ \/ ___/
 / ___ |/ /_/ /_/  __/ /__/_____/ /_/ / /_/ / /_/ /  __/ /
/_/  |_/___/\__/\___/\___/     /_.___/\__,_/\__/_/\___/_/

`)

  // 1. Initialize configuration
  console.log("Step 1: Initializing configuration...");
  const config = await initConfig();

  // 2. Initialize metrics registry and Prometheus exporter
  console.log("\nStep 2: Initializing metrics registry...");
  const metricsPort = 9464;
  initMetricsRegistry({ port: metricsPort });
  console.log(
    `Prometheus metrics available at http://localhost:${metricsPort}/metrics`,
  );

  // 3. Initialize config metrics (configuration information)
  console.log("\nStep 3: Initializing config metrics...");
  initConfigMetrics(config);

  // 4. Initialize state management (Phase 5 - TODO)
  console.log("\nStep 4: Initializing state management...");
  await initState();

  // 5. Initialize watchers (Phase 4 - TODO)
  console.log("\nStep 5: Initializing watchers...");
  await initWatchers();

  // 6. Initialize handlers (Phase 4 - TODO)
  console.log("\nStep 6: Initializing handlers...");
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
      const { exporter } = getMetricsRegistry();
      console.log("Shutting down Prometheus exporter...");
      await exporter.shutdown();
      console.log("Prometheus exporter shut down");
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
  - Metrics: http://localhost:${metricsPort}/metrics

Press Ctrl+C to stop
`);
};
