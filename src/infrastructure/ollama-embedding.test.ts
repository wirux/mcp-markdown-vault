import { describe, it, expect, vi, beforeEach } from "vitest";
import { OllamaEmbeddingProvider } from "./ollama-embedding.js";
import { EmbeddingError } from "../domain/errors/index.js";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

function mockOllamaResponse(embedding: number[]): void {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ embedding }),
  });
}

function mockOllamaError(status: number, statusText: string): void {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    statusText,
    text: async () => statusText,
  });
}

describe("OllamaEmbeddingProvider", () => {
  const provider = new OllamaEmbeddingProvider({
    baseUrl: "http://localhost:11434",
    model: "nomic-embed-text",
    dimensions: 4,
  });

  describe("embed", () => {
    it("sends correct request to Ollama API", async () => {
      mockOllamaResponse([0.1, 0.2, 0.3, 0.4]);

      await provider.embed("test text");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:11434/api/embed",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "nomic-embed-text",
            input: "test text",
          }),
        }),
      );
    });

    it("returns the embedding vector", async () => {
      mockOllamaResponse([0.1, 0.2, 0.3, 0.4]);
      const result = await provider.embed("hello");
      expect(result).toEqual([0.1, 0.2, 0.3, 0.4]);
    });

    it("throws EmbeddingError on HTTP failure", async () => {
      mockOllamaError(500, "Internal Server Error");
      await expect(provider.embed("fail")).rejects.toThrow(EmbeddingError);
    });

    it("throws EmbeddingError on network failure", async () => {
      mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
      await expect(provider.embed("fail")).rejects.toThrow(EmbeddingError);
    });
  });

  describe("embedBatch", () => {
    it("embeds multiple texts sequentially", async () => {
      mockOllamaResponse([0.1, 0.2, 0.3, 0.4]);
      mockOllamaResponse([0.5, 0.6, 0.7, 0.8]);

      const results = await provider.embedBatch(["text one", "text two"]);
      expect(results).toHaveLength(2);
      expect(results[0]).toEqual([0.1, 0.2, 0.3, 0.4]);
      expect(results[1]).toEqual([0.5, 0.6, 0.7, 0.8]);
    });

    it("returns empty array for empty input", async () => {
      const results = await provider.embedBatch([]);
      expect(results).toEqual([]);
    });
  });

  describe("dimensions", () => {
    it("exposes configured dimensions", () => {
      expect(provider.dimensions).toBe(4);
    });
  });
});
