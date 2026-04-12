import fs from "node:fs/promises";
import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import type {
  IEmbeddingProvider,
  IVectorStore,
  VectorChunk,
} from "../domain/interfaces/index.js";
import { MarkdownChunker } from "./chunker.js";
import { MarkdownPipeline } from "./markdown-pipeline.js";

export interface WatcherOptions {
  /** Milliseconds to debounce file-change events. Default: 500. */
  debounceMs?: number;
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
  private readonly chunker: MarkdownChunker;
  private watcher: FSWatcher | null = null;

  /** Set of vault-relative paths pending indexing. */
  private readonly queue = new Set<string>();
  /** Debounce timers keyed by relative path. */
  private readonly debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    vaultRoot: string,
    store: IVectorStore,
    embedder: IEmbeddingProvider,
  ) {
    this.vaultRoot = path.resolve(vaultRoot);
    this.store = store;
    this.embedder = embedder;
    this.chunker = new MarkdownChunker(new MarkdownPipeline());
  }

  /** Number of files currently in the offline queue. */
  get queueSize(): number {
    return this.queue.size;
  }

  // ── Single-file operations ─────────────────────────────────────

  async indexFile(relativePath: string): Promise<void> {
    const absPath = path.join(this.vaultRoot, relativePath);
    const content = await fs.readFile(absPath, "utf-8");

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
  }

  async removeFile(relativePath: string): Promise<void> {
    await this.store.delete(relativePath);
  }

  // ── Bulk indexing ──────────────────────────────────────────────

  async indexAll(): Promise<void> {
    const files = await this.listMdFiles(this.vaultRoot);
    for (const file of files) {
      await this.indexFile(file);
    }
  }

  private async listMdFiles(dir: string): Promise<string[]> {
    const entries = await fs.readdir(dir, {
      recursive: true,
      withFileTypes: true,
    });
    const mdFiles: string[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const entryDir =
        entry.parentPath ??
        (entry as unknown as { path: string }).path;
      const fullPath = path.join(entryDir, entry.name);
      mdFiles.push(path.relative(this.vaultRoot, fullPath));
    }
    return mdFiles.sort();
  }

  // ── Offline queue ──────────────────────────────────────────────

  enqueue(relativePath: string): void {
    this.queue.add(relativePath);
  }

  async processQueue(): Promise<void> {
    const paths = [...this.queue];
    this.queue.clear();

    for (const relPath of paths) {
      const absPath = path.join(this.vaultRoot, relPath);
      try {
        await fs.access(absPath);
        await this.indexFile(relPath);
      } catch {
        // File was deleted between enqueue and process
        await this.removeFile(relPath);
      }
    }
  }

  // ── File watching ──────────────────────────────────────────────

  async startWatching(options?: WatcherOptions): Promise<void> {
    const debounceMs = options?.debounceMs ?? 500;

    this.watcher = chokidar.watch(this.vaultRoot, {
      ignored: (filePath: string) => {
        // Ignore non-.md files (but allow directories)
        const ext = path.extname(filePath);
        return ext !== "" && ext !== ".md";
      },
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 100 },
    });

    const handleChange = (absPath: string): void => {
      const relPath = path.relative(this.vaultRoot, absPath);
      if (!relPath.endsWith(".md")) return;

      // Clear existing debounce timer for this path
      const existing = this.debounceTimers.get(relPath);
      if (existing) clearTimeout(existing);

      const timer = setTimeout(() => {
        this.debounceTimers.delete(relPath);
        this.enqueue(relPath);
      }, debounceMs);

      this.debounceTimers.set(relPath, timer);
    };

    this.watcher.on("add", handleChange);
    this.watcher.on("change", handleChange);
    this.watcher.on("unlink", (absPath: string) => {
      const relPath = path.relative(this.vaultRoot, absPath);
      if (!relPath.endsWith(".md")) return;
      this.enqueue(relPath);
    });
  }

  async stop(): Promise<void> {
    // Clear all debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }
}
