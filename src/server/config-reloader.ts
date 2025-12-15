import { loadAndMergeKeysFiles } from "../core/utils/keysFileOperations.js";
import {
  initAttesterStatesFromCache,
  updatePublishersState,
  getAttesterStates,
  getPublisherData,
  updateScraperConfigState,
  getScraperConfig,
} from "./state/index.js";

export interface ReloadResult {
  success: boolean;
  error?: string;
  changes: {
    attestersAdded: number;
    attestersRemoved: number;
    publishersAdded: number;
    publishersRemoved: number;
  };
}

export class ConfigReloader {
  private isReloading = false;

  constructor(private network: string) {}

  async reload(): Promise<ReloadResult> {
    if (this.isReloading) {
      return {
        success: false,
        error: "Reload already in progress",
        changes: {
          attestersAdded: 0,
          attestersRemoved: 0,
          publishersAdded: 0,
          publishersRemoved: 0,
        },
      };
    }

    this.isReloading = true;

    try {
      console.log(
        `[ConfigReloader/${this.network}] Starting configuration reload...`,
      );

      // Get current state
      const currentAttesters = Array.from(
        getAttesterStates(this.network).keys(),
      );
      const publisherData = getPublisherData(this.network);
      const currentPublishers = new Set(
        publisherData
          ? Array.from(publisherData.values()).map((p) =>
              p.publisherAddress.toLowerCase(),
            )
          : [],
      );

      // Load new configuration
      const { attesters, publishers, filesLoaded } =
        await loadAndMergeKeysFiles(this.network);

      if (filesLoaded.length === 0) {
        throw new Error("No keys files found after reload");
      }

      console.log(
        `[ConfigReloader/${this.network}] Loaded ${filesLoaded.length} file(s), ${attesters.length} attesters, ${publishers.length} publishers`,
      );

      // Calculate changes
      const newAttesterAddrs = new Set(
        attesters.map((a) => a.address.toLowerCase()),
      );
      const newPublisherAddrs = new Set(
        publishers.map((p) => p.address.toLowerCase()),
      );

      const attestersAdded = attesters.filter(
        (a) => !currentAttesters.includes(a.address.toLowerCase()),
      ).length;
      const attestersRemoved = currentAttesters.filter(
        (a) => !newAttesterAddrs.has(a),
      ).length;

      const publishersAdded = publishers.filter(
        (p) => !currentPublishers.has(p.address.toLowerCase()),
      ).length;
      const publishersRemoved = Array.from(currentPublishers).filter(
        (p) => !newPublisherAddrs.has(p),
      ).length;

      // Apply new configuration
      // Note: We don't remove existing attester state entries, only add new ones
      // This preserves state tracking for attesters that may have been temporarily removed
      const newAttesters = attesters.filter(
        (a) => !currentAttesters.includes(a.address.toLowerCase()),
      );

      if (newAttesters.length > 0) {
        console.log(
          `[ConfigReloader/${this.network}] Initializing ${newAttesters.length} new attester(s)`,
        );
        initAttesterStatesFromCache(this.network, newAttesters);
      }

      // Update publishers list
      const publisherAddresses = publishers.map((p) => p.address);
      updatePublishersState(this.network, publisherAddresses);

      // Update scraper config state with new attesters and publishers
      const currentScraperConfig = getScraperConfig(this.network);
      if (currentScraperConfig) {
        console.log(
          `[ConfigReloader/${this.network}] Updating scraper config state...`,
        );
        updateScraperConfigState(this.network, {
          ...currentScraperConfig,
          attesters: attesters.map((a) => ({
            address: a.address,
            coinbase: a.coinbase,
          })),
          publishers: publisherAddresses,
          lastUpdated: new Date().toISOString(),
        });
      }

      // Check for missing coinbases in new attesters
      const missingCoinbase = newAttesters.filter((a) => !a.coinbase);
      if (missingCoinbase.length > 0) {
        console.warn(
          `[ConfigReloader/${this.network}] Warning: ${missingCoinbase.length} new attester(s) missing coinbase addresses`,
        );
      }

      console.log(
        `[ConfigReloader/${this.network}] Configuration reload complete`,
      );
      console.log(`  Attesters: +${attestersAdded} -${attestersRemoved}`);
      console.log(`  Publishers: +${publishersAdded} -${publishersRemoved}`);

      return {
        success: true,
        changes: {
          attestersAdded,
          attestersRemoved,
          publishersAdded,
          publishersRemoved,
        },
      };
    } catch (error) {
      console.error(
        `[ConfigReloader/${this.network}] Reload failed:`,
        error instanceof Error ? error.message : String(error),
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        changes: {
          attestersAdded: 0,
          attestersRemoved: 0,
          publishersAdded: 0,
          publishersRemoved: 0,
        },
      };
    } finally {
      this.isReloading = false;
    }
  }
}
