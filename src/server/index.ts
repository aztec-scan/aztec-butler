import { initConfig } from "../core/config/index.js";
import {
  initMetricsRegistry,
  initConfigMetrics,
  initProviderMetrics,
  initCoinbaseMetrics,
  getMetricsRegistry,
} from "./metrics/index.js";
import { ScraperManager, ProviderScraper } from "./scrapers/index.js";
import { initWatchers, shutdownWatchers } from "./watchers/index.js";
import { initHandlers, shutdownHandlers } from "./handlers/index.js";
import { initState } from "./state/index.js";
import { AztecClient } from "../core/components/AztecClient.js";
import { EthereumClient } from "../core/components/EthereumClient.js";

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

`);

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

  // 4. Initialize scrapers
  console.log("\nStep 4: Initializing scrapers...");
  const scraperManager = new ScraperManager();

  // Register provider scraper (30 second interval)
  const providerScraper = new ProviderScraper(config);
  scraperManager.register(providerScraper, 30_000);

  // TODO: Add more scrapers here with their own intervals
  // scraperManager.register(new NodeScraper(config), 60_000);
  // scraperManager.register(new L1Scraper(config), 120_000);

  await scraperManager.init();
  await scraperManager.start();

  // 5. Initialize provider metrics (uses scraper data)
  console.log("\nStep 5: Initializing provider metrics...");
  initProviderMetrics(providerScraper);

  // 6. Initialize coinbase metrics
  console.log("\nStep 6: Initializing coinbase metrics...");
  initCoinbaseMetrics();

  // 7. Initialize state management
  console.log("\nStep 7: Initializing state management...");
  await initState();

  // 8. Initialize watchers (monitors file changes)
  console.log("\nStep 8: Initializing watchers...");
  await initWatchers({
    dataDirPath: config.AZTEC_DOCKER_DIR,
  });

  // 9. Initialize handlers (only if provider is configured)
  console.log("\nStep 9: Initializing handlers...");
  if (config.PROVIDER_ADMIN_ADDRESS) {
    // Get provider data from scraper to initialize handler
    const providerData = providerScraper.getData();
    if (providerData) {
      // Initialize Aztec client to get node info for Ethereum client
      const aztecClient = new AztecClient({
        nodeUrl: config.AZTEC_NODE_URL,
      });
      const nodeInfo = await aztecClient.getNodeInfo();

      // Create Ethereum client for handler
      const ethClient = new EthereumClient({
        rpcUrl: config.ETHEREUM_NODE_URL,
        chainId: nodeInfo.l1ChainId,
        rollupAddress: nodeInfo.l1ContractAddresses.rollupAddress.toString(),
      });

      await initHandlers({
        ethClient,
        providerId: providerData.providerId,
      });
    } else {
      console.log(
        "Provider not yet scraped, handlers will be initialized after first scrape completes",
      );
    }
  } else {
    console.log(
      "Provider admin address not configured, skipping handler initialization",
    );
  }

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
      // Shutdown handlers
      console.log("Shutting down handlers...");
      await shutdownHandlers();
      console.log("Handlers shut down");

      // Shutdown watchers
      console.log("Shutting down watchers...");
      await shutdownWatchers();
      console.log("Watchers shut down");

      // Shutdown scrapers
      console.log("Shutting down scrapers...");
      await scraperManager.shutdown();
      console.log("Scrapers shut down");

      // Shutdown metrics
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

  // Keep the process alive
  // The Prometheus exporter HTTP server and setInterval in ScraperManager
  // will keep the event loop active, preventing the process from exiting

  console.log("\n=== Server is running ===");
  console.log(`
Endpoints:
  - Metrics: http://localhost:${metricsPort}/metrics

Press Ctrl+C to stop
`);
};
