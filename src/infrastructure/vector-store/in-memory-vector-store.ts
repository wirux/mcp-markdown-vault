import type {
  IVectorStore,
  VectorEntry,
  VectorChunk,
  VectorSearchResult,
} from "../../domain/interfaces/index.js";

interface StoredChunk {
  docPath: string;
  chunkId: string;
  vector: number[];
  text: string;
  headingPath: string[];
}

/**
 * In-memory IVectorStore using brute-force cosine similarity.
 *
 * Suitable for small-to-medium vaults and testing.
 * All data lives in memory — no persistence.
 */
export class InMemoryVectorStore implements IVectorStore {
  /** docPath → chunks */
  private readonly docs = new Map<string, StoredChunk[]>();

  async upsert(entry: VectorEntry): Promise<void> {
    const stored: StoredChunk[] = entry.chunks.map((c: VectorChunk) => ({
      docPath: entry.docPath,
      chunkId: c.chunkId,
      vector: c.vector,
      text: c.text,
      headingPath: c.headingPath,
    }));
    this.docs.set(entry.docPath, stored);
  }

  async search(queryVector: number[], k: number): Promise<VectorSearchResult[]> {
    const allChunks: StoredChunk[] = [];
    for (const chunks of this.docs.values()) {
      allChunks.push(...chunks);
    }

    if (allChunks.length === 0) return [];

    const scored = allChunks.map((chunk) => ({
      ...chunk,
      similarity: cosineSimilarity(queryVector, chunk.vector),
    }));

    scored.sort((a, b) => b.similarity - a.similarity);

    return scored.slice(0, k).map((s) => ({
      docPath: s.docPath,
      chunkId: s.chunkId,
      text: s.text,
      headingPath: s.headingPath,
      similarity: s.similarity,
    }));
  }

  async delete(docPath: string): Promise<void> {
    this.docs.delete(docPath);
  }

  async has(docPath: string): Promise<boolean> {
    return this.docs.has(docPath);
  }

  async size(): Promise<number> {
    return this.docs.size;
  }

  async save(): Promise<void> {
    // In-memory store has no persistence
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
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
