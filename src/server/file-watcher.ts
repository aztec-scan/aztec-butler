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

export function getRegisteredKeysWatchPath(): string {
  return getDataDir();
}

export function isRegisteredKeysFile(network: string, filePath: string): boolean {
  const dataDir = getDataDir();
  const relativePath = path.relative(dataDir, filePath);
  const parts = relativePath.split(path.sep);

  return (
    parts.length === 3 &&
    parts[0] === network &&
    parts[1] !== "" &&
    /^[^-].*-registered-keys\.json$/.test(parts[2] ?? "")
  );
}

export class KeysFileWatcher {
  private watcher: ReturnType<typeof chokidar.watch> | null = null;

  constructor(private options: FileWatcherOptions) {}

  start(): void {
    const watchPath = getRegisteredKeysWatchPath();

    // Use polling to reliably detect atomic file replacements (e.g. Ansible
    // copy, rsync, scp).  These tools write to a temp file and then rename it
    // into place, which replaces the inode.  inotify-based watchers on glob
    // patterns can silently miss this because the watched inode is unlinked and
    // a new one appears.  Polling at a 5 s interval is cheap and guarantees we
    // notice the change.
    this.watcher = chokidar.watch(watchPath, {
      persistent: true,
      ignoreInitial: true, // Don't emit events for existing files
      depth: 2,
      ignored: (filePath: string) => {
        return path.extname(filePath) === ".json"
          ? !isRegisteredKeysFile(this.options.network, filePath)
          : false;
      },
      usePolling: true,
      interval: 5000, // Poll every 5 seconds
      awaitWriteFinish: {
        stabilityThreshold: 2000, // Wait 2s after last change
        pollInterval: 500,
      },
    });

    this.watcher
      .on("add", (filePath: string) => {
        if (!isRegisteredKeysFile(this.options.network, filePath)) {
          return;
        }
        console.log(
          `[FileWatcher/${this.options.network}] Detected new registered keys file: ${filePath}`,
        );
        this.options.onKeysFileChange("add", filePath);
      })
      .on("change", (filePath: string) => {
        if (!isRegisteredKeysFile(this.options.network, filePath)) {
          return;
        }
        console.log(
          `[FileWatcher/${this.options.network}] Detected registered keys file change: ${filePath}`,
        );
        this.options.onKeysFileChange("change", filePath);
      })
      .on("unlink", (filePath: string) => {
        if (!isRegisteredKeysFile(this.options.network, filePath)) {
          return;
        }
        console.log(
          `[FileWatcher/${this.options.network}] Detected registered keys file removal: ${filePath}`,
        );
        this.options.onKeysFileChange("unlink", filePath);
      })
      .on("error", (err: unknown) => {
        console.error(
          `[FileWatcher/${this.options.network}] Watcher error:`,
          err instanceof Error ? err : new Error(String(err)),
        );
      })
      .on("ready", () => {
        console.log(
          `[FileWatcher/${this.options.network}] Ready and watching nested registered keys under: ${watchPath}`,
        );
      });

    console.log(
      `[FileWatcher/${this.options.network}] Watching for nested registered keys changes (polling): ${watchPath}`,
    );
  }

  stop(): void {
    if (this.watcher) {
      void this.watcher.close();
      this.watcher = null;
      console.log(
        `[FileWatcher/${this.options.network}] Stopped watching keys files`,
      );
    }
  }
}
