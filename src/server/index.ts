import { loadAllAvailableNetworkConfigs } from "../core/config/index.js";
import type { ButlerConfig } from "../core/config/index.js";
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
  initNetworkState,
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
 * Initialize all components for a single network
 */
async function initializeNetwork(
  network: string,
  config: ButlerConfig,
  scraperManager: ScraperManager,
): Promise<{
  safeClient: SafeGlobalClient | null;
  stakingProviderScraper: StakingProviderScraper;
}> {
  console.log(`\n--- Initializing network: ${network} ---`);

  // Initialize state for this network
  initNetworkState(network);

  // Load scraper configuration
  console.log(`[${network}] Loading scraper configuration...`);
  const scraperConfig = await loadScraperConfig(network);
  console.log(
    `[${network}] Loaded scraper config: ${scraperConfig.attesters.length} attesters, ${scraperConfig.publishers.length} publishers`,
  );

  // Initialize state from scraper config
  console.log(`[${network}] Initializing state from scraper config...`);
  initAttesterStatesFromScraperConfig(network, scraperConfig);
  updateScraperConfigState(network, scraperConfig);

  // Register rollup scraper (60 second interval)
  console.log(`[${network}] Registering rollup scraper...`);
  const rollupScraper = new RollupScraper(network, config);
  scraperManager.register(rollupScraper, 60_000);

  // Register staking provider scraper (30 second interval)
  console.log(`[${network}] Registering staking provider scraper...`);
  const stakingProviderScraper = new StakingProviderScraper(
    network,
    config,
    scraperConfig,
  );
  scraperManager.register(stakingProviderScraper, 30_000);

  // Register publisher scraper (30 second interval)
  console.log(`[${network}] Registering publisher scraper...`);
  const publisherScraper = new PublisherScraper(network, config, scraperConfig);
  scraperManager.register(publisherScraper, 30_000);

  // Register staking rewards scraper (default hourly interval)
  let stakingRewardsScraper: StakingRewardsScraper | null = null;
  if (config.SAFE_ADDRESS) {
    console.log(`[${network}] Registering staking rewards scraper...`);
    stakingRewardsScraper = new StakingRewardsScraper(network, config);
    scraperManager.register(
      stakingRewardsScraper,
      config.STAKING_REWARDS_SCRAPE_INTERVAL_MS,
    );
  } else {
    console.log(
      `[${network}] SAFE_ADDRESS not configured, skipping staking rewards scraper`,
    );
  }

  // Initialize staking provider metrics for this network
  console.log(`[${network}] Initializing staking provider metrics...`);
  initStakingProviderMetrics(network, stakingProviderScraper);

  // Create SafeGlobal client if configured and proposals are enabled
  let safeClient: SafeGlobalClient | null = null;
  if (config.SAFE_ADDRESS && config.SAFE_PROPOSALS_ENABLED) {
    // Validate that required Safe credentials are present
    if (!config.MULTISIG_PROPOSER_PRIVATE_KEY || !config.SAFE_API_KEY) {
      throw new Error(
        `[${network}] SAFE_ADDRESS is configured but MULTISIG_PROPOSER_PRIVATE_KEY or SAFE_API_KEY is missing. ` +
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
      `[${network}] SafeGlobal client initialized for Safe at ${config.SAFE_ADDRESS} (proposals enabled)`,
    );
    safeClient.startPendingTransactionsPoll();
  } else if (config.SAFE_ADDRESS && !config.SAFE_PROPOSALS_ENABLED) {
    console.log(
      `[${network}] Safe monitoring enabled for ${config.SAFE_ADDRESS}, but automatic proposals are disabled. Set SAFE_PROPOSALS_ENABLED=true to enable.`,
    );
  }

  // Initialize handlers for this network
  console.log(`[${network}] Initializing handlers...`);
  await initHandlers(network, {
    safeClient,
  });

  return { safeClient, stakingProviderScraper };
}

/**
 * Combined server mode: Prometheus exporter + Event watcher
 *
 * This server orchestrates:
 * - HTTP server for /metrics (Prometheus exporter with network labels)
 * - Periodic scrapers to refresh metrics (per network)
 * - Event listeners for on-chain changes (per network)
 * - Action executor with retry logic (per network)
 *
 * Multi-network support:
 * - Automatically detects and loads all available network configs
 * - Creates isolated scraper instances per network
 * - Shares single Prometheus endpoint with network labels
 * - Isolates errors: one network failure doesn't affect others
 *
 * @param specificNetwork - Optional: run only a specific network (e.g., "mainnet", "testnet")
 */
export const startServer = async (specificNetwork?: string) => {
  console.log(`
    ___        __                  __          __  __
   /   |____  / /____  _____      / /_  __  __/ /_/ /__  _____
  / /| /_  / / __/ _ \\/ ___/_____/ __ \\/ / / / __/ / _ \\/ ___/
 / ___ |/ /_/ /_/  __/ /__/_____/ /_/ / /_/ / /_/ /  __/ /
/_/  |_/___/\\__/\\___/\\___/     /_.___/\\__,_/\\__/_/\\___/_/

`);

  initLog("Loading all available network configurations...");
  const networkConfigs = await loadAllAvailableNetworkConfigs(
    specificNetwork ? { specificNetwork } : undefined,
  );

  if (networkConfigs.size === 0) {
    if (specificNetwork) {
      throw new Error(
        `Network configuration not found for "${specificNetwork}". Please ensure ${specificNetwork}.env exists.`,
      );
    }
    throw new Error(
      "No network configurations found. Please ensure at least one network is configured.",
    );
  }

  if (specificNetwork) {
    console.log(`Running in single-network mode: ${specificNetwork}`);
  } else {
    console.log(
      `Found ${networkConfigs.size} network(s): ${Array.from(networkConfigs.keys()).join(", ")}`,
    );
  }

  // Get first config for shared settings (bearer token should be same across networks)
  const firstConfig = Array.from(networkConfigs.values())[0];
  if (!firstConfig) {
    throw new Error("No network configurations available");
  }

  initLog("Initializing Prometheus metrics registry...");
  const metricsPort = 9464;
  initMetricsRegistry({
    port: metricsPort,
    bearerToken: firstConfig.METRICS_BEARER_TOKEN,
  });
  console.log(
    `Prometheus metrics available at http://localhost:${metricsPort}/metrics`,
  );
  if (firstConfig.METRICS_BEARER_TOKEN) {
    console.log(
      `  Authentication: Bearer token required (configured: ${firstConfig.METRICS_BEARER_TOKEN === "default-api-key" ? "default" : "custom"})`,
    );
  }

  // Initialize shared metrics (these will aggregate across all networks)
  initLog("Initializing shared metrics...");
  initAttesterMetrics();
  initPublisherMetrics();
  initStakingRewardsMetrics();

  // Initialize config metrics for all networks
  initLog("Initializing configuration metrics for all networks...");
  for (const [network, config] of networkConfigs.entries()) {
    initConfigMetrics(network, config);
  }

  // Create a single scraper manager for all networks
  const scraperManager = new ScraperManager();

  // Track Safe clients per network for cleanup
  const safeClients = new Map<string, SafeGlobalClient>();

  // Initialize each network
  initLog("Initializing all networks...");
  for (const [network, config] of networkConfigs.entries()) {
    try {
      const { safeClient } = await initializeNetwork(
        network,
        config,
        scraperManager,
      );

      if (safeClient) {
        safeClients.set(network, safeClient);
      }

      console.log(`[${network}] Network initialization complete`);
    } catch (error) {
      console.error(`[${network}] Failed to initialize network:`, error);
      // Continue with other networks instead of failing completely
      console.warn(
        `[${network}] Skipping this network due to initialization error`,
      );
    }
  }

  // Initialize and start all scrapers
  initLog("Initializing and starting all scrapers...");
  await scraperManager.init();
  await scraperManager.start();

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
      // Shutdown handlers for all networks
      console.log("Shutting down handlers...");
      await shutdownHandlers();
      console.log("Handlers shut down");

      // Shutdown scrapers
      console.log("Shutting down scrapers...");
      await scraperManager.shutdown();
      console.log("Scrapers shut down");

      // Shutdown Safe clients
      for (const [network, safeClient] of safeClients.entries()) {
        console.log(`[${network}] Shutting down Safe client poller...`);
        safeClient.cancelPendingTransactionsPoll();
      }
      console.log("All Safe clients shut down");

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
Active networks: ${Array.from(networkConfigs.keys()).join(", ")}

Endpoints:
  - Metrics: http://localhost:${metricsPort}/metrics

All metrics include 'network' label for filtering.

Press Ctrl+C to stop
`);
};
