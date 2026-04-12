/**
 * Port interface for generating vector embeddings from text.
 *
 * Implementations may call local models (Ollama) or remote APIs.
 */
export interface IEmbeddingProvider {
  /**
   * Generate an embedding vector for a single text.
   * @returns A dense float array (dimensionality depends on the model).
   * @throws EmbeddingError if the provider is unreachable or fails.
   */
  embed(text: string): Promise<number[]>;

  /**
   * Generate embeddings for multiple texts in a single batch.
   * @returns One vector per input text, in the same order.
   * @throws EmbeddingError if the provider is unreachable or fails.
   */
  embedBatch(texts: string[]): Promise<number[][]>;

  /** The dimensionality of vectors produced by this provider. */
  readonly dimensions: number;
}
