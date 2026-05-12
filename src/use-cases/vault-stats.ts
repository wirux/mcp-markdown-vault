import type { IFileSystemAdapter } from "../domain/interfaces/file-system-adapter.js";
import type { IEmbeddingProvider } from "../domain/interfaces/embedding-provider.js";
import type { VaultIndexer } from "./vault-indexer.js";

export interface VaultStats {
  fileCount: number;
  topDirectories: Array<{ name: string; fileCount: number }>;
  indexStatus: "ready" | "building" | "not started";
  embeddingProvider: string;
}

export class VaultStatsComposer {
  private readonly fsAdapter: IFileSystemAdapter;
  private readonly indexer: VaultIndexer | undefined;
  private readonly embedder: IEmbeddingProvider;

  constructor(deps: {
    fsAdapter: IFileSystemAdapter;
    indexer?: VaultIndexer;
    embedder: IEmbeddingProvider;
  }) {
    this.fsAdapter = deps.fsAdapter;
    this.indexer = deps.indexer;
    this.embedder = deps.embedder;
  }

  async computeStats(): Promise<VaultStats> {
    const allNotes = await this.fsAdapter.listNotes();
    const nonMetaNotes = allNotes.filter((p) => !p.startsWith("meta/"));

    const dirCounts = new Map<string, number>();
    for (const notePath of nonMetaNotes) {
      const slashIdx = notePath.indexOf("/");
      if (slashIdx > 0) {
        const dir = notePath.slice(0, slashIdx);
        dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
      }
    }

    const topDirectories = [...dirCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, fileCount]) => ({ name, fileCount }));

    let indexStatus: VaultStats["indexStatus"] = "not started";
    if (this.indexer) {
      const health = await this.indexer.getHealthStatus();
      if (health.indexingState === "indexing") {
        indexStatus = "building";
      } else {
        indexStatus = "ready";
      }
    }

    return {
      fileCount: nonMetaNotes.length,
      topDirectories,
      indexStatus,
      embeddingProvider: this.embedder.modelName,
    };
  }
}
