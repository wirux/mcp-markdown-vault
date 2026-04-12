import type { IEmbeddingProvider } from "../domain/interfaces/index.js";
import { EmbeddingError } from "../domain/errors/index.js";

export interface OllamaConfig {
  /** Ollama REST API base URL (e.g. "http://localhost:11434"). */
  baseUrl: string;
  /** Model name (e.g. "nomic-embed-text"). */
  model: string;
  /** Expected vector dimensionality. */
  dimensions: number;
}

/**
 * IEmbeddingProvider adapter for the Ollama REST API.
 *
 * Uses the /api/embed endpoint.
 */
export class OllamaEmbeddingProvider implements IEmbeddingProvider {
  private readonly baseUrl: string;
  private readonly model: string;
  public readonly dimensions: number;

  constructor(config: OllamaConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.model = config.model;
    this.dimensions = config.dimensions;
  }

  async embed(text: string): Promise<number[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.model, input: text }),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new EmbeddingError(
          `Ollama returned ${response.status}: ${body}`,
        );
      }

      const data = (await response.json()) as { embedding: number[] };
      return data.embedding;
    } catch (err) {
      if (err instanceof EmbeddingError) throw err;
      throw new EmbeddingError(
        "Failed to connect to Ollama",
        err instanceof Error ? err : undefined,
      );
    }
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (const text of texts) {
      results.push(await this.embed(text));
    }
    return results;
  }
}
