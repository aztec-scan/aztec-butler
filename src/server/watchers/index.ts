/**
 * Watchers module - monitors for changes and triggers handlers
 *
 * This module contains:
 * - file-watcher.ts: Local file change monitoring for keystores
 */

import { FileWatcher } from "./file-watcher.js";
import { updateDirData } from "../state/index.js";
import type { DirData } from "../../types.js";

let fileWatcher: FileWatcher | null = null;

export interface WatchersConfig {
  dataDirPath: string;
}

/**
 * Initialize file watchers
 */
export const initWatchers = async (config: WatchersConfig) => {
  console.log("Initializing file watcher...");

  fileWatcher = new FileWatcher({
    dataDirPath: config.dataDirPath,
    debounceMs: 500,
  });

  // Register callback for file changes
  fileWatcher.onChange((eventType, data) => {
    if (eventType === "error") {
      console.error("[Watchers] File watcher error:", data);
      return;
    }

    if (eventType === "keystoreChange" || eventType === "envChange") {
      console.log(`[Watchers] Detected ${eventType}, updating state...`);
      const changes = updateDirData(data as DirData);
      console.log(
        `[Watchers] State updated. Detected ${changes.length} coinbase change(s)`,
      );
    }
  });

  // Start watching
  await fileWatcher.start();

  console.log("File watcher initialized successfully");
};

/**
 * Shutdown watchers
 */
export const shutdownWatchers = async () => {
  if (fileWatcher) {
    await fileWatcher.stop();
    fileWatcher = null;
    console.log("File watcher shut down");
  }
};

export { FileWatcher };
