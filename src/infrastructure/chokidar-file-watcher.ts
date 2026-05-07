import chokidar, { type FSWatcher } from "chokidar";
import path from "node:path";
import type {
  IFileWatcher,
  WatchEventType,
  WatchOptions,
} from "../domain/interfaces/index.js";

export class ChokidarFileWatcher implements IFileWatcher {
  private watcher: FSWatcher | null = null;

  watch(vaultPath: string, options?: WatchOptions): void {
    this.watcher = chokidar.watch(vaultPath, {
      ignored: (filePath: string) => {
        const ext = path.extname(filePath);
        if (ext === "" || ext === ".md") {
          return false;
        }

        return options?.ignored?.includes(filePath) ?? true;
      },
      persistent: options?.persistent ?? true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 100 },
    });
  }

  on(event: WatchEventType, handler: (path: string) => void): void {
    this.watcher?.on(event, handler);
  }

  async close(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }
}
