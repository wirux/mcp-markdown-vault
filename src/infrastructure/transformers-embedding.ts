import { pipeline } from "@huggingface/transformers";
import type { IEmbeddingProvider } from "../domain/interfaces/index.js";
import { EmbeddingError } from "../domain/errors/index.js";

export interface TransformersConfig {
  /** HuggingFace model ID. Default: "Xenova/all-MiniLM-L6-v2" */
  model?: string | undefined;
  /** Vector dimensions. Default: 384 (all-MiniLM-L6-v2). */
  dimensions?: number | undefined;
}

const DEFAULT_MODEL = "Xenova/all-MiniLM-L6-v2";
const DEFAULT_DIMENSIONS = 384;

/**
 * IEmbeddingProvider adapter using @huggingface/transformers.
 *
 * Runs entirely in-process — no external service required.
 * The model is downloaded on first use and cached locally.
 */
export class TransformersEmbeddingProvider implements IEmbeddingProvider {
  private readonly model: string;
  public readonly dimensions: number;
  private extractor:
    | ((
        text: string,
        options: { pooling: string; normalize: boolean },
      ) => Promise<{ tolist(): number[][] }>)
    | null = null;

  constructor(config?: TransformersConfig) {
    this.model = config?.model ?? DEFAULT_MODEL;
    this.dimensions = config?.dimensions ?? DEFAULT_DIMENSIONS;
  }

  private async getExtractor(): Promise<
    (
      text: string,
      options: { pooling: string; normalize: boolean },
    ) => Promise<{ tolist(): number[][] }>
  > {
    if (!this.extractor) {
      try {
        this.extractor = (await pipeline(
          "feature-extraction",
          this.model,
        )) as unknown as typeof this.extractor;
      } catch (err) {
        throw new EmbeddingError(
          `Failed to load embedding model "${this.model}"`,
          err instanceof Error ? err : undefined,
        );
      }
    }
    return this.extractor!;
  }

  async embed(text: string): Promise<number[]> {
    try {
      const extractor = await this.getExtractor();
      const output = await extractor(text, {
        pooling: "mean",
        normalize: true,
      });
      const vectors = output.tolist();
      return vectors[0]!;
    } catch (err) {
      if (err instanceof EmbeddingError) throw err;
      throw new EmbeddingError(
        "Failed to generate embedding",
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
