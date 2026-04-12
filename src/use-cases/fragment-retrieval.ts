import { MarkdownChunker, type Chunk } from "./chunker.js";
import { TfIdfScorer, ProximityScorer, type ScoredChunk } from "./scoring.js";
import { MarkdownPipeline } from "./markdown-pipeline.js";

export interface RetrievedFragment {
  chunk: Chunk;
  score: number;
}

export interface RetrievalOptions {
  /** Maximum number of chunks to return. Default: 5. */
  maxChunks?: number;
  /** Minimum score threshold (0–1 normalised). Chunks below this are dropped. Default: 0.01. */
  minScore?: number;
  /** Weight for TF-IDF vs proximity (0 = proximity only, 1 = TF-IDF only). Default: 0.7. */
  tfidfWeight?: number;
}

const DEFAULTS: Required<RetrievalOptions> = {
  maxChunks: 5,
  minScore: 0.01,
  tfidfWeight: 0.7,
};

/**
 * Fragment Retrieval Engine.
 *
 * Combines chunking, TF-IDF keyword scoring, and word proximity scoring
 * to surface only the most relevant fragments from a long note.
 */
export class FragmentRetriever {
  private readonly chunker: MarkdownChunker;

  constructor(pipeline?: MarkdownPipeline) {
    this.chunker = new MarkdownChunker(pipeline);
  }

  retrieve(
    markdown: string,
    query: string,
    options?: RetrievalOptions,
  ): RetrievedFragment[] {
    const opts = { ...DEFAULTS, ...options };

    const chunks = this.chunker.chunk(markdown);
    if (chunks.length === 0) return [];

    // Score with TF-IDF
    const tfidfScorer = new TfIdfScorer(chunks);
    const tfidfScores = tfidfScorer.score(query);

    // Score with proximity
    const proximityScores = ProximityScorer.score(chunks, query);

    // Normalise each set of scores to [0, 1]
    const normTfidf = normalise(tfidfScores);
    const normProximity = normalise(proximityScores);

    // Combine scores with weighted sum
    const w = opts.tfidfWeight;
    const combined: RetrievedFragment[] = chunks.map((chunk, i) => ({
      chunk,
      score: w * normTfidf[i]! + (1 - w) * normProximity[i]!,
    }));

    // Filter, sort, and limit
    return combined
      .filter((r) => r.score >= opts.minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, opts.maxChunks);
  }
}

/** Normalise scored chunks to [0, 1] range, return just the scores. */
function normalise(scored: ScoredChunk[]): number[] {
  const max = Math.max(...scored.map((s) => s.score));
  if (max === 0) return scored.map(() => 0);
  return scored.map((s) => s.score / max);
}
