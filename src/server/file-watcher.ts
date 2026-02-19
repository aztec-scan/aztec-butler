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

    // Use polling to reliably detect atomic file replacements (e.g. Ansible
    // copy, rsync, scp).  These tools write to a temp file and then rename it
    // into place, which replaces the inode.  inotify-based watchers on glob
    // patterns can silently miss this because the watched inode is unlinked and
    // a new one appears.  Polling at a 5 s interval is cheap and guarantees we
    // notice the change.
    this.watcher = chokidar.watch(pattern, {
      persistent: true,
      ignoreInitial: true, // Don't emit events for existing files
      usePolling: true,
      interval: 5000, // Poll every 5 seconds
      awaitWriteFinish: {
        stabilityThreshold: 2000, // Wait 2s after last change
        pollInterval: 500,
      },
    });

    this.watcher
      .on("add", (filePath: string) => {
        console.log(
          `[FileWatcher/${this.options.network}] Detected new keys file: ${path.basename(filePath)}`,
        );
        this.options.onKeysFileChange("add", filePath);
      })
      .on("change", (filePath: string) => {
        console.log(
          `[FileWatcher/${this.options.network}] Detected keys file change: ${path.basename(filePath)}`,
        );
        this.options.onKeysFileChange("change", filePath);
      })
      .on("unlink", (filePath: string) => {
        console.log(
          `[FileWatcher/${this.options.network}] Detected keys file removal: ${path.basename(filePath)}`,
        );
        this.options.onKeysFileChange("unlink", filePath);
      })
      .on("error", (error: Error) => {
        console.error(
          `[FileWatcher/${this.options.network}] Watcher error:`,
          error,
        );
      })
      .on("ready", () => {
        console.log(
          `[FileWatcher/${this.options.network}] Ready and watching: ${pattern}`,
        );
      });

    console.log(
      `[FileWatcher/${this.options.network}] Watching for keys file changes (polling): ${pattern}`,
    );
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      console.log(
        `[FileWatcher/${this.options.network}] Stopped watching keys files`,
      );
    }
  }
}
