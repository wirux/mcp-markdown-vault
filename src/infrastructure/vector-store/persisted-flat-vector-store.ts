import fs from "node:fs/promises";
import path from "node:path";
import {
  IVectorStore,
  VectorEntry,
  VectorSearchResult,
  VectorChunk,
} from "../../domain/interfaces/index.js";

const CURRENT_INDEX_VERSION = 1;

interface StoredChunkMetadata {
  docPath: string;
  chunkId: string;
  text: string;
  headingPath: string[];
  chunkIndex: number;
}

interface IndexData {
  version: number;
  embeddingModel: string;
  dimensions: number;
  savedAt: string;
  chunks: StoredChunkMetadata[];
}

export class PersistedFlatVectorStore implements IVectorStore {
  private readonly docs = new Map<string, Array<StoredChunkMetadata & { vector: Float32Array }>>();
  private readonly storeDir: string;
  private readonly indexFile: string;
  private readonly vectorsFile: string;
  private saving = false;

  constructor(
    vaultPath: string,
    private readonly embeddingModel: string,
    private readonly dimensions: number
  ) {
    this.storeDir = path.join(vaultPath, ".markdown_vault_mcp");
    this.indexFile = path.join(this.storeDir, "index.json");
    this.vectorsFile = path.join(this.storeDir, "vectors.bin");
  }

  async load(): Promise<void> {
    try {
      const indexStr = await fs.readFile(this.indexFile, "utf-8");
      const meta = JSON.parse(indexStr) as IndexData;

      const isFingerprintValid =
        meta.embeddingModel === this.embeddingModel &&
        meta.dimensions === this.dimensions &&
        meta.version === CURRENT_INDEX_VERSION;

      if (!isFingerprintValid) {
        console.error("[PersistedFlatVectorStore] Index fingerprint mismatch — starting fresh");
        return;
      }

      const vectorsBuffer = await fs.readFile(this.vectorsFile);

      const expectedBytes = meta.chunks.length * this.dimensions * 4;
      if (vectorsBuffer.byteLength < expectedBytes) {
        console.warn(
          `[PersistedFlatVectorStore] vectors.bin too small (${vectorsBuffer.byteLength} < ${expectedBytes}), starting fresh`
        );
        return;
      }

      this.docs.clear();
      for (const chunk of meta.chunks) {
        const offset = chunk.chunkIndex * this.dimensions * 4;
        // Copy bytes out of Node's Buffer pool into a standalone ArrayBuffer
        const vector = new Float32Array(this.dimensions);
        for (let i = 0; i < this.dimensions; i++) {
          vector[i] = vectorsBuffer.readFloatLE(offset + i * 4);
        }

        let fileChunks = this.docs.get(chunk.docPath);
        if (!fileChunks) {
          fileChunks = [];
          this.docs.set(chunk.docPath, fileChunks);
        }

        fileChunks.push({
          ...chunk,
          vector,
        });
      }
      console.log(`[PersistedFlatVectorStore] Loaded ${meta.chunks.length} chunks from disk`);
    } catch (err: any) {
      if (err.code !== "ENOENT") {
        console.warn(`[PersistedFlatVectorStore] Failed to load index, starting fresh: ${err.message}`);
      }
      this.docs.clear();
    }
  }

  async save(): Promise<void> {
    if (this.saving) return;
    this.saving = true;
    try {
      await fs.mkdir(this.storeDir, { recursive: true });

      const chunks: StoredChunkMetadata[] = [];
      let totalChunks = 0;
      for (const fileChunks of this.docs.values()) {
        totalChunks += fileChunks.length;
      }

      const buffer = Buffer.allocUnsafe(totalChunks * this.dimensions * 4);
      let chunkIndex = 0;

      for (const fileChunks of this.docs.values()) {
        for (const chunk of fileChunks) {
          chunks.push({
            docPath: chunk.docPath,
            chunkId: chunk.chunkId,
            text: chunk.text,
            headingPath: chunk.headingPath,
            chunkIndex,
          });
          new Float32Array(buffer.buffer, buffer.byteOffset + chunkIndex * this.dimensions * 4, this.dimensions).set(chunk.vector);
          chunkIndex++;
        }
      }

      const meta: IndexData = {
        version: CURRENT_INDEX_VERSION,
        embeddingModel: this.embeddingModel,
        dimensions: this.dimensions,
        savedAt: new Date().toISOString(),
        chunks,
      };

      const vectorsTmp = this.vectorsFile + ".tmp";
      const indexTmp = this.indexFile + ".tmp";

      await fs.writeFile(vectorsTmp, buffer);
      await fs.writeFile(indexTmp, JSON.stringify(meta));

      await fs.rename(vectorsTmp, this.vectorsFile);
      await fs.rename(indexTmp, this.indexFile);
    } catch (err) {
      console.error(`[PersistedFlatVectorStore] Failed to save index:`, err);
    } finally {
      this.saving = false;
    }
  }

  async upsert(entry: VectorEntry): Promise<void> {
    const stored = entry.chunks.map((c: VectorChunk) => {
      // Pad or truncate to ensure correct dimensions if needed, though provider should handle it
      let vecArr = c.vector;
      if (vecArr.length !== this.dimensions) {
         console.warn(`[PersistedFlatVectorStore] Vector dimension mismatch for chunk ${c.chunkId}. Expected ${this.dimensions}, got ${vecArr.length}.`);
         // We'll just copy up to dimensions or pad with 0s
         const padded = new Array(this.dimensions).fill(0);
         for (let i = 0; i < Math.min(vecArr.length, this.dimensions); i++) {
            padded[i] = vecArr[i]!;
         }
         vecArr = padded;
      }
      return {
        docPath: entry.docPath,
        chunkId: c.chunkId,
        vector: new Float32Array(vecArr),
        text: c.text,
        headingPath: c.headingPath,
        chunkIndex: -1, // Not used in-memory, populated on save
      };
    });
    this.docs.set(entry.docPath, stored);
  }

  async search(queryVector: number[], k: number): Promise<VectorSearchResult[]> {
    const allChunks = [];
    for (const chunks of this.docs.values()) {
      for (const chunk of chunks) {
        allChunks.push(chunk);
      }
    }

    if (allChunks.length === 0) return [];

    let qVec = queryVector;
    if (qVec.length !== this.dimensions) {
      const padded = new Array(this.dimensions).fill(0);
      for (let i = 0; i < Math.min(qVec.length, this.dimensions); i++) {
        padded[i] = qVec[i]!;
      }
      qVec = padded;
    }
    const qFloatVec = new Float32Array(qVec);

    const scored = allChunks.map((chunk) => ({
      docPath: chunk.docPath,
      chunkId: chunk.chunkId,
      text: chunk.text,
      headingPath: chunk.headingPath,
      similarity: cosineSimilarityFloat32(qFloatVec, chunk.vector),
    }));

    scored.sort((a, b) => b.similarity - a.similarity);

    return scored.slice(0, k);
  }

  async delete(docPath: string): Promise<void> {
    this.docs.delete(docPath);
  }

  async has(docPath: string): Promise<boolean> {
    return this.docs.has(docPath);
  }

  async size(): Promise<number> {
    let s = 0;
    for (const chunks of this.docs.values()) {
      s += chunks.length;
    }
    return s;
  }
}

function cosineSimilarityFloat32(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dot += ai * bi;
    magA += ai * ai;
    magB += bi * bi;
  }

  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}
