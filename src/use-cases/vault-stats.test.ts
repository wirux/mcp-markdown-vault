import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalFileSystemAdapter } from "../infrastructure/local-fs-adapter.js";
import type { IEmbeddingProvider } from "../domain/interfaces/embedding-provider.js";
import type { VaultIndexer, IndexingHealthStatus } from "./vault-indexer.js";
import { VaultStatsComposer } from "./vault-stats.js";

const tmpDirs: string[] = [];

afterEach(async () => {
  for (const dir of tmpDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function makeTempVault() {
  const tmpPath = await mkdtemp(join(tmpdir(), "vault-stats-test-"));
  const vaultPath = await realpath(tmpPath);
  tmpDirs.push(vaultPath);
  const adapter = await LocalFileSystemAdapter.create(vaultPath);
  return { adapter };
}

function fakeEmbedder(modelName = "test-model"): IEmbeddingProvider {
  return {
    modelName,
    embed: async () => [0, 0, 0],
    embedBatch: async (texts) => texts.map(() => [0, 0, 0]),
    dimensions: 3,
  };
}

function fakeIndexer(state: IndexingHealthStatus["indexingState"]): VaultIndexer {
  return {
    getHealthStatus: async () => ({
      indexingState: state,
      watcherState: "stopped",
      queueDepth: 0,
      failureCount: 0,
      lastFailure: null,
      indexedDocuments: 5,
    }),
  } as unknown as VaultIndexer;
}

describe("VaultStatsComposer", () => {
  it("returns fileCount 0 for empty vault", async () => {
    const { adapter } = await makeTempVault();
    const composer = new VaultStatsComposer({ fsAdapter: adapter, embedder: fakeEmbedder() });
    const stats = await composer.computeStats();
    expect(stats.fileCount).toBe(0);
    expect(stats.topDirectories).toEqual([]);
  });

  it("counts files in root (no directory)", async () => {
    const { adapter } = await makeTempVault();
    await adapter.writeNote("note1.md", "# Note 1");
    await adapter.writeNote("note2.md", "# Note 2");
    const composer = new VaultStatsComposer({ fsAdapter: adapter, embedder: fakeEmbedder() });
    const stats = await composer.computeStats();
    expect(stats.fileCount).toBe(2);
    expect(stats.topDirectories).toEqual([]);
  });

  it("groups files by top-level directory", async () => {
    const { adapter } = await makeTempVault();
    await adapter.writeNote("notes/a.md", "a");
    await adapter.writeNote("notes/b.md", "b");
    await adapter.writeNote("projects/c.md", "c");
    const composer = new VaultStatsComposer({ fsAdapter: adapter, embedder: fakeEmbedder() });
    const stats = await composer.computeStats();
    expect(stats.fileCount).toBe(3);
    const notesDir = stats.topDirectories.find((d) => d.name === "notes");
    const projectsDir = stats.topDirectories.find((d) => d.name === "projects");
    expect(notesDir?.fileCount).toBe(2);
    expect(projectsDir?.fileCount).toBe(1);
  });

  it("excludes meta/ directory from fileCount and topDirectories", async () => {
    const { adapter } = await makeTempVault();
    await adapter.writeNote("notes/a.md", "a");
    await adapter.writeNote("meta/contract.md", "contract");
    const composer = new VaultStatsComposer({ fsAdapter: adapter, embedder: fakeEmbedder() });
    const stats = await composer.computeStats();
    expect(stats.fileCount).toBe(1);
    expect(stats.topDirectories.find((d) => d.name === "meta")).toBeUndefined();
  });

  it("limits topDirectories to max 10 entries sorted by count descending", async () => {
    const { adapter } = await makeTempVault();
    for (let i = 0; i < 12; i++) {
      await adapter.writeNote(`dir${i}/file.md`, "x");
    }
    await adapter.writeNote("dir0/extra.md", "x");
    const composer = new VaultStatsComposer({ fsAdapter: adapter, embedder: fakeEmbedder() });
    const stats = await composer.computeStats();
    expect(stats.topDirectories.length).toBeLessThanOrEqual(10);
    expect(stats.topDirectories[0]?.name).toBe("dir0");
    expect(stats.topDirectories[0]?.fileCount).toBe(2);
  });

  it("returns indexStatus 'not started' when no indexer provided", async () => {
    const { adapter } = await makeTempVault();
    const composer = new VaultStatsComposer({ fsAdapter: adapter, embedder: fakeEmbedder() });
    const stats = await composer.computeStats();
    expect(stats.indexStatus).toBe("not started");
  });

  it("returns indexStatus 'ready' when indexer is idle", async () => {
    const { adapter } = await makeTempVault();
    const composer = new VaultStatsComposer({
      fsAdapter: adapter,
      indexer: fakeIndexer("idle"),
      embedder: fakeEmbedder(),
    });
    const stats = await composer.computeStats();
    expect(stats.indexStatus).toBe("ready");
  });

  it("returns indexStatus 'building' when indexer is indexing", async () => {
    const { adapter } = await makeTempVault();
    const composer = new VaultStatsComposer({
      fsAdapter: adapter,
      indexer: fakeIndexer("indexing"),
      embedder: fakeEmbedder(),
    });
    const stats = await composer.computeStats();
    expect(stats.indexStatus).toBe("building");
  });

  it("reflects embedder modelName in embeddingProvider field", async () => {
    const { adapter } = await makeTempVault();
    const composer = new VaultStatsComposer({
      fsAdapter: adapter,
      embedder: fakeEmbedder("ollama/nomic-embed-text"),
    });
    const stats = await composer.computeStats();
    expect(stats.embeddingProvider).toBe("ollama/nomic-embed-text");
  });
});
