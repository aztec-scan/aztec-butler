import chokidar from "chokidar";
import path from "path";
import { getDataDir } from "../core/utils/keysFileOperations.js";

export interface FileWatcherOptions {
  network: string;
  onKeysFileChange: (
    eventType: "add" | "change" | "unlink",
    filePath: string,
  ) => void;
}

export class KeysFileWatcher {
  private watcher: ReturnType<typeof chokidar.watch> | null = null;

  constructor(private options: FileWatcherOptions) {}

  start(): void {
    const dataDir = getDataDir();
    const pattern = path.join(dataDir, `${this.options.network}-keys-*.json`);

    this.watcher = chokidar.watch(pattern, {
      persistent: true,
      ignoreInitial: true, // Don't emit events for existing files
      awaitWriteFinish: {
        stabilityThreshold: 2000, // Wait 2s after last change
        pollInterval: 100,
      },
    });

    this.watcher
      .on("add", (filePath: string) =>
        this.options.onKeysFileChange("add", filePath),
      )
      .on("change", (filePath: string) =>
        this.options.onKeysFileChange("change", filePath),
      )
      .on("unlink", (filePath: string) =>
        this.options.onKeysFileChange("unlink", filePath),
      );

    console.log(`[FileWatcher] Watching for keys file changes: ${pattern}`);
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      console.log("[FileWatcher] Stopped watching keys files");
    }
  }
}
