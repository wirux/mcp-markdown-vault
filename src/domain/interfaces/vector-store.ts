/**
 * Port interface for a vector similarity store.
 *
 * Stores document chunks as vectors and supports nearest-neighbour search.
 */
export interface IVectorStore {
  /**
   * Add or update a document's chunks in the store.
   * If the document already exists, its previous vectors are replaced.
   */
  upsert(entry: VectorEntry): Promise<void>;

  /**
   * Search for the k-nearest chunks to the query vector.
   * @returns Results sorted by descending similarity (highest first).
   */
  search(queryVector: number[], k: number): Promise<VectorSearchResult[]>;

  /**
   * Remove all vectors associated with a document path.
   */
  delete(docPath: string): Promise<void>;

  /**
   * Check whether a document has been indexed.
   */
  has(docPath: string): Promise<boolean>;

  /** Number of documents currently indexed. */
  size(): Promise<number>;
}

export interface VectorEntry {
  /** Vault-relative path of the source note. */
  docPath: string;
  /** One record per chunk from that note. */
  chunks: VectorChunk[];
}

export interface VectorChunk {
  /** Chunk identifier (e.g. heading path joined). */
  chunkId: string;
  /** The embedding vector. */
  vector: number[];
  /** Plain text of the chunk (stored for retrieval). */
  text: string;
  /** Heading breadcrumb path. */
  headingPath: string[];
}

export interface VectorSearchResult {
  docPath: string;
  chunkId: string;
  text: string;
  headingPath: string[];
  /** Cosine similarity score in [0, 1]. */
  similarity: number;
}
