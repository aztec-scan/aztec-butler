/**
 * Agent runtime — the local, read-only sequencer telemetry process.
 *
 *   aztec-butler agent --network mainnet
 *
 * Reads host-local registered-key files, performs read-only L1/L2 checks for
 * those keys, optionally scrapes global chain state, and pushes everything to
 * a local OpenTelemetry collector over OTLP. It runs no HTTP server and loads
 * no private keys.
 */

import { ScraperManager } from "../server/scrapers/scraper-manager.js";
import type { BaseScraper } from "../server/scrapers/base-scraper.js";
import { initAgentChain } from "./chain.js";
import { describeAgentConfig, loadAgentConfig, type AgentConfig } from "./config.js";
import { registerAgentMetrics } from "./metrics/agent-metrics.js";
import { initAgentMeterProvider, type AgentMeterProvider } from "./metrics/otlp.js";
import { GlobalStatsScraper } from "./scrapers/global-stats-scraper.js";
import { LocalKeyScraper } from "./scrapers/local-key-scraper.js";
import { LocalStatusScraper } from "./scrapers/local-status-scraper.js";
import { PublisherBalanceScraper } from "./scrapers/publisher-balance-scraper.js";
import { initAgentState } from "./state.js";
import type { AgentChainContext } from "./chain.js";

export interface AgentRunOptions {
  network?: string;
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

/** Build the enabled scrapers in dependency order (local keys first). */
const buildScrapers = (config: AgentConfig, chain: AgentChainContext): RegisteredScraper[] => {
  const scrapers: RegisteredScraper[] = [];

  if (config.scrapers.localKeys) {
    scrapers.push({
      scraper: new LocalKeyScraper(config),
      intervalMs: config.scrapeIntervalMs,
    });
  }
  if (config.scrapers.l1Status || config.scrapers.rollupStatus) {
    scrapers.push({
      scraper: new LocalStatusScraper(config, chain),
      intervalMs: config.scrapeIntervalMs,
    });
  }
  if (config.scrapers.publisherBalances) {
    scrapers.push({
      scraper: new PublisherBalanceScraper(config, chain),
      intervalMs: config.scrapeIntervalMs,
    });
  }
  if (config.scrapers.globalStats) {
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

  // 1. Config (fails closed on unsafe/mutating config).
  const config = options.configFilePath
    ? loadAgentConfig(network, { configFilePath: options.configFilePath })
    : loadAgentConfig(network);
  console.log(`[agent] ${describeAgentConfig(config)}`);

  if (config.scrapers.globalStats) {
    console.log(
      "[agent] GLOBAL stats export is ENABLED on this host. Ensure exactly ONE " +
        "agent per network does this, or backends will see duplicate global series.",
    );
  }

  // 2. State.
  initAgentState(config.network, config.host);

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
  console.log(`network=${config.network} host=${config.host}`);
  console.log("Press Ctrl+C to stop\n");
};
