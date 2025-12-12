import { initConfig } from "../core/config/index.js";
import {
  initMetricsRegistry,
  initConfigMetrics,
  initStakingProviderMetrics,
  initAttesterMetrics,
  initPublisherMetrics,
  initStakingRewardsMetrics,
  getMetricsRegistry,
} from "./metrics/index.js";
import {
  ScraperManager,
  StakingProviderScraper,
  PublisherScraper,
  RollupScraper,
  StakingRewardsScraper,
} from "./scrapers/index.js";
import { initHandlers, shutdownHandlers } from "./handlers/index.js";
import {
  initState,
  initAttesterStatesFromScraperConfig,
  updateScraperConfigState,
} from "./state/index.js";
import { AztecClient } from "../core/components/AztecClient.js";
import { SafeGlobalClient } from "../core/components/SafeGlobalClient.js";
import { loadScraperConfig } from "../core/utils/scraperConfigOperations.js";

let logCounter = 0;

const initLog = (str: string) => {
  const counter = ++logCounter;
  console.log(`\n\n=====  [${counter}] ${str}`);
};

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

  initLog("Initializing configuration...");
  const config = await initConfig();

  initLog("Initializing Prometheus metrics registry...");
  const metricsPort = 9464;
  initMetricsRegistry({
    port: metricsPort,
    bearerToken: config.METRICS_BEARER_TOKEN,
  });
  console.log(
    `Prometheus metrics available at http://localhost:${metricsPort}/metrics`,
  );
  if (config.METRICS_BEARER_TOKEN) {
    console.log(
      `  Authentication: Bearer token required (configured: ${config.METRICS_BEARER_TOKEN === "default-api-key" ? "default" : "custom"})`,
    );
  }

  initLog("Initializing configuration metrics...");
  initConfigMetrics(config);

  initLog("Initializing state management...");
  await initState();

  initLog("Loading scraper configuration...");
  const scraperConfig = await loadScraperConfig(config.NETWORK);
  console.log(
    `Loaded scraper config: ${scraperConfig.attesters.length} attesters, ${scraperConfig.publishers.length} publishers`,
  );

  initLog("Initializing state from scraper config...");
  initAttesterStatesFromScraperConfig(scraperConfig);
  updateScraperConfigState(scraperConfig);

  initLog("Initializing scrapers...");
  const scraperManager = new ScraperManager();

  // Register rollup scraper (60 second interval)
  // Fetches on-chain attester status from the rollup contract
  const rollupScraper = new RollupScraper(config);
  scraperManager.register(rollupScraper, 60_000);

  // Register staking provider scraper (30 second interval)
  // This scraper now handles both staking provider data AND attester state management
  const stakingProviderScraper = new StakingProviderScraper(
    config,
    scraperConfig,
  );
  scraperManager.register(stakingProviderScraper, 30_000);

  // Register publisher scraper (30 second interval)
  // Tracks publisher ETH balances and required top-ups
  const publisherScraper = new PublisherScraper(config, scraperConfig);
  scraperManager.register(publisherScraper, 30_000);

  // Register staking rewards scraper (default hourly interval)
  let stakingRewardsScraper: StakingRewardsScraper | null = null;
  if (config.SAFE_ADDRESS) {
    stakingRewardsScraper = new StakingRewardsScraper(config);
    scraperManager.register(
      stakingRewardsScraper,
      config.STAKING_REWARDS_SCRAPE_INTERVAL_MS,
    );
  } else {
    console.log(
      "SAFE_ADDRESS not configured, skipping staking rewards scraper",
    );
  }

  // TODO: Add more scrapers here with their own intervals
  // scraperManager.register(new NodeScraper(config), 60_000);
  // scraperManager.register(new L1Scraper(config), 120_000);

  await scraperManager.init();
  await scraperManager.start();

  initLog("Initializing staking provider metrics...");
  initStakingProviderMetrics(stakingProviderScraper);

  initLog("Initializing attester metrics...");
  initAttesterMetrics();

  initLog("Initializing publisher metrics...");
  initPublisherMetrics();

  initLog("Initializing staking rewards metrics...");
  initStakingRewardsMetrics();

  // File watchers not used in scraper mode
  // Scraper uses static configuration from scraper config file
  // Config updates require server restart

  let safeClient: SafeGlobalClient | null = null;
  initLog("Initializing handlers...");

  // Create SafeGlobal client if configured
  if (config.SAFE_ADDRESS) {
    // Validate that required Safe credentials are present
    if (!config.MULTISIG_PROPOSER_PRIVATE_KEY || !config.SAFE_API_KEY) {
      throw new Error(
        "SAFE_ADDRESS is configured but MULTISIG_PROPOSER_PRIVATE_KEY or SAFE_API_KEY is missing. " +
          "Both are required for Safe multisig functionality.",
      );
    }

    // Initialize Aztec client to get node info
    const aztecClient = new AztecClient({
      nodeUrl: config.AZTEC_NODE_URL,
    });
    const nodeInfo = await aztecClient.getNodeInfo();

    safeClient = new SafeGlobalClient({
      safeAddress: config.SAFE_ADDRESS,
      chainId: nodeInfo.l1ChainId,
      rpcUrl: config.ETHEREUM_NODE_URL,
      proposerPrivateKey: config.MULTISIG_PROPOSER_PRIVATE_KEY,
      safeApiKey: config.SAFE_API_KEY,
    });
    console.log(
      `SafeGlobal client initialized for Safe at ${config.SAFE_ADDRESS}`,
    );
    safeClient.startPendingTransactionsPoll();
  }

  // Initialize handlers (currently only publisher top-up)
  await initHandlers({
    safeClient,
  });

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

      // Shutdown scrapers
      console.log("Shutting down scrapers...");
      await scraperManager.shutdown();
      console.log("Scrapers shut down");

      // Shutdown scrapers
      if (safeClient) {
        console.log("Shutting down Safe client poller...");
        safeClient.cancelPendingTransactionsPoll();
        console.log("Safe client shut down");
      }

      // Shutdown metrics
      const { exporter, authServer } = getMetricsRegistry();
      console.log("Shutting down Prometheus exporter...");

      // Close auth server if it exists
      if (authServer) {
        await new Promise<void>((resolve, reject) => {
          authServer.close((err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      }

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
