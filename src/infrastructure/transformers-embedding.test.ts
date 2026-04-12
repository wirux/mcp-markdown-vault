import { describe, it, expect, vi, beforeEach } from "vitest";
import { EmbeddingError } from "../domain/errors/index.js";

// Hoisted mocks — available inside vi.mock factory
const { mockExtractor, mockPipelineFn } = vi.hoisted(() => {
  const mockExtractor = vi.fn();
  const mockPipelineFn = vi.fn();
  return { mockExtractor, mockPipelineFn };
});

vi.mock("@huggingface/transformers", () => ({
  pipeline: mockPipelineFn,
}));

import { TransformersEmbeddingProvider } from "./transformers-embedding.js";

describe("TransformersEmbeddingProvider", () => {
  beforeEach(() => {
    mockExtractor.mockReset();
    mockPipelineFn.mockReset();
    mockPipelineFn.mockResolvedValue(mockExtractor);
  });

  describe("embed", () => {
    it("loads model lazily on first call", async () => {
      mockExtractor.mockResolvedValueOnce({
        tolist: () => [[0.1, 0.2, 0.3]],
      });

      const provider = new TransformersEmbeddingProvider({ dimensions: 3 });
      await provider.embed("test");

      expect(mockPipelineFn).toHaveBeenCalledOnce();
      expect(mockPipelineFn).toHaveBeenCalledWith(
        "feature-extraction",
        "Xenova/all-MiniLM-L6-v2",
      );
    });

    it("returns a flat embedding vector", async () => {
      mockExtractor.mockResolvedValueOnce({
        tolist: () => [[0.1, 0.2, 0.3]],
      });

      const provider = new TransformersEmbeddingProvider({ dimensions: 3 });
      const result = await provider.embed("hello");
      expect(result).toEqual([0.1, 0.2, 0.3]);
    });

    it("passes pooling and normalize options to extractor", async () => {
      mockExtractor.mockResolvedValueOnce({
        tolist: () => [[0.1, 0.2, 0.3]],
      });

      const provider = new TransformersEmbeddingProvider({ dimensions: 3 });
      await provider.embed("hello");

      expect(mockExtractor).toHaveBeenCalledWith("hello", {
        pooling: "mean",
        normalize: true,
      });
    });

    it("reuses model across multiple calls", async () => {
      mockExtractor
        .mockResolvedValueOnce({ tolist: () => [[0.1, 0.2, 0.3]] })
        .mockResolvedValueOnce({ tolist: () => [[0.4, 0.5, 0.6]] });

      const provider = new TransformersEmbeddingProvider({ dimensions: 3 });
      await provider.embed("first");
      await provider.embed("second");

      // pipeline() called only once — model reused
      expect(mockPipelineFn).toHaveBeenCalledOnce();
    });

    it("throws EmbeddingError when model fails to load", async () => {
      mockPipelineFn.mockRejectedValueOnce(new Error("Model not found"));

      const provider = new TransformersEmbeddingProvider();
      await expect(provider.embed("fail")).rejects.toThrow(EmbeddingError);
    });

    it("throws EmbeddingError when extraction fails", async () => {
      mockExtractor.mockRejectedValueOnce(new Error("inference failed"));

      const provider = new TransformersEmbeddingProvider({ dimensions: 3 });
      await expect(provider.embed("fail")).rejects.toThrow(EmbeddingError);
    });

    it("uses custom model when provided", async () => {
      mockExtractor.mockResolvedValueOnce({
        tolist: () => [[0.1, 0.2, 0.3]],
      });

      const provider = new TransformersEmbeddingProvider({
        model: "custom/model",
        dimensions: 3,
      });
      await provider.embed("test");

      expect(mockPipelineFn).toHaveBeenCalledWith(
        "feature-extraction",
        "custom/model",
      );
    });
  });

  describe("embedBatch", () => {
    it("embeds multiple texts sequentially", async () => {
      mockExtractor
        .mockResolvedValueOnce({ tolist: () => [[0.1, 0.2, 0.3]] })
        .mockResolvedValueOnce({ tolist: () => [[0.4, 0.5, 0.6]] });

      const provider = new TransformersEmbeddingProvider({ dimensions: 3 });
      const results = await provider.embedBatch(["one", "two"]);

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual([0.1, 0.2, 0.3]);
      expect(results[1]).toEqual([0.4, 0.5, 0.6]);
    });

    it("returns empty array for empty input", async () => {
      const provider = new TransformersEmbeddingProvider();
      const results = await provider.embedBatch([]);
      expect(results).toEqual([]);
    });
  });

  describe("dimensions", () => {
    it("exposes default dimensions (384)", () => {
      const provider = new TransformersEmbeddingProvider();
      expect(provider.dimensions).toBe(384);
    });

    it("accepts custom dimensions", () => {
      const provider = new TransformersEmbeddingProvider({ dimensions: 768 });
      expect(provider.dimensions).toBe(768);
    });
  });
});
