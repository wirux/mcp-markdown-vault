import type { Chunk } from "./chunker.js";

export interface ScoredChunk {
  chunk: Chunk;
  score: number;
}

// ── Tokenisation ───────────────────────────────────────────────────

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

// ── TF-IDF ─────────────────────────────────────────────────────────

/**
 * Classic TF-IDF scorer.
 *
 * - TF = (term count in chunk) / (total words in chunk)
 * - IDF = ln(N / df) where df = number of chunks containing the term
 * - Multi-word queries: sum of per-term TF-IDF scores
 */
export class TfIdfScorer {
  private readonly chunkTokens: string[][];
  private readonly chunks: Chunk[];
  /** df: number of chunks containing each term */
  private readonly docFreq: Map<string, number>;
  private readonly n: number;

  constructor(chunks: Chunk[]) {
    this.chunks = chunks;
    this.n = chunks.length;
    this.chunkTokens = chunks.map((c) => tokenize(c.text));
    this.docFreq = new Map();

    for (const tokens of this.chunkTokens) {
      const unique = new Set(tokens);
      for (const term of unique) {
        this.docFreq.set(term, (this.docFreq.get(term) ?? 0) + 1);
      }
    }
  }

  score(query: string): ScoredChunk[] {
    const queryTerms = tokenize(query);
    if (queryTerms.length === 0) {
      return this.chunks.map((chunk) => ({ chunk, score: 0 }));
    }

    return this.chunks.map((chunk, i) => {
      const tokens = this.chunkTokens[i]!;
      let totalScore = 0;

      for (const term of queryTerms) {
        const tf = termFrequency(tokens, term);
        const df = this.docFreq.get(term) ?? 0;
        const idf = df > 0 ? Math.log(this.n / df) : 0;
        totalScore += tf * idf;
      }

      return { chunk, score: totalScore };
    });
  }
}

function termFrequency(tokens: string[], term: string): number {
  if (tokens.length === 0) return 0;
  let count = 0;
  for (const t of tokens) {
    if (t === term) count++;
  }
  return count / tokens.length;
}

// ── Proximity scorer ───────────────────────────────────────────────

/**
 * Scores chunks by how close multi-word query terms appear to each other.
 *
 * For single-word queries, returns 0 (proximity is meaningless).
 * Score = 1 / (average minimum pairwise distance between consecutive
 * query terms). Higher = closer together.
 */
export class ProximityScorer {
  static score(chunks: Chunk[], query: string): ScoredChunk[] {
    const queryTerms = tokenize(query);

    // Proximity is meaningless for single terms
    if (queryTerms.length < 2) {
      return chunks.map((chunk) => ({ chunk, score: 0 }));
    }

    return chunks.map((chunk) => {
      const tokens = tokenize(chunk.text);
      const score = proximityScore(tokens, queryTerms);
      return { chunk, score };
    });
  }
}

/**
 * Compute proximity score for a sequence of query terms in a token list.
 *
 * For each consecutive pair of query terms, find the minimum distance
 * between any occurrence of term_i and term_{i+1}. Average those
 * minimums, then invert: score = 1 / avgDist.
 */
function proximityScore(tokens: string[], queryTerms: string[]): number {
  // Build position index
  const positions = new Map<string, number[]>();
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const list = positions.get(t);
    if (list) {
      list.push(i);
    } else {
      positions.set(t, [i]);
    }
  }

  let totalMinDist = 0;
  let pairs = 0;

  for (let q = 0; q < queryTerms.length - 1; q++) {
    const posA = positions.get(queryTerms[q]!);
    const posB = positions.get(queryTerms[q + 1]!);

    if (!posA || !posB) return 0; // term not found at all

    let minDist = Infinity;
    for (const a of posA) {
      for (const b of posB) {
        const dist = Math.abs(a - b);
        if (dist < minDist) minDist = dist;
      }
    }

    totalMinDist += minDist;
    pairs++;
  }

  if (pairs === 0) return 0;

  const avgDist = totalMinDist / pairs;
  return avgDist > 0 ? 1 / avgDist : 0;
}
