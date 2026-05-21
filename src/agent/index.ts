/**
 * Agent runtime — the local, read-only sequencer telemetry process.
 *
 *   aztec-butler agent --mode node   --network mainnet   (on each sequencer host)
 *   aztec-butler agent --mode global --network mainnet   (on the monitoring server)
 *   aztec-butler agent --mode all    --network mainnet   (dev / test / single-box)
 *
 * The run mode selects the scraper set and the metric-instrument set. The agent
 * runs no HTTP server and loads no private keys; it pushes metrics to a local
 * OpenTelemetry collector over OTLP.
 */

import { ScraperManager } from "../server/scrapers/scraper-manager.js";
import type { BaseScraper } from "../server/scrapers/base-scraper.js";
import { initAgentChain, type AgentChainContext } from "./chain.js";
import {
  describeAgentConfig,
  loadAgentConfig,
  modeHasGlobalScrapers,
  modeHasLocalScrapers,
  type AgentConfig,
} from "./config.js";
import { registerAgentMetrics } from "./metrics/agent-metrics.js";
import { initAgentMeterProvider, type AgentMeterProvider } from "./metrics/otlp.js";
import { LocalEntryQueueEtaScraper } from "./scrapers/entry-queue-eta-scraper.js";
import { GlobalStatsScraper } from "./scrapers/global-stats-scraper.js";
import { LocalKeyScraper } from "./scrapers/local-key-scraper.js";
import { LocalStatusScraper } from "./scrapers/local-status-scraper.js";
import { PublisherBalanceScraper } from "./scrapers/publisher-balance-scraper.js";
import { initAgentState } from "./state.js";

export interface AgentRunOptions {
  network?: string;
  /** Run mode — `node` | `global` | `all`. Required (from the `--mode` flag). */
  mode?: string;
  /** Run a single scrape + export cycle, then exit (for local testing). */
  once?: boolean;
  /** Print metrics to stdout instead of pushing OTLP (for local testing). */
  dryRun?: boolean;
  /** Override the per-network base env file path. */
  configFilePath?: string;
}

const BANNER = `
    ___        __                  __          __  __  __
   /   |____  / /____  _____      / /_  __  __/ /_/ /__  ____
  / /| /_  / / __/ _ \\/ ___/_____/ __ \\/ / / / __/ / _ \\/ __/
 / ___ |/ /_/ /_/  __/ /__/_____/ /_/ / /_/ / /_/ /  __/ /
/_/  |_/___/\\__/\\___/\\___/     /_.___/\\__,_/\\__/_/\\___/_/   agent
`;

interface RegisteredScraper {
  scraper: BaseScraper;
  intervalMs: number;
}

/** Build the scraper set for the configured run mode, in dependency order. */
const buildScrapers = (config: AgentConfig, chain: AgentChainContext): RegisteredScraper[] => {
  const scrapers: RegisteredScraper[] = [];

  if (modeHasLocalScrapers(config.mode)) {
    // Local keys first — the status/publisher scrapers enrich what it discovers.
    scrapers.push({ scraper: new LocalKeyScraper(config), intervalMs: config.scrapeIntervalMs });
    scrapers.push({ scraper: new LocalStatusScraper(config, chain), intervalMs: config.scrapeIntervalMs });
    scrapers.push({
      scraper: new PublisherBalanceScraper(config, chain),
      intervalMs: config.scrapeIntervalMs,
    });
    scrapers.push({
      scraper: new LocalEntryQueueEtaScraper(config, chain),
      intervalMs: config.entryQueueEtaIntervalMs,
    });
  }

  if (modeHasGlobalScrapers(config.mode)) {
    scrapers.push({
      scraper: new GlobalStatsScraper(config, chain),
      intervalMs: config.globalScrapeIntervalMs,
    });
  }

  return scrapers;
};

/** Run every scraper once, sequentially, in registration order. */
const runOnce = async (scrapers: RegisteredScraper[]): Promise<void> => {
  for (const { scraper } of scrapers) {
    try {
      await scraper.init();
      await scraper.scrape();
    } catch (error) {
      console.error(`[agent] Scraper "${scraper.name}" failed:`, error);
    }
  }
};

export const startAgent = async (options: AgentRunOptions = {}): Promise<void> => {
  console.log(BANNER);

  const network = options.network?.trim();
  if (!network) {
    throw new Error("Agent mode requires a network. Pass --network <network> (e.g. --network mainnet).");
  }
  const mode = options.mode?.trim();
  if (!mode) {
    throw new Error("Agent mode requires --mode <node|global|all>.");
  }

  // 1. Config (validates the mode and fails closed on unsafe/mutating config).
  const config = options.configFilePath
    ? loadAgentConfig(network, mode, { configFilePath: options.configFilePath })
    : loadAgentConfig(network, mode);
  console.log(`[agent] ${describeAgentConfig(config)}`);

  if (modeHasGlobalScrapers(config.mode)) {
    console.log(
      "[agent] GLOBAL metrics are exported by this process. Ensure exactly ONE " +
        "agent per network does this, or backends will see duplicate global series.",
    );
  }

  // 2. State.
  initAgentState(config.network, config.host ?? "");

  // 3. Chain context (verifies chain ID before trusting any L1 read).
  console.log("[agent] Initialising chain context...");
  const chain = await initAgentChain(config);

  // 4. Metrics.
  const meterProvider: AgentMeterProvider = initAgentMeterProvider(config, {
    ...(options.dryRun ? { dryRun: true } : {}),
    // In --once mode keep the periodic interval long; we flush explicitly.
    ...(options.once ? { exportIntervalMs: 600_000 } : {}),
  });
  registerAgentMetrics(meterProvider.meter, config);

  // 5. Scrapers.
  const scrapers = buildScrapers(config, chain);
  console.log(`[agent] Enabled scrapers: ${scrapers.map((s) => s.scraper.name).join(", ") || "(none)"}`);

  // ── one-shot mode ─────────────────────────────────────────────────────
  if (options.once) {
    console.log("\n[agent] Running a single scrape + export cycle (--once)...\n");
    await runOnce(scrapers);
    console.log("\n[agent] Flushing metrics...");
    await meterProvider.forceFlush();
    await meterProvider.shutdown();
    console.log("[agent] Done.");
    return;
  }

  // ── continuous mode ───────────────────────────────────────────────────
  const scraperManager = new ScraperManager();
  for (const { scraper, intervalMs } of scrapers) {
    scraperManager.register(scraper, intervalMs);
  }

  await scraperManager.init();
  await scraperManager.start();

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("\n[agent] Shutting down...");
    try {
      await scraperManager.shutdown();
      await meterProvider.shutdown();
    } catch (error) {
      console.error("[agent] Error during shutdown:", error);
    }
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  console.log("\n=== Agent is running (read-only) ===");
  console.log(`network=${config.network} mode=${config.mode} host=${config.host ?? "(none)"}`);
  console.log("Press Ctrl+C to stop\n");
};
