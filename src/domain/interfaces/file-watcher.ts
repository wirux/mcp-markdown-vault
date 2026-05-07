export type WatchEventType = "add" | "change" | "unlink";

export interface WatchOptions {
  ignored?: string[];
  persistent?: boolean;
}

export interface IFileWatcher {
  watch(vaultPath: string, options?: WatchOptions): void;
  on(event: WatchEventType, handler: (path: string) => void): void;
  close(): Promise<void>;
}
