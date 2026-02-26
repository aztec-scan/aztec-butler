import type { BaseScraper } from "./base-scraper.js";

export interface ScraperConfig {
  scraper: BaseScraper;
  intervalMs: number;
  enabled: boolean;
}

/**
 * Manages multiple scrapers with different intervals
 * Handles initialization, periodic scraping, and graceful shutdown
 */
export class ScraperManager {
  private scraperConfigs: ScraperConfig[] = [];
  private intervalHandles: NodeJS.Timeout[] = [];
  private isRunning = false;

  /**
   * Register a scraper with a specific interval
   */
  register(scraper: BaseScraper, intervalMs: number) {
    this.scraperConfigs.push({ scraper, intervalMs, enabled: true });
  }

  /**
   * Initialize all scrapers
   */
  async init() {
    console.log(`Initializing ${this.scraperConfigs.length} scrapers...`);
    let initializedCount = 0;
    let failedCount = 0;

    for (const config of this.scraperConfigs) {
      const { scraper } = config;
      try {
        console.log(
          `  - Initializing ${scraper.name} scraper [${scraper.network}]...`,
        );
        await scraper.init();
        initializedCount++;
      } catch (error) {
        console.error(
          `  ✗ Failed to initialize ${scraper.name} scraper [${scraper.network}]:`,
          error,
        );
        config.enabled = false;
        failedCount++;
      }
    }

    if (failedCount > 0) {
      console.warn(
        `Scraper initialization complete (${initializedCount} ok, ${failedCount} failed). Failed scrapers will be skipped.`,
      );
    } else {
      console.log("All scrapers initialized successfully");
    }
  }

  /**
   * Start all scrapers with their configured intervals
   */
  async start() {
    if (this.isRunning) {
      console.warn("Scraper manager is already running");
      return;
    }

    console.log("Starting all scrapers...");
    this.isRunning = true;

    for (const { scraper, intervalMs, enabled } of this.scraperConfigs) {
      if (!enabled) {
        console.warn(
          `  ! Skipping ${scraper.name} scraper [${scraper.network}] (disabled after failed init)`,
        );
        continue;
      }

      // Run immediately on start
      try {
        console.log(
          `  - Running initial scrape for ${scraper.name} [${scraper.network}]...`,
        );
        await scraper.scrape();
      } catch (error) {
        console.error(
          `  ✗ Initial scrape failed for ${scraper.name} [${scraper.network}]:`,
          error,
        );
        // Continue with other scrapers
      }

      // Schedule periodic scraping
      const handle = setInterval(() => {
        void (async () => {
          try {
            await scraper.scrape();
          } catch (error) {
            console.error(
              `Error in ${scraper.name} scraper [${scraper.network}]:`,
              error,
            );
            // Continue scraping on next interval
          }
        })();
      }, intervalMs);

      this.intervalHandles.push(handle);

      console.log(
        `  ✓ ${scraper.name} scraper [${scraper.network}] scheduled (interval: ${intervalMs / 1000}s)`,
      );
    }

    console.log("All scrapers started successfully");
  }

  /**
   * Stop all scrapers and cleanup
   */
  async shutdown() {
    if (!this.isRunning) {
      return;
    }

    console.log("Shutting down scraper manager...");
    this.isRunning = false;

    // Clear all intervals
    for (const handle of this.intervalHandles) {
      clearInterval(handle);
    }
    this.intervalHandles = [];

    // Shutdown all scrapers
    for (const { scraper } of this.scraperConfigs) {
      try {
        await scraper.shutdown();
      } catch (error) {
        console.error(
          `Error shutting down ${scraper.name} scraper [${scraper.network}]:`,
          error,
        );
      }
    }

    console.log("Scraper manager shut down successfully");
  }

  /**
   * Get a registered scraper by name
   */
  getScraper<T extends BaseScraper>(name: string): T | undefined {
    const config = this.scraperConfigs.find((c) => c.scraper.name === name);
    return config?.scraper as T | undefined;
  }
}
