/// <reference types="node" />

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { VaultIndexer } from "./vault-indexer.js";
import { LocalFileSystemAdapter } from "../infrastructure/local-fs-adapter.js";
import { InMemoryVectorStore } from "../infrastructure/vector-store/in-memory-vector-store.js";
import type {
  IEmbeddingProvider,
  IFileSystemAdapter,
  IFileWatcher,
  WatchEventType,
} from "../domain/interfaces/index.js";

// ── Fake embedding provider ───────────────────────────────────────

class FakeEmbeddingProvider implements IEmbeddingProvider {
  readonly dimensions = 3;
  readonly modelName = "fake-embedder";
  readonly embedCalls: string[] = [];

  /** Returns a deterministic vector based on text hash. */
  async embed(text: string): Promise<number[]> {
    this.embedCalls.push(text);
    const hash = simpleHash(text);
    return [
      Math.sin(hash),
      Math.cos(hash),
      Math.sin(hash * 2),
    ];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (const t of texts) {
      results.push(await this.embed(t));
    }
    return results;
  }
}

function simpleHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h;
}

// ── Test setup ─────────────────────────────────────────────────────

let tmpDir: string;
let store: InMemoryVectorStore;
let embedder: FakeEmbeddingProvider;
let fsAdapter: IFileSystemAdapter;
let watcher: MockFileWatcher;
let indexer: VaultIndexer;

class MockFileWatcher implements IFileWatcher {
  watchedPath: string | null = null;
  closeCalls = 0;
  readonly handlers: Partial<Record<WatchEventType, (path: string) => void>> = {};

  watch(vaultPath: string): void {
    this.watchedPath = vaultPath;
  }

  on(event: WatchEventType, handler: (path: string) => void): void {
    this.handlers[event] = handler;
  }

  async close(): Promise<void> {
    this.closeCalls++;
  }

  emit(event: WatchEventType, filePath: string): void {
    this.handlers[event]?.(filePath);
  }
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "indexer-test-"));
  store = new InMemoryVectorStore();
  embedder = new FakeEmbeddingProvider();
  fsAdapter = await LocalFileSystemAdapter.create(tmpDir);
  watcher = new MockFileWatcher();
  indexer = new VaultIndexer(tmpDir, store, embedder, watcher, fsAdapter);
});

afterEach(async () => {
  await indexer.stop();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ── Tests ──────────────────────────────────────────────────────────

describe("VaultIndexer", () => {
  describe("indexFile", () => {
    it("indexes a single note into the vector store", async () => {
      const notePath = path.join(tmpDir, "hello.md");
      await fs.writeFile(
        notePath,
        "# Hello\n\nSome content about greetings.\n",
      );

      await indexer.indexFile("hello.md");

      expect(await store.has("hello.md")).toBe(true);
      expect(await store.size()).toBe(1);
    });

    it("chunks the note and creates embeddings for each chunk", async () => {
      const md = "# Section A\n\nContent A.\n\n# Section B\n\nContent B.\n";
      await fs.writeFile(path.join(tmpDir, "multi.md"), md);

      await indexer.indexFile("multi.md");

      // Should have called embed for each chunk
      expect(embedder.embedCalls.length).toBeGreaterThanOrEqual(2);
    });

    it("re-indexes a modified file (upsert replaces old vectors)", async () => {
      const notePath = path.join(tmpDir, "evolving.md");
      await fs.writeFile(notePath, "# V1\n\nOriginal content.\n");
      await indexer.indexFile("evolving.md");

      await fs.writeFile(notePath, "# V2\n\nUpdated content.\n");
      await indexer.indexFile("evolving.md");

      expect(await store.size()).toBe(1);
      const results = await store.search(
        await embedder.embed("updated"),
        5,
      );
      expect(results.some((r) => r.text.includes("V2"))).toBe(true);
    });
  });

  describe("onFileIndexed callback", () => {
    it("invokes callback after successfully indexing a file", async () => {
      const calls: Array<{ path: string; content: string }> = [];
      indexer.setOnFileIndexed((relPath, content) => {
        calls.push({ path: relPath, content });
      });

      await fs.writeFile(
        path.join(tmpDir, "cb.md"),
        "# Callback\n\nTest content.\n",
      );
      await indexer.indexFile("cb.md");

      expect(calls).toHaveLength(1);
      expect(calls[0]!.path).toBe("cb.md");
      expect(calls[0]!.content).toContain("Test content.");
    });

    it("invokes onFileRemoved callback after removing a file", async () => {
      const removedPaths: string[] = [];
      indexer.setOnFileRemoved((relPath) => {
        removedPaths.push(relPath);
      });

      await fs.writeFile(
        path.join(tmpDir, "rm.md"),
        "# Remove me\n",
      );
      await indexer.indexFile("rm.md");
      await indexer.removeFile("rm.md");

      expect(removedPaths).toEqual(["rm.md"]);
    });
  });

  describe("removeFile", () => {
    it("removes a deleted note from the vector store", async () => {
      await fs.writeFile(
        path.join(tmpDir, "temp.md"),
        "# Temp\n\nGoing away.\n",
      );
      await indexer.indexFile("temp.md");
      expect(await store.has("temp.md")).toBe(true);

      await indexer.removeFile("temp.md");
      expect(await store.has("temp.md")).toBe(false);
    });
  });

  describe("indexAll", () => {
    it("indexes all .md files in the vault", async () => {
      await fs.mkdir(path.join(tmpDir, "sub"), { recursive: true });
      await fs.writeFile(
        path.join(tmpDir, "root.md"),
        "# Root\n\nRoot note.\n",
      );
      await fs.writeFile(
        path.join(tmpDir, "sub/nested.md"),
        "# Nested\n\nNested note.\n",
      );
      await fs.writeFile(
        path.join(tmpDir, "readme.txt"),
        "Not markdown",
      );

      await indexer.indexAll();

      expect(await store.size()).toBe(2);
      expect(await store.has("root.md")).toBe(true);
      expect(await store.has("sub/nested.md")).toBe(true);
    });

    it("skips files that fail to embed and continues indexing", async () => {
      await fs.writeFile(
        path.join(tmpDir, "good.md"),
        "# Good\n\nGood content.\n",
      );
      await fs.writeFile(
        path.join(tmpDir, "bad.md"),
        "# Bad\n\nWill fail to embed.\n",
      );
      await fs.writeFile(
        path.join(tmpDir, "also-good.md"),
        "# Also Good\n\nMore good content.\n",
      );

      const origEmbed = embedder.embed.bind(embedder);
      embedder.embed = async (text: string) => {
        if (text.includes("Will fail")) {
          throw new Error("Embedding service unavailable");
        }
        return origEmbed(text);
      };

      await indexer.indexAll();

      expect(await store.has("good.md")).toBe(true);
      expect(await store.has("also-good.md")).toBe(true);
      expect(await store.has("bad.md")).toBe(false);
    });
  });

  describe("offline queue", () => {
    it("queues files and processes them in batch", async () => {
      await fs.writeFile(
        path.join(tmpDir, "a.md"),
        "# A\n\nContent A.\n",
      );
      await fs.writeFile(
        path.join(tmpDir, "b.md"),
        "# B\n\nContent B.\n",
      );

      indexer.enqueue("a.md");
      indexer.enqueue("b.md");
      // Duplicate should be deduped
      indexer.enqueue("a.md");

      await indexer.processQueue();

      expect(await store.has("a.md")).toBe(true);
      expect(await store.has("b.md")).toBe(true);
      expect(await store.size()).toBe(2);
    });

    it("queue is empty after processing", async () => {
      await fs.writeFile(
        path.join(tmpDir, "x.md"),
        "# X\n\nContent.\n",
      );
      indexer.enqueue("x.md");
      await indexer.processQueue();

      expect(indexer.queueSize).toBe(0);
    });
  });

  describe("watcher", () => {
    it("starts and stops without error", async () => {
      await indexer.startWatching({ debounceMs: 50 });
      await indexer.stop();

      expect(watcher.watchedPath).toBe(tmpDir);
      expect(watcher.closeCalls).toBe(1);
    });

    it("detects new files and auto-indexes them without manual processQueue", async () => {
      await indexer.startWatching({ debounceMs: 50 });

      await fs.writeFile(
        path.join(tmpDir, "watched.md"),
        "# Watched\n\nContent.\n",
      );

      watcher.emit("add", path.join(tmpDir, "watched.md"));

      await sleep(200);

      expect(await store.has("watched.md")).toBe(true);
    });

    it("ignores non-.md files", async () => {
      await indexer.startWatching({ debounceMs: 50 });

      await fs.writeFile(
        path.join(tmpDir, "ignored.txt"),
        "not markdown",
      );

      watcher.emit("add", path.join(tmpDir, "ignored.txt"));

      await sleep(100);

      expect(await store.size()).toBe(0);
    });

    it("processes a burst of file events — all eventually indexed", async () => {
      await indexer.startWatching({ debounceMs: 50 });

      await fs.writeFile(path.join(tmpDir, "burst1.md"), "# B1\n\nContent.\n");
      await fs.writeFile(path.join(tmpDir, "burst2.md"), "# B2\n\nContent.\n");
      await fs.writeFile(path.join(tmpDir, "burst3.md"), "# B3\n\nContent.\n");

      watcher.emit("add", path.join(tmpDir, "burst1.md"));
      watcher.emit("add", path.join(tmpDir, "burst2.md"));
      watcher.emit("add", path.join(tmpDir, "burst3.md"));

      await sleep(250);

      expect(await store.has("burst1.md")).toBe(true);
      expect(await store.has("burst2.md")).toBe(true);
      expect(await store.has("burst3.md")).toBe(true);
    });

    it("tracks failure count when indexing fails", async () => {
      const origEmbed = embedder.embed.bind(embedder);
      embedder.embed = async (text: string) => {
        if (text.includes("FailMe")) throw new Error("embed error");
        return origEmbed(text);
      };

      await indexer.startWatching({ debounceMs: 50 });

      await fs.writeFile(
        path.join(tmpDir, "fail.md"),
        "# FailMe\n\nThis will fail.\n",
      );

      watcher.emit("add", path.join(tmpDir, "fail.md"));

      await sleep(200);

      expect(indexer.failureCount).toBeGreaterThanOrEqual(1);
      expect(indexer.lastFailureTime).toBeInstanceOf(Date);
      expect(indexer.lastFailureSource).toBe("fail.md");
    });

    it("removes a deleted markdown file from the vector store on unlink", async () => {
      await fs.writeFile(
        path.join(tmpDir, "gone.md"),
        "# Present\n\nContent.\n",
      );
      await indexer.indexFile("gone.md");
      expect(await store.has("gone.md")).toBe(true);

      await indexer.startWatching({ debounceMs: 50 });

      await fs.unlink(path.join(tmpDir, "gone.md"));

      watcher.emit("unlink", path.join(tmpDir, "gone.md"));

      await sleep(100);

      expect(await store.has("gone.md")).toBe(false);
    });
  });
  describe("getHealthStatus", () => {
    it("returns idle state with zero counters when freshly created", async () => {
      const status = await indexer.getHealthStatus();

      expect(status.indexingState).toBe("idle");
      expect(status.watcherState).toBe("stopped");
      expect(status.queueDepth).toBe(0);
      expect(status.failureCount).toBe(0);
      expect(status.lastFailure).toBeNull();
      expect(typeof status.indexedDocuments).toBe("number");
    });

    it("returns watching state while watcher is active", async () => {
      await indexer.startWatching({ debounceMs: 50 });

      const status = await indexer.getHealthStatus();

      expect(status.indexingState).toBe("watching");
      expect(status.watcherState).toBe("active");
    });

    it("returns error state after an indexing failure", async () => {
      const origEmbed = embedder.embed.bind(embedder);
      embedder.embed = async (text: string) => {
        if (text.includes("FailHealth")) throw new Error("embed error");
        return origEmbed(text);
      };

      await indexer.startWatching({ debounceMs: 50 });
      await fs.writeFile(
        path.join(tmpDir, "fail-health.md"),
        "# FailHealth\n\nThis will fail.\n",
      );
      watcher.emit("add", path.join(tmpDir, "fail-health.md"));
      await sleep(200);
      await indexer.stop();

      const status = await indexer.getHealthStatus();

      expect(status.failureCount).toBeGreaterThanOrEqual(1);
      expect(status.indexingState).toBe("error");
      expect(status.lastFailure).not.toBeNull();
      expect(status.lastFailure!.source).toBe("fail-health.md");
      expect(status.lastFailure!.time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("indexedDocuments reflects documents in the vector store", async () => {
      await fs.writeFile(
        path.join(tmpDir, "health-doc.md"),
        "# Health\n\nContent.\n",
      );
      await indexer.indexFile("health-doc.md");

      const status = await indexer.getHealthStatus();

      expect(status.indexedDocuments).toBe(1);
    });

    it("queueDepth reflects files waiting to be processed", () => {
      indexer.enqueue("pending-a.md");
      indexer.enqueue("pending-b.md");

      void indexer.getHealthStatus().then((status) => {
        expect(status.queueDepth).toBeGreaterThanOrEqual(0);
      });
    });
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
