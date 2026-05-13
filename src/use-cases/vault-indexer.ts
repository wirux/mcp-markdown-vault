import path from "node:path";
import type {
  IEmbeddingProvider,
  IFileSystemAdapter,
  IFileWatcher,
  IVectorStore,
  VectorChunk,
} from "../domain/interfaces/index.js";
import { MarkdownChunker } from "./chunker.js";
import { MarkdownPipeline } from "./markdown-pipeline.js";

export interface WatcherOptions {
  /** Milliseconds to debounce file-change events. Default: 500. */
  debounceMs?: number;
}

export interface VaultIndexerOptions {
  /** Meaningful-change threshold that triggers threshold subscribers. Default: 5. */
  threshold?: number;
}

/** Snapshot of the indexer's current health and operational state. */
export interface IndexingHealthStatus {
  /** Derived state priority: 'indexing' > 'watching' > 'error' > 'idle'. */
  indexingState: "idle" | "indexing" | "watching" | "error";
  watcherState: "stopped" | "active";
  queueDepth: number;
  failureCount: number;
  lastFailure: { time: string; source: string } | null;
  indexedDocuments: number;
}

/**
 * Indexes vault notes into a vector store.
 *
 * Supports:
 * - One-shot full-vault indexing (`indexAll`)
 * - Single-file indexing (`indexFile`) / removal (`removeFile`)
 * - Offline queue with deduplication (`enqueue` / `processQueue`)
 * - Live file watching with debounced auto-queuing (`startWatching`)
 */
export class VaultIndexer {
  private readonly vaultRoot: string;
  private readonly store: IVectorStore;
  private readonly embedder: IEmbeddingProvider;
  private readonly watcherAdapter: IFileWatcher;
  private readonly fs: IFileSystemAdapter;
  private readonly chunker: MarkdownChunker;
  private readonly threshold: number;
  private watcherActive = false;

  /** Callbacks invoked after a file is successfully indexed. */
  private readonly onFileIndexedCbs: Array<
    (relativePath: string, content: string) => void
  > = [];
  /** Callbacks invoked after a file is removed from the index. */
  private readonly onFileRemovedCbs: Array<(relativePath: string) => void> = [];
  /** Callbacks invoked when the meaningful change threshold is reached. */
  private readonly onThresholdReachedCbs: Array<() => void> = [];
  /** Count of meaningful non-meta changes since last threshold/reset. */
  private meaningfulChangeCount = 0;

  /** Set of vault-relative paths pending indexing. */
  private readonly queue = new Set<string>();
  /** Debounce timers keyed by relative path. */
  private readonly debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Serialization guard — prevents concurrent processQueue runs. */
  private isProcessing = false;

  /** Number of indexing failures since startup. */
  failureCount = 0;
  /** Timestamp of the most recent indexing failure, or null if none. */
  lastFailureTime: Date | null = null;
  /** Vault-relative path of the most recently failed file, or null if none. */
  lastFailureSource: string | null = null;

  constructor(
    vaultRoot: string,
    store: IVectorStore,
    embedder: IEmbeddingProvider,
    watcher: IFileWatcher,
    fs: IFileSystemAdapter,
    options?: VaultIndexerOptions,
  ) {
    this.vaultRoot = path.resolve(vaultRoot);
    this.store = store;
    this.embedder = embedder;
    this.watcherAdapter = watcher;
    this.fs = fs;
    this.chunker = new MarkdownChunker(new MarkdownPipeline());
    this.threshold = options?.threshold ?? 5;
  }

  /** Registers a callback invoked after a file is successfully indexed. */
  addOnFileIndexed(cb: (relativePath: string, content: string) => void): void {
    this.onFileIndexedCbs.push(cb);
  }

  /** Registers a callback invoked after a file is removed from the index. */
  addOnFileRemoved(cb: (relativePath: string) => void): void {
    this.onFileRemovedCbs.push(cb);
  }

  /** Registers a callback invoked when the meaningful change threshold is reached. */
  addOnThresholdReached(cb: () => void): void {
    this.onThresholdReachedCbs.push(cb);
  }

  /** @deprecated Use addOnFileIndexed(cb) to register multiple subscribers. */
  setOnFileIndexed(cb: (relativePath: string, content: string) => void): void {
    this.onFileIndexedCbs.length = 0;
    this.onFileIndexedCbs.push(cb);
  }

  /** @deprecated Use addOnFileRemoved(cb) to register multiple subscribers. */
  setOnFileRemoved(cb: (relativePath: string) => void): void {
    this.onFileRemovedCbs.length = 0;
    this.onFileRemovedCbs.push(cb);
  }

  getChangeCount(): number {
    return this.meaningfulChangeCount;
  }

  resetChangeCount(): void {
    this.meaningfulChangeCount = 0;
  }

  /** Number of files currently in the offline queue. */
  get queueSize(): number {
    return this.queue.size;
  }

  // ── Single-file operations ─────────────────────────────────────

  async indexFile(relativePath: string): Promise<void> {
    const content = await this.fs.readNote(relativePath);

    const chunks = this.chunker.chunk(content);
    if (chunks.length === 0) {
      await this.store.delete(relativePath);
      return;
    }

    const vectorChunks: VectorChunk[] = [];
    for (const chunk of chunks) {
      const vector = await this.embedder.embed(chunk.text);
      vectorChunks.push({
        chunkId: chunk.headingPath.join(" > ") || "root",
        vector,
        text: chunk.text,
        headingPath: chunk.headingPath,
      });
    }

    await this.store.upsert({ docPath: relativePath, chunks: vectorChunks });

    this.notifyFileIndexed(relativePath, content);
    this.recordMeaningfulChange(relativePath);
  }

  async removeFile(relativePath: string): Promise<void> {
    await this.store.delete(relativePath);
    this.notifyFileRemoved(relativePath);
    this.recordMeaningfulChange(relativePath);
  }

  // ── Bulk indexing ──────────────────────────────────────────────

  async indexAll(): Promise<void> {
    const files = await this.fs.listNotes();
    for (const file of files) {
      try {
        await this.indexFile(file);
      } catch {
        // Skip files that fail to index and continue with the rest.
      }
    }
  }

  // ── Offline queue ──────────────────────────────────────────────

  enqueue(relativePath: string): void {
    this.queue.add(relativePath);
  }

  async processQueue(): Promise<void> {
    const paths = [...this.queue];
    this.queue.clear();

    for (const relPath of paths) {
      try {
        if (!(await this.fs.exists(relPath))) {
          throw new Error("File not found");
        }
        await this.indexFile(relPath);
      } catch {
        // File was deleted between enqueue and process
        await this.removeFile(relPath);
      }
    }
  }

  private async drain(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;
    try {
      while (this.queue.size > 0) {
        const paths = [...this.queue];
        this.queue.clear();
        for (const relPath of paths) {
          try {
            if (!(await this.fs.exists(relPath))) {
              throw new Error("File not found");
            }
            await this.indexFile(relPath);
          } catch {
            this.failureCount++;
            this.lastFailureTime = new Date();
            this.lastFailureSource = relPath;
            await this.removeFile(relPath);
          }
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  // ── File watching ──────────────────────────────────────────────

  async startWatching(options?: WatcherOptions): Promise<void> {
    const debounceMs = options?.debounceMs ?? 500;

    this.watcherAdapter.watch(this.vaultRoot, {
      persistent: true,
    });
    this.watcherActive = true;

    const handleChange = (absPath: string): void => {
      const relPath = path.relative(this.vaultRoot, absPath);
      if (!relPath.endsWith(".md")) return;

      // Clear existing debounce timer for this path
      const existing = this.debounceTimers.get(relPath);
      if (existing) clearTimeout(existing);

      const timer = setTimeout(() => {
        this.debounceTimers.delete(relPath);
        this.enqueue(relPath);
        void this.drain();
      }, debounceMs);

      this.debounceTimers.set(relPath, timer);
    };

    this.watcherAdapter.on("add", handleChange);
    this.watcherAdapter.on("change", handleChange);
    this.watcherAdapter.on("unlink", (absPath: string) => {
      const relPath = path.relative(this.vaultRoot, absPath);
      if (!relPath.endsWith(".md")) return;
      this.enqueue(relPath);
      void this.drain();
    });
  }

  async stop(): Promise<void> {
    // Clear all debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    if (this.watcherActive) {
      await this.watcherAdapter.close();
      this.watcherActive = false;
    }
  }

  async getHealthStatus(): Promise<IndexingHealthStatus> {
    const indexingState: IndexingHealthStatus["indexingState"] = this.isProcessing
      ? "indexing"
      : this.watcherActive
        ? "watching"
        : this.failureCount > 0
          ? "error"
          : "idle";

    const lastFailure =
      this.lastFailureTime !== null && this.lastFailureSource !== null
        ? { time: this.lastFailureTime.toISOString(), source: this.lastFailureSource }
        : null;

    return {
      indexingState,
      watcherState: this.watcherActive ? "active" : "stopped",
      queueDepth: this.queue.size,
      failureCount: this.failureCount,
      lastFailure,
      indexedDocuments: await this.store.size(),
    };
  }

  private notifyFileIndexed(relativePath: string, content: string): void {
    for (const callback of this.onFileIndexedCbs) {
      callback(relativePath, content);
    }
  }

  private notifyFileRemoved(relativePath: string): void {
    for (const callback of this.onFileRemovedCbs) {
      callback(relativePath);
    }
  }

  private recordMeaningfulChange(relativePath: string): void {
    if (relativePath.startsWith("meta/")) {
      return;
    }

    this.meaningfulChangeCount++;

    if (this.meaningfulChangeCount >= this.threshold) {
      for (const callback of this.onThresholdReachedCbs) {
        callback();
      }
      this.resetChangeCount();
    }
  }
}
