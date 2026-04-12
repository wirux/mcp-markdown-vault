import type { IFileSystemAdapter } from "../domain/interfaces/file-system-adapter.js";
import { FragmentRetriever } from "./fragment-retrieval.js";

export interface VaultSearchResult {
  filePath: string;
  headingPath: string[];
  text: string;
  score: number;
  wordCount: number;
}

export interface VaultSearchOptions {
  /** Maximum results to return. Default: 20. */
  maxResults?: number | undefined;
}

/**
 * Cross-vault lexical search.
 *
 * Iterates all vault notes, chunks each with the FragmentRetriever,
 * scores with TF-IDF + proximity, and returns the top results
 * ranked across the entire vault.
 *
 * No embeddings required — works immediately without an index.
 */
export class VaultSearcher {
  private readonly retriever: FragmentRetriever;

  constructor(private readonly fsAdapter: IFileSystemAdapter) {
    this.retriever = new FragmentRetriever();
  }

  async search(
    query: string,
    options?: VaultSearchOptions,
  ): Promise<VaultSearchResult[]> {
    const maxResults = options?.maxResults ?? 20;
    const files = await this.fsAdapter.listNotes();

    const allResults: VaultSearchResult[] = [];

    for (const filePath of files) {
      try {
        const content = await this.fsAdapter.readNote(filePath);
        const fragments = this.retriever.retrieve(content, query, {
          maxChunks: maxResults,
          minScore: 0.01,
        });

        for (const fragment of fragments) {
          allResults.push({
            filePath,
            headingPath: fragment.chunk.headingPath,
            text: fragment.chunk.text,
            score: fragment.score,
            wordCount: fragment.chunk.wordCount,
          });
        }
      } catch {
        // Skip unreadable files — log nothing, keep searching
        continue;
      }
    }

    allResults.sort((a, b) => b.score - a.score);
    return allResults.slice(0, maxResults);
  }
}
