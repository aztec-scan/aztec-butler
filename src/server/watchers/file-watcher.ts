import chokidar from "chokidar";
import { join } from "path";
import { getDockerDirData } from "../../core/utils/fileOperations.js";
import type { DirData } from "../../types/index.js";
import {
  getAttesterState,
  updateAttesterState,
  AttesterState,
} from "../state/index.js";
import { getAddressFromPrivateKey } from "@aztec/ethereum";

export type FileWatcherEventType = "keystoreChange" | "envChange" | "error";

export type FileWatcherCallback = (
  eventType: FileWatcherEventType,
  data: DirData | Error,
) => void;

export interface FileWatcherConfig {
  dataDirPath: string;
  debounceMs?: number;
}

/**
 * File watcher for monitoring changes in the Aztec data directory
 * Uses chokidar for reliable cross-platform file watching
 */
export class FileWatcher {
  private watcher: ReturnType<typeof chokidar.watch> | null = null;
  private callbacks: FileWatcherCallback[] = [];
  private debounceTimer: NodeJS.Timeout | null = null;
  private readonly debounceMs: number;
  private readonly dataDirPath: string;
  private isProcessing = false;

  constructor(config: FileWatcherConfig) {
    this.dataDirPath = config.dataDirPath;
    this.debounceMs = config.debounceMs ?? 500; // Default 500ms debounce
  }

  /**
   * Start watching the data directory for changes
   */
  async start(): Promise<void> {
    if (this.watcher) {
      console.log("[FileWatcher] Already started");
      return;
    }

    const keysDir = join(this.dataDirPath, "keys");
    const envFile = join(this.dataDirPath, ".env");

    console.log(`[FileWatcher] Starting to watch:`);
    console.log(`  - Keys directory: ${keysDir}`);
    console.log(`  - Environment file: ${envFile}`);

    this.watcher = chokidar.watch([keysDir, envFile], {
      persistent: true,
      ignoreInitial: true, // Don't emit events for files that already exist
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100,
      },
    });

    this.watcher
      .on("add", (path: string) => this.handleFileChange("add", path))
      .on("change", (path: string) => this.handleFileChange("change", path))
      .on("unlink", (path: string) => this.handleFileChange("unlink", path))
      .on("error", (error: unknown) => this.handleError(error as Error));

    console.log("[FileWatcher] Started successfully");
  }

  /**
   * Stop watching and clean up resources
   */
  async stop(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
      console.log("[FileWatcher] Stopped");
    }
  }

  /**
   * Register a callback to be called when file changes are detected
   */
  onChange(callback: FileWatcherCallback): void {
    this.callbacks.push(callback);
  }

  /**
   * Handle file system events (add, change, unlink)
   */
  private handleFileChange(event: string, path: string): void {
    const isKeystoreChange = path.includes("/keys/");
    const isEnvChange = path.endsWith(".env");

    console.log(
      `[FileWatcher] Detected ${event} event: ${path} (keystore: ${isKeystoreChange}, env: ${isEnvChange})`,
    );

    // Debounce: wait for file system to settle before processing
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      void this.processChange(
        isKeystoreChange ? "keystoreChange" : "envChange",
      );
    }, this.debounceMs);
  }

  /**
   * Handle errors from the file watcher
   */
  private handleError(error: Error): void {
    console.error("[FileWatcher] Error:", error);
    this.emitEvent("error", error);
  }

  /**
   * Process a detected change by reading the data directory
   */
  private async processChange(
    eventType: Exclude<FileWatcherEventType, "error">,
  ): Promise<void> {
    if (this.isProcessing) {
      console.log("[FileWatcher] Already processing a change, skipping");
      return;
    }

    this.isProcessing = true;

    try {
      console.log(`[FileWatcher] Processing ${eventType} event...`);
      const dirData = await getDockerDirData(this.dataDirPath);
      console.log(
        `[FileWatcher] Successfully read directory data: ${dirData.keystores.length} keystores, ${dirData.attesterRegistrations.length} registrations`,
      );

      // Detect new attesters and update their states
      if (eventType === "keystoreChange") {
        this.detectAndUpdateNewAttesters(dirData);
      }

      this.emitEvent(eventType, dirData);
    } catch (error) {
      console.error("[FileWatcher] Failed to read directory data:", error);
      this.emitEvent("error", error as Error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Detect new attesters in directory data and update their states
   */
  private detectAndUpdateNewAttesters(dirData: DirData): void {
    const attesterAddresses = new Set<string>();

    // Collect all attester addresses from keystores
    for (const keystore of dirData.keystores) {
      for (const validator of keystore.data.validators) {
        // Derive address from private key
        const attesterAddress = getAddressFromPrivateKey(
          validator.attester.eth as `0x${string}`,
        );
        attesterAddresses.add(attesterAddress);
      }
    }

    // Check for new attesters
    for (const attesterAddress of attesterAddresses) {
      const existingState = getAttesterState(attesterAddress);
      if (!existingState) {
        console.log(`[FileWatcher] Detected new attester: ${attesterAddress}`);
        updateAttesterState(attesterAddress, AttesterState.NEW);
      }
    }
  }

  /**
   * Emit an event to all registered callbacks
   */
  private emitEvent(
    eventType: FileWatcherEventType,
    data: DirData | Error,
  ): void {
    for (const callback of this.callbacks) {
      try {
        callback(eventType, data);
      } catch (error) {
        console.error("[FileWatcher] Error in callback:", error);
      }
    }
  }
}
