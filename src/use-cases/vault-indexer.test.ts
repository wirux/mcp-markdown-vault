import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { VaultIndexer } from "./vault-indexer.js";
import { InMemoryVectorStore } from "../infrastructure/in-memory-vector-store.js";
import type { IEmbeddingProvider } from "../domain/interfaces/index.js";

// ── Fake embedding provider ───────────────────────────────────────

class FakeEmbeddingProvider implements IEmbeddingProvider {
  readonly dimensions = 3;
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
let indexer: VaultIndexer;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "indexer-test-"));
  store = new InMemoryVectorStore();
  embedder = new FakeEmbeddingProvider();
  indexer = new VaultIndexer(tmpDir, store, embedder);
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
    });

    it("detects new files and queues them for indexing", async () => {
      await indexer.startWatching({ debounceMs: 50 });

      // Small delay to let chokidar initialise
      await sleep(200);

      // Create a file after watcher starts
      await fs.writeFile(
        path.join(tmpDir, "watched.md"),
        "# Watched\n\nContent.\n",
      );

      // Wait for chokidar detection + awaitWriteFinish + debounce
      await sleep(500);
      await indexer.processQueue();

      expect(await store.has("watched.md")).toBe(true);
    });

    it("ignores non-.md files", async () => {
      await indexer.startWatching({ debounceMs: 50 });

      await sleep(200);

      await fs.writeFile(
        path.join(tmpDir, "ignored.txt"),
        "not markdown",
      );

      await sleep(150);
      await indexer.processQueue();

      expect(await store.size()).toBe(0);
    });
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
