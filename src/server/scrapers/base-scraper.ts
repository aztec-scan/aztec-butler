/**
 * Base interface for all scrapers.
 * Scrapers are responsible for fetching data from various sources
 * (files, RPC, contracts) to populate metrics and feed watchers.
 */
export interface BaseScraper {
  /**
   * Unique identifier for this scraper
   */
  readonly name: string;

  /**
   * Initialize the scraper (setup connections, etc.)
   */
  init(): Promise<void>;

  /**
   * Perform a single scrape operation
   */
  scrape(): Promise<void>;

  /**
   * Cleanup resources
   */
  shutdown(): Promise<void>;
}

/**
 * Abstract base class implementing common scraper patterns
 */
export abstract class AbstractScraper implements BaseScraper {
  abstract readonly name: string;

  async init(): Promise<void> {
    // Default: no-op
  }

  abstract scrape(): Promise<void>;

  async shutdown(): Promise<void> {
    // Default: no-op
  }
}
