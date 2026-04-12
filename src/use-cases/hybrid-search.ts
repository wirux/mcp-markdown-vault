import type {
  IEmbeddingProvider,
  IVectorStore,
} from "../domain/interfaces/index.js";
import { TfIdfScorer } from "./scoring.js";
import type { Chunk } from "./chunker.js";

export interface HybridSearchResult {
  docPath: string;
  chunkId: string;
  text: string;
  headingPath: string[];
  /** Combined score (vector + lexical). */
  score: number;
  /** Individual vector similarity score [0, 1]. */
  vectorScore: number;
  /** Individual lexical score [0, 1]. */
  lexicalScore: number;
}

export interface HybridSearchOptions {
  /** Max results to return. Default: 10. */
  k?: number;
  /** Weight for vector similarity vs lexical (0 = lexical only, 1 = vector only). Default: 0.6. */
  vectorWeight?: number;
}

const DEFAULTS: Required<HybridSearchOptions> = {
  k: 10,
  vectorWeight: 0.6,
};

/**
 * Hybrid search combining vector similarity with lexical TF-IDF scoring.
 *
 * 1. Embed the query and search the vector store for top-k candidates
 * 2. Score those candidates lexically with TF-IDF
 * 3. Combine both signals with a weighted sum
 */
export class HybridSearcher {
  constructor(
    private readonly store: IVectorStore,
    private readonly embedder: IEmbeddingProvider,
  ) {}

  async search(
    query: string,
    options?: HybridSearchOptions,
  ): Promise<HybridSearchResult[]> {
    const opts = { ...DEFAULTS, ...options };

    // 1. Vector search — retrieve broader candidate set
    const candidateK = Math.max(opts.k * 3, 20);
    const queryVector = await this.embedder.embed(query);
    const vectorResults = await this.store.search(queryVector, candidateK);

    if (vectorResults.length === 0) return [];

    // 2. Build chunks from vector results for TF-IDF scoring
    const chunks: Chunk[] = vectorResults.map((r) => ({
      headingPath: r.headingPath,
      text: r.text,
      startLine: 0,
      endLine: 0,
      wordCount: r.text.split(/\s+/).length,
    }));

    const tfidfScorer = new TfIdfScorer(chunks);
    const lexicalScores = tfidfScorer.score(query);

    // 3. Normalise both score sets to [0, 1]
    const normVector = normalise(vectorResults.map((r) => r.similarity));
    const normLexical = normalise(lexicalScores.map((s) => s.score));

    // 4. Combine with weighted sum
    const combined: HybridSearchResult[] = vectorResults.map((r, i) => {
      const vs = normVector[i]!;
      const ls = normLexical[i]!;
      return {
        docPath: r.docPath,
        chunkId: r.chunkId,
        text: r.text,
        headingPath: r.headingPath,
        score: opts.vectorWeight * vs + (1 - opts.vectorWeight) * ls,
        vectorScore: vs,
        lexicalScore: ls,
      };
    });

    // 5. Sort and limit
    combined.sort((a, b) => b.score - a.score);
    return combined.slice(0, opts.k);
  }
}

function normalise(values: number[]): number[] {
  const max = Math.max(...values);
  if (max === 0) return values.map(() => 0);
  return values.map((v) => v / max);
}
