export interface FuzzyMatchResult {
  /** The matching candidate string. */
  match: string;
  /** Similarity score in [0, 1] where 1 = exact match. */
  similarity: number;
  /** Levenshtein edit distance. */
  distance: number;
}

/**
 * Fuzzy text matching using Levenshtein distance.
 *
 * Designed to make edit operations resilient to LLM typos:
 * handles missing/extra/transposed/substituted characters.
 */
export class FuzzyMatcher {
  /**
   * Find the best match for `query` among `candidates`.
   * Returns null if no match exceeds the threshold.
   *
   * @param threshold Minimum similarity required (default: 0.6).
   */
  static bestMatch(
    query: string,
    candidates: string[],
    threshold = 0.6,
  ): FuzzyMatchResult | null {
    const matches = FuzzyMatcher.allMatches(query, candidates, threshold);
    return matches.length > 0 ? matches[0]! : null;
  }

  /**
   * Return all candidates that match above the threshold,
   * sorted by descending similarity.
   */
  static allMatches(
    query: string,
    candidates: string[],
    threshold = 0.6,
  ): FuzzyMatchResult[] {
    const lowerQuery = query.toLowerCase();

    const results: FuzzyMatchResult[] = [];

    for (const candidate of candidates) {
      const lowerCandidate = candidate.toLowerCase();
      const dist = FuzzyMatcher.distance(lowerQuery, lowerCandidate);
      const maxLen = Math.max(lowerQuery.length, lowerCandidate.length);
      const similarity = maxLen === 0 ? 1 : 1 - dist / maxLen;

      if (similarity >= threshold) {
        results.push({ match: candidate, similarity, distance: dist });
      }
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return results;
  }

  /**
   * Compute the Levenshtein edit distance between two strings.
   * Uses the Wagner–Fischer dynamic programming algorithm.
   */
  static distance(a: string, b: string): number {
    const m = a.length;
    const n = b.length;

    // Optimisation: use a single-row DP array
    const prev = new Array<number>(n + 1);
    const curr = new Array<number>(n + 1);

    for (let j = 0; j <= n; j++) {
      prev[j] = j;
    }

    for (let i = 1; i <= m; i++) {
      curr[0] = i;
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        curr[j] = Math.min(
          prev[j]! + 1, // deletion
          curr[j - 1]! + 1, // insertion
          prev[j - 1]! + cost, // substitution
        );
      }
      // Swap rows
      for (let j = 0; j <= n; j++) {
        prev[j] = curr[j]!;
      }
    }

    return prev[n]!;
  }
}
