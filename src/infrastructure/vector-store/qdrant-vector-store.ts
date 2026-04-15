import { QdrantClient } from "@qdrant/js-client-rest";
import crypto from "node:crypto";
import {
  IVectorStore,
  VectorEntry,
  VectorSearchResult,
  VectorChunk,
} from "../../domain/interfaces/index.js";
import { DomainError } from "../../domain/errors/index.js";

export class QdrantVectorStoreError extends DomainError {
  constructor(message: string, cause?: Error) {
    super("QDRANT_STORE_ERROR", message, cause);
    this.name = "QdrantVectorStoreError";
  }
}

export class QdrantVectorStore implements IVectorStore {
  private client: QdrantClient;
  private readonly collectionName = "markdown_vault";
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  constructor(
    qdrantUrl: string,
    private readonly dimensions: number
  ) {
    this.client = new QdrantClient({ url: qdrantUrl });
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        const result = await this.client.getCollections();
        const exists = result.collections.some((c: any) => c.name === this.collectionName);

        if (exists) {
          const info = await this.client.getCollection(this.collectionName);
          const configParams = info.config.params;
          const vectorSize = configParams?.vectors?.size;

          if (vectorSize !== undefined && vectorSize !== this.dimensions) {
            throw new QdrantVectorStoreError(
              `Collection exists but has wrong vector size. Expected ${this.dimensions}, found ${vectorSize}.`
            );
          }
        } else {
          await this.client.createCollection(this.collectionName, {
            vectors: {
              size: this.dimensions,
              distance: "Cosine",
            },
            on_disk_payload: true,
          });
        }
        this.initialized = true;
      } catch (error: any) {
        if (error instanceof QdrantVectorStoreError) {
          throw error;
        }
        throw new QdrantVectorStoreError("Failed to initialize Qdrant collection", error);
      }
    })();

    return this.initPromise;
  }

  private generatePointId(docPath: string, chunkIndex: number): string {
    const hash = crypto.createHash("sha256");
    hash.update(`${docPath}::${chunkIndex}`);
    // Qdrant allows UUIDs, but we'll use a string UUID derived from hex
    const hex = hash.digest("hex");
    // Format to UUID to avoid any issue
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  }

  async upsert(entry: VectorEntry): Promise<void> {
    await this.initialize();
    try {
      const points = entry.chunks.map((chunk: VectorChunk, i: number) => ({
        id: this.generatePointId(entry.docPath, i),
        vector: chunk.vector,
        payload: {
          docPath: entry.docPath,
          chunkId: chunk.chunkId,
          text: chunk.text,
          headingPath: chunk.headingPath,
        },
      }));

      // In upsert semantics, replace existing. Qdrant handles duplicate ids by updating.
      // But if there are *fewer* chunks now, we'd leave dangling chunks.
      // Easiest is to delete existing for docPath and insert.
      await this.delete(entry.docPath);

      if (points.length > 0) {
        await this.client.upsert(this.collectionName, { wait: true, points });
      }
    } catch (error: any) {
      throw new QdrantVectorStoreError("Failed to upsert points into Qdrant", error);
    }
  }

  async search(queryVector: number[], k: number): Promise<VectorSearchResult[]> {
    await this.initialize();
    try {
      const results = await this.client.search(this.collectionName, {
        vector: queryVector,
        limit: k,
        with_payload: true,
      });

      return results.map((res: any) => ({
        docPath: res.payload.docPath as string,
        chunkId: res.payload.chunkId as string,
        text: res.payload.text as string,
        headingPath: res.payload.headingPath as string[],
        similarity: res.score,
      }));
    } catch (error: any) {
      throw new QdrantVectorStoreError("Failed to search Qdrant", error);
    }
  }

  async delete(docPath: string): Promise<void> {
    await this.initialize();
    try {
      await this.client.delete(this.collectionName, {
        wait: true,
        filter: {
          must: [
            {
              key: "docPath",
              match: {
                value: docPath,
              },
            },
          ],
        },
      });
    } catch (error: any) {
      throw new QdrantVectorStoreError(`Failed to delete chunks for ${docPath} from Qdrant`, error);
    }
  }

  async has(docPath: string): Promise<boolean> {
    await this.initialize();
    try {
      const result = await this.client.scroll(this.collectionName, {
        filter: {
          must: [
            {
              key: "docPath",
              match: { value: docPath },
            },
          ],
        },
        limit: 1,
      });
      return result.points.length > 0;
    } catch (error: any) {
      throw new QdrantVectorStoreError("Failed to check existence in Qdrant", error);
    }
  }

  async size(): Promise<number> {
    await this.initialize();
    try {
      const info = await this.client.getCollection(this.collectionName);
      return info.points_count || 0;
    } catch (error: any) {
      throw new QdrantVectorStoreError("Failed to get collection size from Qdrant", error);
    }
  }

  // To satisfy interface expectation for index.ts saving (though it handles persistence itself)
  async save(): Promise<void> {
    // Qdrant persists automatically
  }
}
